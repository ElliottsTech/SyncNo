/**
 * MCP server settings — admin endpoints to inspect and rotate the
 * `MCP_API_TOKEN` that LLM clients present to the MCP server.
 *
 * Two-layer auth context:
 *   - LLM client → MCP server : Bearer MCP_API_TOKEN   (this is what we rotate here)
 *   - MCP server → backend    : Bearer SYNCNO_API_KEY  (the service key; read-only here)
 *
 * The token is persisted the same way Syncro/Azure credentials are: written to
 * the `settings` table, hot-patched into `process.env`, and rewritten into the
 * `.env` file so it survives restarts and is picked up by `docker compose` on
 * the next deploy. Because the MCP server is a separate process that reads its
 * env at startup, rotating the token requires restarting the `mcp-server`
 * container/service — surfaced to the UI via `restartRequired`.
 */

import { Router } from 'express';
import { randomBytes } from 'crypto';
import path from 'path';
import { isDemo, demoNoop } from '../demo.js';
import { getSetting, setSetting, mask, updateEnvFile } from '../lib/settings.js';

const router = Router();

// Service key (Bearer SYNCNO_API_KEY) is admin-equivalent — same rule as sync.js,
// so an MCP service caller can read its own status.
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ') && auth.slice(7) === process.env.SYNCNO_API_KEY) {
    return next();
  }
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

/** The setting key under which the token is stored in the `settings` table. */
const MCP_TOKEN_KEY = 'mcp_api_token';

/**
 * Best guess at the externally-reachable base URL, derived from NEXTAUTH_URL
 * (the configured public origin). Falls back to null so the UI can show a
 * placeholder.
 */
function publicHost() {
  const nau = process.env.NEXTAUTH_URL;
  if (!nau) return null;
  try {
    const u = new URL(nau);
    return `${u.protocol}//${u.host}`;
  } catch {
  }
  return null;
}

/**
 * The public MCP endpoint URL. The mcp-server container is NOT published — LLM
 * clients reach it through the frontend's /mcp proxy, which forwards to the
 * internal mcp-server container over the Docker network. So the client-facing
 * URL is just `<publicHost>/mcp`, on the same host/port as the rest of the app.
 * Returns null when the public host isn't known (NEXTAUTH_URL unset).
 */
function publicMcpUrl() {
  const host = publicHost();
  return host ? `${host}/mcp` : null;
}

/**
 * GET /api/mcp-settings
 * Returns everything the settings UI needs to render: the current token
 * (plaintext — this is an admin-only endpoint, mirroring /api/sync/credentials),
 * a masked version for safe display, the read-only backend service key (masked),
 * the configured MCP port, and the public host used to build client URLs.
 */
router.get('/', requireAdmin, (req, res) => {
  const token = getSetting(MCP_TOKEN_KEY);
  const syncnoApiKey = process.env.SYNCNO_API_KEY || getSetting('syncro_api_key');
  res.json({
    mcpApiToken: token || null,
    mcpApiTokenMasked: mask(token),
    mcpApiTokenExists: Boolean(token),
    syncnoApiKeyMasked: mask(syncnoApiKey),
    syncnoApiKeyExists: Boolean(syncnoApiKey),
    mcpPort: Number(process.env.MCP_PORT || 3003),
    backendUrl: process.env.BACKEND_URL || 'http://localhost:3002',
    publicHost: publicHost(),
    mcpUrl: publicMcpUrl(),
  });
});

/**
 * POST /api/mcp-settings/generate
 * Generate a fresh random MCP_API_TOKEN (base64, ~44 chars — matches the
 * documented `openssl rand -base64 32` shape) and persist it to the settings
 * table, process.env, and the .env file. Returns the plaintext token once.
 */
router.post('/generate', requireAdmin, (req, res) => {
  if (isDemo()) return demoNoop(req, res);

  const token = randomBytes(32).toString('base64');

  // 1. settings table
  setSetting(MCP_TOKEN_KEY, token);
  // 2. hot-patch the running backend process
  process.env.MCP_API_TOKEN = token;
  // 3. persist to .env so docker compose / the mcp-server container re-read it
  let envWritten = false;
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    updateEnvFile(envPath, { MCP_API_TOKEN: token });
    envWritten = true;
  } catch (e) {
    console.error('[mcp-settings] failed to write .env:', e.message);
  }

  res.json({
    mcpApiToken: token,
    mcpApiTokenMasked: mask(token),
    mcpApiTokenExists: true,
    envWritten,
    restartRequired: true,
  });
});

export default router;
