/**
 * QuickBooks Online (QBO) OAuth2 client + PurchaseOrder attachment sync.
 *
 * SyncNo's purchase orders come from SyncroMSP; this module reaches into
 * QuickBooks Online to pull the *file attachments* uploaded against the
 * corresponding QBO PurchaseOrder. A Syncro PO is matched to a QBO PO by PO
 * number (Syncro `purchase_orders.number` == QBO `PurchaseOrder.DocNumber`),
 * and the matched QBO Id is cached on the SyncNo row (`qbo_id`) so subsequent
 * runs skip the lookup.
 *
 * Auth model: OAuth2 authorization-code (Connect button).
 *   Two layers of config:
 *     - App credentials (client ID/secret/environment) — static, pasted once in
 *       Config → QuickBooks Online. These identify the Intuit app.
 *     - Connection (realmId + refresh token) — obtained via the in-app "Connect
 *       to QuickBooks" button, which runs the full browser OAuth flow:
 *       redirect to Intuit → user consents → callback with an auth code →
 *       backend exchanges the code for access + refresh tokens. The refresh
 *       token is then self-renewed indefinitely (access tokens live ~1 hour;
 *       refresh tokens rotate on every refresh, stay valid ~100 days, and are
 *       persisted to settings + .env on each rotation).
 *
 * Attachment flow (per QBO PO):
 *   1. Query Attachable records linked to the PurchaseOrder.
 *   2. Filter to file-type attachables (those carrying a TempDownloadUri).
 *   3. Download each TempDownloadUri (pre-authenticated, short-lived) to
 *      data/attachments/po-<number>/ — idempotent (skips files already on disk).
 *
 * No external OAuth library — token exchange + refresh are plain fetch POSTs,
 * matching the rest of the codebase (global fetch, no SDK deps).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getSetting, setSetting, updateEnvFile } from './settings.js';
import { getDb } from '../db/database.js';

// ─── Errors ──────────────────────────────────────────────────────────────────

export class QboNotConfiguredError extends Error {
  constructor(message = 'QuickBooks Online is not configured') {
    super(message);
    this.name = 'QboNotConfiguredError';
  }
}

export class QboApiError extends Error {
  /**
   * @param {string} message
   * @param {number} [status]
   * @param {object} [body]
   */
  constructor(message, status, body) {
    super(message);
    this.name = 'QboApiError';
    this.status = status;
    this.body = body;
  }
}

// ─── Configuration ────────────────────────────────────────────────────────────

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const SCOPES = ['com.intuit.quickbooks.accounting'];

// Settings keys (lowercase, as stored in the settings table / .env uppercased).
const KEYS = {
  clientId: 'qbo_client_id',
  clientSecret: 'qbo_client_secret',
  realmId: 'qbo_realm_id',
  refreshToken: 'qbo_refresh_token',
  environment: 'qbo_environment', // 'sandbox' | 'production'
};

/**
 * Read the Intuit *app* credentials (client ID/secret/environment). These are
 * the static values the admin pastes once. Env vars (uppercased keys) win over
 * the settings table, exactly like syncro_api_key.
 * @returns {{clientId:string,clientSecret:string,environment:string}|null}
 */
export function getQboAppCredentials() {
  const clientId = getSetting(KEYS.clientId);
  const clientSecret = getSetting(KEYS.clientSecret);
  const environment = (getSetting(KEYS.environment) || 'sandbox').toLowerCase();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, environment };
}

/**
 * Whether the Intuit app credentials are present (i.e. a "Connect" is possible).
 */
export function hasQboAppCredentials() {
  return getQboAppCredentials() !== null;
}

/**
 * Read the *connection* state: the realmId + refresh token obtained via OAuth.
 * Returns null if not yet connected (no company authorized).
 * @returns {{realmId:string,refreshToken:string}|null}
 */
export function getQboConnection() {
  const realmId = getSetting(KEYS.realmId);
  const refreshToken = getSetting(KEYS.refreshToken);
  if (!realmId || !refreshToken) return null;
  return { realmId, refreshToken };
}

/**
 * Full config (app creds + connection). Returns null if EITHER the app creds OR
 * the connection is missing — i.e. not ready to make Accounting API calls.
 * @returns {{clientId:string,clientSecret:string,realmId:string,refreshToken:string,environment:string}|null}
 */
export function getQboConfig() {
  const app = getQboAppCredentials();
  const conn = getQboConnection();
  if (!app || !conn) return null;
  return { ...app, ...conn };
}

/**
 * Whether QBO is fully configured and connected (app creds + a company
 * authorized). Used by sync endpoints to gate calls.
 */
export function isQboConfigured() {
  return getQboConfig() !== null;
}

// Back-compat alias — callers that previously checked "configured" meant
// "ready to call the API", which is "connected".
export const isQboConnected = isQboConfigured;

/** Accounting API base URL for the configured environment. */
function apiBaseUrl(environment, realmId) {
  const host = environment === 'production'
    ? 'quickbooks.api.intuit.com'
    : 'sandbox-quickbooks.api.intuit.com';
  return `https://${host}/v3/company/${realmId}`;
}

// ─── OAuth2 authorization-code flow (Connect button) ──────────────────────────

/**
 * Derive the public redirect URI the browser/Intuit will call back. Built from
 * NEXTAUTH_URL so it works regardless of how the app is hosted (the frontend
 * proxies /api/* to the backend, so the callback routes through the proxy).
 * @returns {string|null}
 */
export function getRedirectUri() {
  const base = process.env.NEXTAUTH_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/api/qbo-settings/callback`;
}

/**
 * Build the Intuit consent-screen URL the admin is sent to. Includes a random
 * `state` token (stored in-memory) that the callback validates to prevent CSRF.
 * @returns {{url:string, redirectUri:string}|null} null if app creds missing
 */
export function buildAuthUrl() {
  const app = getQboAppCredentials();
  const redirectUri = getRedirectUri();
  if (!app || !redirectUri) return null;
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.add(state);
  const params = new URLSearchParams({
    client_id: app.clientId,
    scope: SCOPES.join(' '),
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  });
  return { url: `${AUTHORIZE_URL}?${params.toString()}`, redirectUri };
}

// In-memory set of pending OAuth `state` values (CSRF protection). A process
// restart drops these, but the flow completes in seconds so that's fine.
const pendingStates = new Set();

/**
 * Exchange the authorization code (returned by Intuit in the callback) for
 * access + refresh tokens, and persist the connection (realmId + refresh token)
 * to settings + .env. This is the "Connect" completing.
 *
 * @param {string} code authorization code from Intuit
 * @param {string} realmId company realmId from the callback query string
 * @returns {Promise<void>}
 * @throws {QboNotConfiguredError|QboApiError}
 */
export async function exchangeAuthCode(code, realmId) {
  const app = getQboAppCredentials();
  if (!app) throw new QboNotConfiguredError('QuickBooks app credentials are not configured');
  const redirectUri = getRedirectUri();
  if (!redirectUri) throw new QboNotConfiguredError('NEXTAUTH_URL is not set — cannot derive OAuth redirect URI');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const auth = Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64');
  let resp;
  try {
    resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body,
    });
  } catch (e) {
    throw new QboApiError(`OAuth code exchange network error: ${e.message}`);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new QboApiError(`OAuth code exchange failed (HTTP ${resp.status}): ${text.slice(0, 300)}`, resp.status);
  }
  const data = await resp.json();
  if (!data.refresh_token) {
    throw new QboApiError('OAuth code exchange returned no refresh_token');
  }

  // Persist the connection (clears any cached access token so the next call
  // refreshes with the new token).
  persistConnection(realmId, data.refresh_token);
  invalidateToken();
}

/** Validate + consume a pending OAuth state token (CSRF check). Returns true if valid. */
export function consumeState(state) {
  if (!state || !pendingStates.has(state)) return false;
  pendingStates.delete(state);
  return true;
}

/**
 * Drop the stored connection (realmId + refresh token). The Intuit app creds
 * remain, so the admin can re-Connect. Clears the cached access token.
 */
export function disconnect() {
  setSetting(KEYS.realmId, '');
  setSetting(KEYS.refreshToken, '');
  process.env.QBO_REALM_ID = '';
  process.env.QBO_REFRESH_TOKEN = '';
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    updateEnvFile(envPath, { QBO_REALM_ID: '', QBO_REFRESH_TOKEN: '' });
  } catch (e) {
    console.error('[qbo] failed to clear connection in .env:', e.message);
  }
  invalidateToken();
}

/**
 * Persist the connection (realmId + refresh token) to settings + .env. Called
 * on OAuth code exchange AND on refresh-token rotation.
 */
function persistConnection(realmId, refreshToken) {
  if (realmId) {
    setSetting(KEYS.realmId, realmId);
    process.env.QBO_REALM_ID = realmId;
  }
  if (refreshToken && refreshToken !== getSetting(KEYS.refreshToken)) {
    setSetting(KEYS.refreshToken, refreshToken);
    process.env.QBO_REFRESH_TOKEN = refreshToken;
  }
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    updateEnvFile(envPath, {
      QBO_REALM_ID: realmId || getSetting(KEYS.realmId),
      QBO_REFRESH_TOKEN: refreshToken || getSetting(KEYS.refreshToken),
    });
  } catch (e) {
    console.error('[qbo] failed to persist connection to .env:', e.message);
  }
}

// ─── Token management (in-memory cache, refresh-on-expiry) ────────────────────

// Cached access token + expiry (ms epoch). Refresh tokens are NOT cached here —
// they're always read from settings (since each refresh rotates the stored one).
let cachedAccessToken = null; // { token, expiresAt }
let refreshInFlight = null;   // serialized refresh promise

/**
 * Persist a (possibly rotated) refresh token back to settings + .env so a
 * restart never loses it. Called on every refresh.
 */
function persistRefreshToken(newRefreshToken) {
  if (!newRefreshToken || newRefreshToken === getSetting(KEYS.refreshToken)) return;
  setSetting(KEYS.refreshToken, newRefreshToken);
  process.env.QBO_REFRESH_TOKEN = newRefreshToken;
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    updateEnvFile(envPath, { QBO_REFRESH_TOKEN: newRefreshToken });
  } catch (e) {
    console.error('[qbo] failed to persist rotated refresh token to .env:', e.message);
  }
}

/**
 * Exchange the stored refresh token for a fresh access token. Serializes calls
 * so concurrent refreshes don't race. Stores the rotated refresh token.
 * @returns {Promise<string>} access token
 * @throws {QboNotConfiguredError|QboApiError}
 */
async function refreshAccessToken() {
  const cfg = getQboConfig();
  if (!cfg) throw new QboNotConfiguredError();

  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: cfg.refreshToken,
    });
    const auth = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
    let resp;
    try {
      resp = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body,
      });
    } catch (e) {
      throw new QboApiError(`Token refresh network error: ${e.message}`);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new QboApiError(`Token refresh failed (HTTP ${resp.status}): ${text.slice(0, 300)}`, resp.status);
    }

    const data = await resp.json();
    if (!data.access_token) {
      throw new QboApiError('Token refresh returned no access_token');
    }
    // QBO rotates the refresh token on every refresh — always store the latest.
    if (data.refresh_token) persistRefreshToken(data.refresh_token);

    const expiresInSec = Number(data.expires_in) || 3600;
    // Refresh a little early (5 min margin) to avoid edge races.
    cachedAccessToken = {
      token: data.access_token,
      expiresAt: Date.now() + (expiresInSec - 300) * 1000,
    };
    return cachedAccessToken.token;
  })().finally(() => { refreshInFlight = null; });

  return refreshInFlight;
}

/**
 * Return a valid access token, refreshing first if the cached one is gone or
 * about to expire. Drop the cache (called on 401) so the next call re-refreshes.
 * @returns {Promise<string>}
 */
export async function getValidAccessToken() {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.token;
  }
  return refreshAccessToken();
}

/** Drop the cached access token so the next API call forces a refresh. */
export function invalidateToken() {
  cachedAccessToken = null;
}

// ─── QBO API calls ────────────────────────────────────────────────────────────

/**
 * Fetch a QBO API endpoint with the bearer token attached. Retries once on 401
 * (invalidate → refresh → retry), mirroring the syncroSession retry-on-expiry
 * pattern. JSON expected.
 *
 * @param {string} path path under /v3/company/<realmId> (e.g. /query?query=...)
 * @param {{method?:string, headers?:object}} [opts]
 * @returns {Promise<object>} parsed JSON
 */
async function qboFetch(path, opts = {}) {
  const cfg = getQboConfig();
  if (!cfg) throw new QboNotConfiguredError();
  const url = `${apiBaseUrl(cfg.environment, cfg.realmId)}${path}`;
  const token = await getValidAccessToken();
  const doFetch = (tok) => fetch(url, {
    method: opts.method || 'GET',
    headers: {
      'Authorization': `Bearer ${tok}`,
      'Accept': 'application/json',
      ...(opts.headers || {}),
    },
  });

  let resp = await doFetch(token);
  if (resp.status === 401) {
    // Token expired mid-flight — refresh once and retry.
    invalidateToken();
    const fresh = await getValidAccessToken();
    resp = await doFetch(fresh);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    let body = null;
    try { body = JSON.parse(text); } catch (_) { /* non-JSON error body */ }
    const msg = body?.fault?.error?.[0]?.message
      || body?.Fault?.Error?.[0]?.Message
      || `QBO HTTP ${resp.status}: ${text.slice(0, 300)}`;
    throw new QboApiError(msg, resp.status, body);
  }
  return resp.json();
}

/**
 * Find a QBO PurchaseOrder by DocNumber (the QBO field that maps to Syncro's PO
 * number). Returns the QBO Id string, or null if no match.
 * @param {string} docNumber
 * @returns {Promise<string|null>}
 */
export async function findPoByDocNumber(docNumber) {
  if (!docNumber) return null;
  // Escape single quotes for the SQL-like query (QBO uses '' for a literal ').
  const escaped = String(docNumber).replace(/'/g, "''");
  const q = `select Id, DocNumber from PurchaseOrder where DocNumber = '${escaped}' MAXRESULTS 1`;
  const data = await qboFetch(`/query?query=${encodeURIComponent(q)}`);
  const pos = data?.QueryResponse?.PurchaseOrder;
  return Array.isArray(pos) && pos.length ? String(pos[0].Id) : null;
}

/**
 * Query all Attachable records linked to a QBO PurchaseOrder.
 * Each file-type attachable carries a `TempDownloadUri` (pre-authenticated,
 * short-lived URL to the raw file). Note-only attachables lack it.
 * @param {string} qboPoId
 * @returns {Promise<object[]>} attachable objects
 */
export async function queryAttachables(qboPoId) {
  const q = `select * from Attachable where AttachableRef.EntityRef.Type = 'PurchaseOrder' and AttachableRef.EntityRef.Value = '${qboPoId}'`;
  const data = await qboFetch(`/query?query=${encodeURIComponent(q)}`);
  const list = data?.QueryResponse?.Attachable;
  return Array.isArray(list) ? list : [];
}

/**
 * Download a TempDownloadUri to a Buffer. These URLs are pre-authenticated and
 * short-lived — no OAuth header is sent (adding one can actually 400).
 * @param {string} tempDownloadUri
 * @returns {Promise<Buffer>}
 */
async function downloadAttachment(tempDownloadUri) {
  const resp = await fetch(tempDownloadUri);
  if (!resp.ok) throw new Error(`attachment download HTTP ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

// ─── Attachment sync (the core function) ──────────────────────────────────────

const ATTACHMENTS_DIR = path.resolve(process.cwd(), 'data/attachments');

/**
 * Sanitize a filename for safe local storage. Mirrors syncTicketAttachments.
 * @param {string} name
 * @returns {string}
 */
function sanitizeFilename(name) {
  if (!name) return 'unnamed';
  const base = String(name).replace(/[\\/]/g, '_').replace(/\.\.+/g, '.').trim();
  const cleaned = base.replace(/[^A-Za-z0-9._\-\s]/g, '_').slice(0, 200);
  return cleaned || 'unnamed';
}

/**
 * Resolve the best download URL from an Attachable record. QBO has used a few
 * field names across versions (TempDownloadUri/TempDownloadUrl/DownloadUri).
 * @param {object} att
 * @returns {string|null}
 */
function resolveDownloadUri(att) {
  return att?.TempDownloadUri || att?.TempDownloadUrl || att?.DownloadUri || att?.DownloadUrl || null;
}

/**
 * Resolve the original filename from an Attachable record.
 * @param {object} att
 * @returns {string}
 */
function resolveFileName(att) {
  return att?.FileName || att?.filename || att?.Note || `attachment_${att?.Id || Math.random().toString(36).slice(2)}`;
}

/**
 * Sync attachments for a single SyncNo purchase order from QuickBooks Online.
 *
 * Steps: resolve QBO PO Id (cached or by DocNumber lookup) → query Attachables
 * → download each file-type attachable to data/attachments/po-<number>/ →
 * stamp attachments_count + attachments_synced_at on the SyncNo row.
 *
 * A SyncNo PO with no QBO match is NOT an error — it's stamped with count 0 so
 * the UI shows "No attachments on disk." Never throws; errors land in the
 * returned `errors` array (per-attachment failures don't abort the whole PO).
 *
 * @param {{id:number|string, number:string, qbo_id?:string|null}} po
 * @returns {Promise<{matched:boolean, qboId:string|null, total:number, downloaded:number, skipped:number, errors:string[]}>}
 */
export async function syncPoAttachments(po) {
  const db = getDb();
  const result = { matched: false, qboId: null, total: 0, downloaded: 0, skipped: 0, errors: [] };
  const poNumber = String(po.number || po.id);
  const stampZero = () => {
    db.prepare(`UPDATE purchase_orders SET attachments_count = 0, attachments_synced_at = datetime('now') WHERE id = ?`).run(po.id);
  };

  // 1. Resolve the QBO PurchaseOrder Id — cached on the row, else look it up.
  let qboId = po.qbo_id || null;
  if (!qboId && po.number) {
    try {
      qboId = await findPoByDocNumber(po.number);
    } catch (e) {
      result.errors.push(`DocNumber lookup failed: ${e.message}`);
      stampZero();
      return result;
    }
  }
  if (!qboId) {
    // No corresponding PO in QBO — not an error, just nothing to attach.
    stampZero();
    return result;
  }
  result.matched = true;
  result.qboId = qboId;

  // Cache the match so future runs skip the DocNumber query.
  db.prepare('UPDATE purchase_orders SET qbo_id = ? WHERE id = ?').run(qboId, po.id);

  // 2. Query attachments linked to this QBO PO.
  let attachables;
  try {
    attachables = await queryAttachables(qboId);
  } catch (e) {
    result.errors.push(`Attachable query failed: ${e.message}`);
    stampZero();
    return result;
  }

  // 3. Keep only file-type attachables (note-only ones have no download URL).
  const files = attachables.filter(resolveDownloadUri);
  result.total = files.length;

  if (files.length === 0) {
    stampZero();
    return result;
  }

  // 4. Download each to data/attachments/po-<number>/ (skip if already on disk).
  const poDir = path.join(ATTACHMENTS_DIR, `po-${poNumber}`);
  try { fs.mkdirSync(poDir, { recursive: true }); } catch (_) { /* may already exist */ }

  for (const att of files) {
    const safeName = sanitizeFilename(resolveFileName(att));
    const dest = path.join(poDir, safeName);
    if (fs.existsSync(dest)) { result.skipped++; continue; }
    try {
      const buf = await downloadAttachment(resolveDownloadUri(att));
      fs.writeFileSync(dest, buf);
      result.downloaded++;
    } catch (e) {
      result.errors.push(`${safeName}: ${e.message}`);
    }
  }

  db.prepare(`UPDATE purchase_orders SET attachments_count = ?, attachments_synced_at = datetime('now') WHERE id = ?`)
    .run(result.downloaded + result.skipped, po.id);
  return result;
}

/**
 * Run attachment sync across many SyncNo POs, emitting progress to a callback.
 * Used by the bulk SSE endpoint. Honors an AbortSignal so the UI can cancel.
 *
 * @param {object} opts
 * @param {boolean} [opts.force=false] re-sync POs already stamped (else only unstamped)
 * @param {AbortSignal} [opts.signal]
 * @param {(ev:{status:string,current?:number,total?:number,currentRecordName?:string,result?:object,error?:string}) => void} [opts.onProgress]
 * @returns {Promise<{total:number,matched:number,downloaded:number,skipped:number,errors:string[]}>}
 */
export async function syncAllPoAttachments({ force = false, signal, onProgress } = {}) {
  const db = getDb();
  const where = force ? '' : "WHERE attachments_synced_at IS NULL";
  const pos = db.prepare(`SELECT id, number, qbo_id FROM purchase_orders ${where} ORDER BY id`).all();
  const agg = { total: pos.length, matched: 0, downloaded: 0, skipped: 0, errors: [] };

  onProgress?.({ status: 'started', total: agg.total });

  for (let i = 0; i < pos.length; i++) {
    if (signal?.aborted) throw new Error('Sync cancelled');
    const po = pos[i];
    onProgress?.({
      status: 'progress',
      current: i + 1,
      total: agg.total,
      currentRecordName: po.number,
    });
    try {
      const r = await syncPoAttachments(po);
      if (r.matched) agg.matched++;
      agg.downloaded += r.downloaded;
      agg.skipped += r.skipped;
      if (r.errors.length) agg.errors.push(...r.errors.map(e => `PO ${po.number || po.id}: ${e}`));
      onProgress?.({ status: 'progress', current: i + 1, total: agg.total, currentRecordName: po.number, result: r });
    } catch (e) {
      agg.errors.push(`PO ${po.number || po.id}: ${e.message}`);
    }
    // 350ms spacing, matching the Syncro PO detail sync cadence.
    if (i < pos.length - 1) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 350);
        signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Sync cancelled')); }, { once: true });
      }).catch(() => { /* abort handled by loop check */ });
    }
  }

  onProgress?.({ status: 'done', ...agg });
  return agg;
}
