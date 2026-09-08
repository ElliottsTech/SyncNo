/**
 * QuickBooks Online credentials + OAuth2 Connect flow.
 *
 * Two layers:
 *   - App credentials (client ID/secret/environment) — static, pasted once by
 *     the admin. POST /save.
 *   - Connection (realmId + refresh token) — obtained via the in-app "Connect
 *     to QuickBooks" button (full OAuth2 authorization-code flow):
 *       GET /connect   → redirect to Intuit consent screen (admin clicks this)
 *       GET /callback  → Intuit redirects back here with an auth code; backend
 *                        exchanges it for tokens. PUBLIC (no session — Intuit
 *                        can't carry our session cookie).
 *       POST /disconnect → drop the connection (app creds stay).
 *
 * Persisted the same way Syncro/Azure/web-session credentials are: written to
 * the `settings` table, hot-patched into `process.env`, and rewritten into
 * `.env` so they survive restarts. See lib/qboClient.js for the OAuth details.
 */

import { Router } from 'express';
import path from 'path';
import { isDemo, demoNoop } from '../demo.js';
import { getSetting, setSetting, mask, updateEnvFile } from '../lib/settings.js';
import {
  getQboConfig,
  getQboAppCredentials,
  getQboConnection,
  getValidAccessToken,
  invalidateToken,
  hasQboAppCredentials,
  isQboConfigured,
  buildAuthUrl,
  exchangeAuthCode,
  consumeState,
  disconnect,
  getRedirectUri,
} from '../lib/qboClient.js';

const router = Router();

// Service key (Bearer SYNCNO_API_KEY) is admin-equivalent — same rule as sync.js.
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ') && auth.slice(7) === process.env.SYNCNO_API_KEY) {
    return next();
  }
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

const ENV_KEY = 'qbo_environment';
const CID_KEY = 'qbo_client_id';
const SECRET_KEY = 'qbo_client_secret';
const REALM_KEY = 'qbo_realm_id';
const REFRESH_KEY = 'qbo_refresh_token';

// Where the browser lands after the OAuth callback completes (success or error).
// Routed through the Next.js proxy → this is a frontend path, not a backend one.
const POST_CONNECT_REDIRECT = '/settings/config?qbo_connect=1';

/**
 * GET /api/qbo-settings
 * Returns app-credential status + connection status + masked values + the
 * redirect URI to register on the Intuit app. Secrets are never returned.
 */
router.get('/', requireAdmin, (req, res) => {
  const environment = getSetting(ENV_KEY) || 'sandbox';
  const clientId = getSetting(CID_KEY);
  const clientSecret = getSetting(SECRET_KEY);
  const realmId = getSetting(REALM_KEY);
  const refreshToken = getSetting(REFRESH_KEY);
  res.json({
    // App creds present (Connect is possible):
    appConfigured: Boolean(clientId && clientSecret),
    // Fully connected (app creds + a company authorized — ready to call API):
    configured: Boolean(clientId && clientSecret && realmId && refreshToken),
    connected: Boolean(realmId && refreshToken),
    environment,
    clientId: clientId || null,
    clientIdMasked: mask(clientId),
    clientSecretExists: Boolean(clientSecret),
    realmId: realmId || null,
    refreshTokenExists: Boolean(refreshToken),
    refreshTokenMasked: mask(refreshToken),
    redirectUri: getRedirectUri(),
  });
});

/**
 * POST /api/qbo-settings/save
 * Body: { environment?, clientId?, clientSecret? }
 * Saves the Intuit *app* credentials only (static). The realmId + refresh token
 * are obtained via the Connect button, never pasted. Empty fields inherit the
 * existing value (so the masked secret field doesn't blank what's stored).
 */
router.post('/save', requireAdmin, (req, res) => {
  if (isDemo()) return demoNoop(req, res);

  const { environment, clientId, clientSecret } = req.body || {};
  const finalEnv = environment || getSetting(ENV_KEY) || 'sandbox';
  const finalCid = clientId || getSetting(CID_KEY);
  const finalSecret = clientSecret || getSetting(SECRET_KEY);

  if (!finalCid || !finalSecret) {
    return res.status(400).json({ error: 'clientId and clientSecret are required' });
  }

  // 1. settings table
  setSetting(ENV_KEY, finalEnv);
  setSetting(CID_KEY, finalCid);
  setSetting(SECRET_KEY, finalSecret);
  // 2. hot-patch the running process
  process.env.QBO_ENVIRONMENT = finalEnv;
  process.env.QBO_CLIENT_ID = finalCid;
  process.env.QBO_CLIENT_SECRET = finalSecret;
  // 3. persist to .env so it survives restarts
  let envWritten = false;
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    updateEnvFile(envPath, {
      QBO_ENVIRONMENT: finalEnv,
      QBO_CLIENT_ID: finalCid,
      QBO_CLIENT_SECRET: finalSecret,
    });
    envWritten = true;
  } catch (e) {
    console.error('[qbo-settings] failed to write .env:', e.message);
  }

  // A cred change invalidates any cached access token.
  invalidateToken();

  res.json({
    appConfigured: true,
    configured: isQboConfigured(),
    environment: finalEnv,
    clientId: finalCid,
    clientIdMasked: mask(finalCid),
    clientSecretExists: true,
    redirectUri: getRedirectUri(),
    envWritten,
  });
});

/**
 * GET /api/qbo-settings/connect
 * Begins the OAuth2 authorization-code flow. Redirects the admin's browser to
 * Intuit's consent screen. A random `state` is embedded for CSRF protection.
 * Requires app credentials to be saved first.
 */
router.get('/connect', requireAdmin, (req, res) => {
  if (!hasQboAppCredentials()) {
    return res.status(400).json({ error: 'Save your QuickBooks app credentials (Client ID + Secret) first.' });
  }
  const built = buildAuthUrl();
  if (!built) {
    return res.status(400).json({ error: 'Could not build the OAuth URL. Is NEXTAUTH_URL set?' });
  }
  res.redirect(built.url);
});

/**
 * GET /api/qbo-settings/callback
 * OAuth2 redirect endpoint — Intuit sends the browser here with ?code=...&state=...&realmId=...
 * PUBLIC (no session): Intuit's redirect is a fresh browser navigation that
 * cannot carry our NextAuth session cookie. The CSRF `state` token (validated
 * against the in-memory set populated by /connect) is the security boundary.
 *
 * Exchanges the auth code for tokens, persists the connection, then redirects
 * the browser back to the Config page with a result flag.
 */
router.get('/callback', async (req, res) => {
  const { code, state, realmId, error, error_description } = req.query;

  // Intuit can redirect back with an error (e.g. user denied consent).
  if (error) {
    const msg = error_description || error;
    return res.redirect(`${POST_CONNECT_REDIRECT}&qbo_error=${encodeURIComponent(msg)}`);
  }

  if (!code || !realmId) {
    return res.redirect(`${POST_CONNECT_REDIRECT}&qbo_error=${encodeURIComponent('Missing code or realmId in OAuth callback')}`);
  }
  // CSRF: the state must match one we issued in /connect.
  if (!consumeState(state)) {
    return res.redirect(`${POST_CONNECT_REDIRECT}&qbo_error=${encodeURIComponent('Invalid or expired OAuth state (CSRF check failed). Try Connect again.')}`);
  }

  try {
    await exchangeAuthCode(code, realmId);
    res.redirect(`${POST_CONNECT_REDIRECT}&qbo_ok=1`);
  } catch (e) {
    res.redirect(`${POST_CONNECT_REDIRECT}&qbo_error=${encodeURIComponent(e.message || String(e))}`);
  }
});

/**
 * POST /api/qbo-settings/disconnect
 * Drops the stored connection (realmId + refresh token). The Intuit app creds
 * remain so the admin can re-Connect. Does NOT revoke access at Intuit (the
 * admin can do that from the Intuit app's connected-apps page if desired).
 */
router.post('/disconnect', requireAdmin, (req, res) => {
  if (isDemo()) return demoNoop(req, res);
  disconnect();
  res.json({ connected: false, configured: isQboConfigured() });
});

/**
 * POST /api/qbo-settings/test
 * Forces a token refresh, proving the connection works end-to-end against QBO.
 * Returns { ok, message } or { ok:false, error }.
 */
router.post('/test', requireAdmin, async (req, res) => {
  if (isDemo()) {
    return res.json({ ok: false, error: 'QuickBooks Online test not available in demo mode' });
  }
  if (!isQboConfigured()) {
    return res.json({ ok: false, error: 'QuickBooks Online is not connected. Save app credentials, then click Connect.' });
  }
  try {
    invalidateToken();
    const cfg = getQboConfig();
    await getValidAccessToken();
    invalidateToken();
    res.json({
      ok: true,
      message: `Connected to QBO (${cfg.environment}) — realm ${cfg.realmId}. Token refreshed successfully.`,
    });
  } catch (e) {
    res.json({ ok: false, error: e.message || String(e) });
  }
});

export default router;
