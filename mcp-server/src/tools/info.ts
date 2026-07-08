/**
 * Informational read tools — operational status that carries no secrets.
 *
 * All three hit `any`-auth endpoints (readable by the service key) and return
 * deliberately non-sensitive data: sync progress flags + last sync time, last
 * per-entity sync result counts, and the installed-vs-latest version. They are
 * the only non-entity reads exposed; everything admin-only (credentials,
 * backup config, user management, audit logs) is intentionally omitted.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { backendGet } from '../backend-client.js';
import { errorResult } from './entities.js';

export function registerInfoTools(server: McpServer): void {
  server.registerTool(
    'get_sync_status',
    {
      description:
        'Syncro/Entra configuration flags + last sync time + URLs. No secrets. Useful to check whether a sync is configured and when it last ran.',
      inputSchema: {},
    },
    async () => {
      try {
        const result = await backendGet('sync/status');
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'get_sync_last_results',
    {
      description:
        'Per-entity last sync result: counts, errors, and current DB row counts. Useful for diagnosing whether data is fresh.',
      inputSchema: {},
    },
    async () => {
      try {
        const result = await backendGet('sync/last-results');
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'get_system_version',
    {
      description: 'Installed SyncNo version vs latest published GitHub tag, and whether an update is available.',
      inputSchema: {
        refresh: z
          .boolean()
          .optional()
          .describe('Bypass the 30s version cache (rarely needed).'),
      },
    },
    async ({ refresh }) => {
      try {
        const result = await backendGet('system/version', refresh ? { refresh: 'true' } : {});
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
