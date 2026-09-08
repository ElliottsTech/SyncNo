/**
 * Syncro web-session credentials — admin endpoints to store the technician
 * session cookie used by the serial→PO lookup.
 *
 * Why this exists: SyncroMSP's public API cannot resolve a serial number to
 * the purchase order it was received on. That relationship is only exposed by
 * the web app's internal serial-history endpoint, which needs an authenticated
 * *session cookie* (not the API key).
 *
 * Auth model: PASTED SESSION COOKIE.
 *   Syncro's web app is behind Cloudflare, which issues a managed challenge to
 *   datacenter IPs and blocks server-side login (fetch + headless puppeteer
 *   both defeated). So the admin exports a valid session cookie from their own
 *   browser (where CF already lets them through) and pastes it here. The
 *   backend uses that cookie directly. The cookie expires (hours-to-days); the
 *   /test endpoint detects expiry and tells the admin to re-paste.
 *
 * Persisted the same way Syncro/Azure/MCP credentials are: written to the
 * `settings` table, hot-patched into `process.env`, and rewritten into `.env`.
 * See lib/syncroSession.js for the lookup flow + handoff-serial-to-po.md.
 */

import { Router } from 'express';
import path from 'path';
import { isDemo, demoNoop } from '../demo.js';
import { getSetting, setSetting, mask, updateEnvFile } from '../lib/settings.js';
import {
  getWebSessionCredentials,
  validateSessionCookie,
  normalizeCookie,
} from '../lib/syncroSession.js';

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

const COOKIE_KEY = 'syncro_web_session_cookie';

/**
 * GET /api/sync/web-session
 * Returns configured status + a masked preview of the stored cookie. The full
 * cookie is never returned — it's a live session secret.
 */
router.get('/', requireAdmin, (req, res) => {
  const cookie = getSetting(COOKIE_KEY);
  const subdomain = getSetting('syncro_subdomain');
  res.json({
    configured: Boolean(cookie && subdomain),
    subdomain: subdomain || null,
    // Show a short masked preview so the admin can tell *a* cookie is stored
    // without exposing the live session secret.
    cookieMasked: cookie ? mask(cookie) : null,
    cookieExists: Boolean(cookie),
  });
});

/**
 * POST /api/sync/web-session/save
 * Body: { cookie }
 * Stores the pasted session cookie (normalized). Empty cookie clears it.
 */
router.post('/save', requireAdmin, (req, res) => {
  if (isDemo()) return demoNoop(req, res);

  const { cookie } = req.body || {};
  const finalCookie = cookie ? normalizeCookie(cookie) : '';

  if (!finalCookie) {
    // Clear the stored cookie.
    setSetting(COOKIE_KEY, '');
    delete process.env.SYNCRO_WEB_SESSION_COOKIE;
    try {
      const envPath = path.resolve(process.cwd(), '.env');
      updateEnvFile(envPath, { SYNCRO_WEB_SESSION_COOKIE: '' });
    } catch (e) { console.error('[sync-web-session] failed to write .env:', e.message); }
    return res.json({ configured: false, subdomain: getSetting('syncro_subdomain') || null, cookieMasked: null, cookieExists: false });
  }

  // 1. settings table
  setSetting(COOKIE_KEY, finalCookie);
  // 2. hot-patch the running process
  process.env.SYNCRO_WEB_SESSION_COOKIE = finalCookie;
  // 3. persist to .env so it survives restarts
  let envWritten = false;
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    updateEnvFile(envPath, { SYNCRO_WEB_SESSION_COOKIE: finalCookie });
    envWritten = true;
  } catch (e) {
    console.error('[sync-web-session] failed to write .env:', e.message);
  }

  res.json({
    configured: true,
    subdomain: getSetting('syncro_subdomain') || null,
    cookieMasked: mask(finalCookie),
    cookieExists: true,
    envWritten,
  });
});

/**
 * POST /api/sync/web-session/test
 * Validates the stored session cookie by hitting the Syncro home page and
 * checking it isn't bounced to the login form. Returns { ok, message } or
 * { ok:false, error } — the shape the frontend's test-result panel expects.
 */
router.post('/test', requireAdmin, async (req, res) => {
  if (isDemo()) {
    return res.json({ ok: false, error: 'Web-session test not available in demo mode' });
  }
  const creds = getWebSessionCredentials();
  if (!creds) {
    return res.json({ ok: false, error: 'No session cookie configured — paste one from a logged-in Syncro browser session.' });
  }
  try {
    const result = await validateSessionCookie(creds);
    if (result.ok) {
      res.json({ ok: true, message: 'Session cookie is valid — Syncro accepted it.' });
    } else {
      res.json({ ok: false, error: result.reason });
    }
  } catch (e) {
    res.json({ ok: false, error: e.message || String(e) });
  }
});

export default router;
