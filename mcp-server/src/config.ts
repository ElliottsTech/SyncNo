/**
 * Centralized configuration. All values come from the environment so the
 * server is stateless and 12-factor friendly.
 *
 * Secrets are read LAZILY (via getters) so that merely importing this module
 * never throws — only actually using a secret at runtime does. This keeps tests
 * and tooling that import the code (but never call the backend) free of env
 * requirements.
 *
 * Two secrets are in play:
 *   - SYNCNO_API_KEY  : reused to authenticate THIS server against the SyncNo
 *                       backend (it is tagged role:'service' there).
 *   - MCP_API_TOKEN   : the secret LLM clients present to THIS server. Kept
 *                       separate from SYNCNO_API_KEY so the backend service
 *                       secret is never handed to an LLM client.
 */

const required = (name: string): string => {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
};

export const config = {
  /** Base URL of the SyncNo backend REST API (no trailing slash). */
  get backendUrl(): string {
    return (process.env.BACKEND_URL || 'http://localhost:3002').replace(/\/+$/, '');
  },
  /** Bearer key authenticating us to the backend as a service caller. */
  get syncnoApiKey(): string {
    return required('SYNCNO_API_KEY');
  },
  /** Bearer token LLM clients must present to reach this MCP server. */
  get mcpApiToken(): string {
    return required('MCP_API_TOKEN');
  },
  /** Port this MCP server listens on. */
  get port(): number {
    return Number(process.env.MCP_PORT || 3003);
  },
  /** Per-backend-request timeout in ms. */
  get backendTimeoutMs(): number {
    return Number(process.env.MCP_BACKEND_TIMEOUT_MS || 15000);
  },
};

/** Maximum number of rows a single tool call may request, regardless of input. */
export const MAX_LIMIT = 50;
/** Default page size when the caller omits `limit`. */
export const DEFAULT_LIMIT = 25;
