/**
 * Cross-entity search tool — the front door for discovery.
 *
 * Wraps `GET /api/search?q=<term>&type=<csv>`, which searches 14 entity types
 * at once and returns normalized rows: { id, type, title, subtitle, status,
 * date, customer, ...rawFields }. The LLM should reach for this first when
 * looking something up by name/number/email, then use the get_<entity> /
 * relationship tools to drill in.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { backendGet } from '../backend-client.js';
import { errorResult } from './entities.js';

// Must mirror ALL_TYPES in backend/src/routes/search.js.
const SEARCH_TYPES = [
  'customer',
  'ticket',
  'ticket_comment',
  'invoice',
  'product',
  'vendor',
  'serial',
  'appointment',
  'contract',
  'lead',
  'portal_user',
  'syncro_user',
  'wiki_page',
  'schedule',
] as const;

export function registerSearchTool(server: McpServer): void {
  server.registerTool(
    'search',
    {
      description:
        'Cross-entity search across customers, tickets, ticket comments, invoices, products, vendors, serials, appointments, contracts, leads, portal users, syncro users, wiki pages, and schedules. Use this FIRST to find records by name, number, email, or any text. Returns normalized hits: { id, type, title, subtitle, status, date, customer }. Then call get_<type> or a relationship tool to drill in.',
      inputSchema: {
        q: z
          .string()
          .min(2)
          .describe('Search term (at least 2 characters). Matched as a substring.'),
        type: z
          .string()
          .optional()
          .describe(
            `Optional comma-separated list to restrict the types searched. Valid: ${SEARCH_TYPES.join(', ')}. Omit to search all.`,
          ),
      },
    },
    async ({ q, type }) => {
      try {
        const result = await backendGet<{ data: unknown[]; types: string[] }>('search', { q, type });
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ data: result.data, types: result.types }) },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
