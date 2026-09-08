/**
 * Syncro web-session (session-cookie) auth + serial→PO lookup.
 *
 * SyncroMSP's public API cannot resolve a serial number to the purchase order
 * it was received on — that relationship is only exposed by the web app's
 * serial-history modal (`/products/{id}/product_serials/history?sn={serial}`),
 * which is an internal HTML endpoint requiring an authenticated technician
 * *session cookie* (not the API key).
 *
 * Auth model: PASTED SESSION COOKIE.
 *   Syncro's web app sits behind Cloudflare, which issues a managed challenge
 *   (Turnstile, "Just a moment...") to datacenter IPs. That blocks server-side
 *   login (plain fetch AND headless puppeteer — both verified defeated). So
 *   instead of attempting to log in from the backend, the admin exports a valid
 *   session cookie from their own browser (where Cloudflare already lets them
 *   through) and pastes it into Config → "Syncro Web Session". This module uses
 *   that cookie directly against the serial-history endpoint, and detects
 *   expiry (302→login / 401 / 403) so the UI can tell the admin to re-paste.
 *
 *   The TOTP generator below is retained (it's correct + RFC-6238-verified) but
 *   is not currently used by the login flow — it's kept so an auto-login path
 *   can be wired up later if Cloudflare is ever bypassed (e.g. via a solver
 *   proxy or residential IP).
 *
 * See handoff-serial-to-po.md for the captured API flow + worked example.
 */

import crypto from 'crypto';
import { getSetting } from './settings.js';

// ─── Errors ──────────────────────────────────────────────────────────────────

export class SyncroLoginError extends Error {
  constructor(message) { super(message); this.name = 'SyncroLoginError'; }
}

export class SyncroSessionExpired extends Error {
  constructor(message) { super(message); this.name = 'SyncroSessionExpired'; }
}

// ─── TOTP (RFC 6238) — built-in crypto only ───────────────────────────────────
// Currently unused by the cookie-based flow, but retained + tested so an
// auto-login path can be added later without re-deriving the algorithm.

// RFC 4648 base32 (A-Z2-7), uppercase. Whitespace/dashes tolerated, case-insensitive.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decode an RFC 4648 base32 string into a Buffer. No external dependency.
 * Tolerates spaces, dashes, and lowercase input. Throws on truly invalid chars.
 * @param {string} secret
 * @returns {Buffer}
 */
function base32Decode(secret) {
  const cleaned = String(secret).toUpperCase().replace(/[\s-]/g, '');
  if (!cleaned) return Buffer.alloc(0);
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new SyncroLoginError(`Invalid base32 character "${ch}" in TOTP secret`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

/**
 * Generate a 6-digit RFC 6238 TOTP code (30s step, SHA-1) from a base32 secret.
 * Verified against the RFC 6238 Appendix B test vector (T=59 → 287082).
 * @param {string} secretBase32
 * @param {number} [forTime] epoch ms (defaults to now)
 * @returns {string} 6-digit zero-padded code
 */
export function generateTotp(secretBase32, forTime = Date.now()) {
  const key = base32Decode(secretBase32);
  if (key.length === 0) throw new SyncroLoginError('Empty TOTP secret');
  const step = Math.floor(forTime / 1000 / 30);
  // 8-byte big-endian counter
  const counter = Buffer.alloc(8);
  // JS bitwise is 32-bit, so write the high 32 bits via division first
  counter.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  counter.writeUInt32BE(step >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const code = binary % 1000000;
  return String(code).padStart(6, '0');
}

// ─── Credentials ──────────────────────────────────────────────────────────────

const COOKIE_KEY = 'syncro_web_session_cookie';

/**
 * Read the stored session cookie + subdomain. Env var (uppercased key) wins
 * over the settings table, exactly like syncro_api_key.
 * @returns {{cookie:string, subdomain:string}|null}
 */
export function getWebSessionCredentials() {
  const cookie = getSetting(COOKIE_KEY);
  const subdomain = getSetting('syncro_subdomain');
  if (!cookie || !subdomain) return null;
  return { cookie, subdomain };
}

export function areWebSessionCredsConfigured() {
  return getWebSessionCredentials() !== null;
}

/**
 * Normalize a pasted cookie value. Accepts:
 *   - a raw Cookie header string ("name=value; name2=value2")
 *   - a single "name=value" pair
 *   - a cookie value alone (treated as-is)
 * Trims whitespace and collapses repeated separators. Does not validate the
 * cookie name (Syncro's session cookie name varies by instance).
 * @param {string} input
 * @returns {string}
 */
export function normalizeCookie(input) {
  if (!input) return '';
  // Strip a leading "Cookie:" header label if the user pasted the whole header.
  let s = String(input).trim().replace(/^cookie:\s*/i, '');
  // Collapse runs of whitespace and fix "; " separators.
  s = s.replace(/\s*;\s*/g, '; ').replace(/\s{2,}/g, ' ').trim();
  return s;
}

// ─── Session cookie helpers ───────────────────────────────────────────────────

/**
 * Validate a session cookie by hitting the home page and checking we're not
 * bounced back to the login form. Cloudflare is NOT a factor for this check
 * when the cookie is valid — a valid session cookie carries the CF clearance
 * too, so the request goes straight through.
 *
 * @param {{subdomain:string, cookie:string}} args
 * @returns {Promise<{ok:true}|{ok:false, reason:string}>}
 */
export async function validateSessionCookie({ subdomain, cookie }) {
  const base = `https://${subdomain}.syncromsp.com`;
  try {
    const res = await fetch(`${base}/`, {
      headers: {
        'Cookie': cookie,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
      redirect: 'manual',
    });
    const loc = res.headers.get('location') || '';
    // A valid session lands on the dashboard (200) or a same-app redirect.
    // Being sent to /users/sign_in (302→login) means the cookie is expired/invalid.
    if (/\/users\/sign_in/.test(loc)) {
      return { ok: false, reason: 'Cookie expired — Syncro redirected to the login page. Re-export a fresh cookie from your browser.' };
    }
    if (res.status === 401 || res.status === 403) {
      // 403 here likely means Cloudflare is challenging the request — the cookie
      // may lack a valid cf_clearance, or the instance tightened its rules.
      return { ok: false, reason: `Request rejected (HTTP ${res.status}). The cookie may be missing Cloudflare clearance, or it has expired. Re-export the cookie from a logged-in browser session.` };
    }
    // 200 or a non-login redirect = cookie is accepted.
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `Network error validating cookie: ${e.message}` };
  }
}

// ─── Serial → PO scrape ───────────────────────────────────────────────────────

/**
 * Hit the internal serial-history endpoint and extract the PO id.
 *
 * GET /products/{productId}/product_serials/history?sn={serial}
 * Returns an HTML fragment; the PO is referenced as a link to /purchase_orders/{id}.
 * Parser is intentionally a tolerant regex (per hand-off) — exact markup is
 * unverified, so a strict DOM walk would be brittle.
 *
 * @param {{subdomain:string,productId:string|number,serial:string,cookie:string}} args
 * @returns {Promise<{poId:string|null,rawHtmlSnippet:string}>}
 * @throws {SyncroSessionExpired} when the session is bounced (302→login / 401 / 403)
 */
export async function findSerialPoId({ subdomain, productId, serial, cookie }) {
  const base = `https://${subdomain}.syncromsp.com`;
  const url = `${base}/products/${productId}/product_serials/history?sn=${encodeURIComponent(serial)}`;
  const referer = `${base}/products/${productId}/edit?sn=${encodeURIComponent(serial)}`;

  const res = await fetch(url, {
    headers: {
      'Cookie': cookie,
      'Referer': referer,
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,*/*',
    },
    redirect: 'manual',
  });

  const loc = res.headers.get('location') || '';
  if (/\/users\/sign_in/.test(loc) || res.status === 401 || res.status === 403) {
    throw new SyncroSessionExpired('Session cookie expired or unauthorized while reading serial history');
  }

  // A non-redirect, non-200 here is unexpected but not session-related — treat
  // as "no PO found" rather than crashing the serial page.
  if (res.status !== 200) {
    return { poId: null, rawHtmlSnippet: `unexpected status ${res.status}` };
  }

  const html = await res.text().catch(() => '');
  if (!html || /\/users\/sign_in/.test(html)) {
    throw new SyncroSessionExpired('Serial-history endpoint redirected to login');
  }

  // Tolerant: first /purchase_orders/{id} reference in the fragment wins.
  // (The modal may list more than one PO for a serial's history; the first is
  // the received-on PO per the captured UI flow.)
  const match = html.match(/\/purchase_orders\/(\d+)/);
  return {
    poId: match ? match[1] : null,
    rawHtmlSnippet: html.slice(0, 200),
  };
}

// ─── PO attachments (scrape the PO show page) ─────────────────────────────────

/**
 * HTML-decode common entities found in href attributes (Syncro's HTML uses
 * &amp; in the presigned S3 URLs). Minimal — covers what Syncro emits.
 */
function htmlDecode(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

/**
 * Scrape the PO show page for its attachment list.
 *
 * The PO page at /purchase_orders/{id} contains an <table class="attachmentsTable">
 * with one <tr> per attachment. Each row has:
 *   <td>created date</td>
 *   <td><a target="_blank" href="https://attachments.services.syncromsp.com/...?Expires=...">filename</a></td>
 *   <td><a href="/attachments/{id}" data-method="delete">…</a></td>
 *
 * The download URLs are presigned S3 links with an Expires param — they must be
 * downloaded immediately, not stored.
 *
 * @param {{id:number|string, subdomain?:string}} po — needs id; subdomain read from creds if absent
 * @returns {Promise<Array<{id:string|null,fileName:string,downloadUrl:string,createdDate:string}>>}
 * @throws {SyncroSessionExpired} when the session cookie is bounced
 * @throws {SyncroLoginError} when web-session creds aren't configured
 */
export async function fetchPoAttachments(po) {
  const creds = getWebSessionCredentials();
  if (!creds) throw new SyncroLoginError('Web session not configured — paste a cookie in Config → Syncro Web Session');

  const subdomain = po.subdomain || creds.subdomain;
  const base = `https://${subdomain}.syncromsp.com`;
  const url = `${base}/purchase_orders/${po.id}`;

  const res = await fetch(url, {
    headers: {
      'Cookie': creds.cookie,
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,*/*',
      'Referer': `${base}/purchase_orders`,
    },
    redirect: 'manual',
  });

  const loc = res.headers.get('location') || '';
  if (/\/users\/sign_in/.test(loc) || res.status === 401 || res.status === 403) {
    throw new SyncroSessionExpired('Session cookie expired while reading PO attachments');
  }
  if (res.status !== 200) {
    return []; // unexpected status — treat as "no attachments"
  }

  const html = await res.text().catch(() => '');
  if (!html || /\/users\/sign_in/.test(html)) {
    throw new SyncroSessionExpired('PO show page redirected to login');
  }

  // Extract the attachmentsTable tbody. If not present, the PO has no attachments.
  const tableMatch = html.match(/<table[^>]*class="[^"]*attachmentsTable[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return [];

  const tableHtml = tableMatch[1];

  // Parse each <tr> in the tbody. Each row has 3 <td>s:
  //   [0] created date, [1] the download <a>, [2] the delete <a> with /attachments/{id}
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const attachments = [];
  for (const rowMatch of rows) {
    const rowHtml = rowMatch[1];
    // Extract all <td> cells
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cells.length < 2) continue; // skip header rows / malformed

    const createdDate = cells[0][1].replace(/<[^>]*>/g, '').trim();

    // The download link: <a ... href="https://attachments.services.syncromsp.com/...">
    const dlMatch = cells[1][1].match(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!dlMatch) continue;
    const downloadUrl = htmlDecode(dlMatch[1]);
    // The link text is often truncated by Syncro ("filename..."). The full
    // filename with extension is in the S3 URL path after /file/{id}/.
    // Prefer that; fall back to the link text.
    let fileName = '';
    const urlPathMatch = downloadUrl.match(/\/file\/\d+\/([^?]+)/);
    if (urlPathMatch) {
      try { fileName = decodeURIComponent(urlPathMatch[1]); } catch (_) { fileName = urlPathMatch[1]; }
    }
    if (!fileName) {
      fileName = htmlDecode(dlMatch[2].replace(/<[^>]*>/g, '').trim());
    }
    if (!fileName) fileName = 'attachment';

    // The attachment id from the delete link: /attachments/{id}
    let attId = null;
    if (cells[2]) {
      const delMatch = cells[2][1].match(/\/attachments\/(\d+)/);
      if (delMatch) attId = delMatch[1];
    }

    attachments.push({ id: attId, fileName, downloadUrl, createdDate });
  }

  return attachments;
}

// ─── Orchestrator (used by the serials endpoint) ──────────────────────────────

/**
 * Resolve the purchase order a serial was received on.
 *
 * Never throws — returns a result object so the serials endpoint stays 200 and
 * the serial page still renders even when the lookup fails.
 *
 * @param {{serial:{product_id:number|string,id:number|string,serial_number:string},product?:{id:number|string}|null}} ctx
 * @returns {Promise<{po:object|null,poId:string|null,reason:string,error?:string}>}
 *   reason ∈ 'ok' | 'not_configured' | 'no_product' | 'no_po' | 'expired' | 'error'
 */
export async function resolveSerialPo(ctx) {
  const creds = getWebSessionCredentials();
  if (!creds) return { po: null, poId: null, reason: 'not_configured' };

  const productId = ctx?.product?.id ?? ctx?.serial?.product_id;
  if (!productId) return { po: null, poId: null, reason: 'no_product' };
  const serial = ctx?.serial?.serial_number;
  if (!serial) return { po: null, poId: null, reason: 'error', error: 'Serial record has no serial_number' };

  let found;
  try {
    found = await findSerialPoId({
      subdomain: creds.subdomain,
      productId,
      serial,
      cookie: creds.cookie,
    });
  } catch (e) {
    if (e instanceof SyncroSessionExpired) {
      // The pasted cookie has expired — tell the UI to re-paste. No retry is
      // possible without a fresh cookie (there's no auto-login path).
      return { po: null, poId: null, reason: 'expired', error: e.message };
    }
    return { po: null, poId: null, reason: 'error', error: e.message };
  }

  if (!found.poId) return { po: null, poId: null, reason: 'no_po' };

  // Enrich via the public API (the supported path) using the API key.
  try {
    const apiKey = getSetting('syncro_api_key');
    if (!apiKey) {
      // No API key — return what we have (just the id).
      return { po: { id: Number(found.poId) }, poId: found.poId, reason: 'ok' };
    }
    const resp = await fetch(`https://${creds.subdomain}.syncromsp.com/api/v1/purchase_orders/${found.poId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    });
    if (!resp.ok) {
      return { po: { id: Number(found.poId) }, poId: found.poId, reason: 'ok', error: `PO fetch HTTP ${resp.status}` };
    }
    const data = await resp.json();
    const po = data.purchase_order || data;
    return { po, poId: found.poId, reason: 'ok' };
  } catch (e) {
    return { po: { id: Number(found.poId) }, poId: found.poId, reason: 'ok', error: e.message };
  }
}
