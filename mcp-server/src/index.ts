/**
 * MCP server entry point.
 *
 * Boots an Express server exposing the MCP Streamable HTTP transport at
 * `/mcp`. The server is stateless (no session tracking) — every request gets a
 * fresh transport + McpServer pair wired to the same registered tools, which is
 * the SDK-recommended pattern for a stateless request/response service like this
 * one (we hold no per-session state; each tool call is an independent backend
 * GET).
 *
 * Auth is two-layered:
 *   - Client → here   : Bearer MCP_API_TOKEN  (validated by middleware below)
 *   - Here   → backend: Bearer SYNCNO_API_KEY (added by backend-client.ts)
 */

import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from './config.js';
import { registerAllTools } from './registry.js';
import { extractBearer, timingSafeEqualString } from './auth.js';

const app = express();
app.use(express.json());

/**
 * Bearer-token auth for the MCP endpoint. Constant-time compare so a timing
 * probe can't recover MCP_API_TOKEN byte by byte.
 */
app.use('/mcp', (req, res, next) => {
  const token = extractBearer(req.headers.authorization);
  if (!token || !timingSafeEqualString(token, config.mcpApiToken)) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
});

/**
 * Handle a single MCP request against a freshly built stateless server.
 * Each call is independent: new transport, new McpServer, same tool registry.
 *
 * Order matters (per the SDK example): register tools → connect the server to
 * the transport → hand the request to the transport. Connecting first ensures
 * the transport has someone to deliver responses back through.
 */
async function handleMcpRequest(req: express.Request, res: express.Response): Promise<void> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = new McpServer({
    name: 'syncno-mcp',
    version: '1.0.0',
  });

  registerAllTools(server);
  await server.connect(transport);

  try {
    await transport.handleRequest(req as never, res as never, req.body);
  } catch (err) {
    console.error('[mcp] handleRequest failed:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
}

// The spec's Streamable HTTP transport is POST-centric. GET is for optional SSE
// notifications (we don't push any), so we accept POST and reply to GET/DELETE
// with the documented stateless behavior.
app.post('/mcp', (req, res) => {
  handleMcpRequest(req, res).catch((err) => {
    console.error('[mcp] request failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
  });
});

// Stateless servers don't maintain SSE streams; tell clients there's none here.
app.get('/mcp', (_req, res) => {
  res.status(405).set('Allow', 'POST').json({ error: 'SSE streaming not supported; use POST.' });
});

app.delete('/mcp', (_req, res) => {
  // Stateless: nothing to tear down. Acknowledge so clients can clean up.
  res.status(200).json({ ok: true });
});

// Liveness probe — no auth, mirrors the backend's /api/health contract.
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(config.port, () => {
  console.log(`SyncNo MCP server (Streamable HTTP) on http://0.0.0.0:${config.port}/mcp`);
  console.log(`Backend: ${config.backendUrl}`);
});
