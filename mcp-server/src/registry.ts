/**
 * Central registration: wires every tool family onto one McpServer instance.
 * Keeping this in one place means `index.ts` only decides transport + auth.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerEntityTools } from './tools/entities.js';
import { registerSearchTool } from './tools/search.js';
import { registerRelationshipTools } from './tools/relationships.js';
import { registerInfoTools } from './tools/info.js';

export function registerAllTools(server: McpServer): void {
  registerSearchTool(server);
  registerEntityTools(server);
  registerRelationshipTools(server);
  registerInfoTools(server);
}
