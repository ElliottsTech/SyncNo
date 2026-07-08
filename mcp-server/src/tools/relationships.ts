/**
 * Relationship tools — drill-down fetchers for the hub entities.
 *
 * These wrap the backend's nested `/:id/<relation>` endpoints (e.g.
 * `/api/customers/123/tickets`, `/api/tickets/456/comments`). They let the LLM
 * traverse from a record to its related records in one call, reusing the
 * backend's joins/enrichment rather than reconstructing them client-side.
 *
 * Declared as a table and registered in a loop, mirroring the entity factory.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { backendGet, type Paginated } from '../backend-client.js';
import { errorResult } from './entities.js';

interface RelationSpec {
  /** Tool name, e.g. get_customer_tickets. */
  name: string;
  /** Full REST path template under /api/, with {id} placeholder. */
  pathTemplate: string;
  /** What the relation returns. */
  description: string;
  /** True if the endpoint is paginated (takes page/limit). */
  paginated?: boolean;
  /** Extra substring filters the endpoint honors (without filter_ prefix). */
  filters?: string[];
}

const RELATIONS: RelationSpec[] = [
  // ---- customer hub ----
  { name: 'get_customer_contacts', pathTemplate: 'customers/{id}/contacts', description: 'Contacts for a customer.' },
  {
    name: 'get_customer_tickets',
    pathTemplate: 'customers/{id}/tickets',
    description: 'Tickets for a customer (paginated).',
    paginated: true,
  },
  { name: 'get_customer_assets', pathTemplate: 'customers/{id}/assets', description: 'Assets/devices for a customer.' },
  { name: 'get_customer_invoices', pathTemplate: 'customers/{id}/invoices', description: 'Invoices for a customer.' },
  { name: 'get_customer_estimates', pathTemplate: 'customers/{id}/estimates', description: 'Estimates for a customer.' },
  { name: 'get_customer_payments', pathTemplate: 'customers/{id}/payments', description: 'Payments for a customer.' },
  { name: 'get_customer_schedules', pathTemplate: 'customers/{id}/schedules', description: 'Recurring schedules for a customer.' },
  { name: 'get_customer_policies', pathTemplate: 'customers/{id}/policies', description: 'Policy folder tree (folders hierarchy + derived groups from assets) for a customer.' },

  // ---- ticket hub ----
  { name: 'get_ticket_comments', pathTemplate: 'tickets/{id}/comments', description: 'Comments/history for a ticket.' },
  { name: 'get_ticket_time_entries', pathTemplate: 'tickets/{id}/time_entries', description: 'Time entries for a ticket.' },
  { name: 'get_ticket_line_items', pathTemplate: 'tickets/{id}/line_items', description: 'Line items for a ticket, joined with products + serials.' },
  { name: 'get_ticket_invoices', pathTemplate: 'tickets/{id}/invoices', description: 'Invoices linked to a ticket.' },
  { name: 'get_ticket_estimates', pathTemplate: 'tickets/{id}/estimates', description: 'Estimates linked to a ticket.' },
  { name: 'get_ticket_appointments', pathTemplate: 'tickets/{id}/appointments', description: 'Appointments linked to a ticket.' },
  { name: 'get_ticket_worksheets', pathTemplate: 'tickets/{id}/worksheet_results', description: 'Worksheet results for a ticket.' },

  // ---- invoice hub ----
  { name: 'get_invoice_payments', pathTemplate: 'invoices/{id}/payments', description: 'Payments applied to an invoice (matched via invoice_ids).' },
  { name: 'get_invoice_ticket', pathTemplate: 'invoices/{id}/ticket', description: 'The ticket an invoice originated from ({ ticket_id, ticket }).' },

  // ---- vendor hub ----
  { name: 'get_vendor_purchase_orders', pathTemplate: 'vendors/{id}/purchase_orders', description: 'Purchase orders for a vendor.' },

  // ---- product hub ----
  { name: 'get_product_tickets', pathTemplate: 'products/{id}/tickets', description: 'Tickets whose line items reference a product.' },
];

/** Register every relationship tool. */
export function registerRelationshipTools(server: McpServer): void {
  for (const rel of RELATIONS) {
    const shape: Record<string, z.ZodTypeAny> = {
      id: z.string().describe('The id of the parent (hub) record.'),
    };
    if (rel.paginated) {
      shape.page = z.number().int().min(1).optional().describe('1-based page number (default 1).');
      shape.limit = z.number().int().min(1).max(50).optional().describe('Rows per page (max 50).');
    }

    const handler = async (args: Record<string, unknown>) => {
      const path = rel.pathTemplate.replace('{id}', encodeURIComponent(String(args.id)));
      const query: Record<string, unknown> = {};
      if (rel.paginated) {
        const limit = Number(args.limit ?? 25);
        query.limit = Math.min(Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 25, 50);
        query.page = Number(args.page ?? 1);
      }
      try {
        const result = await backendGet(path, query);
        // Some nested endpoints return a bare array; wrap for a stable shape.
        const body = Array.isArray(result) || (rel.paginated && !isPaginated(result)) ? { data: result } : result;
        return { content: [{ type: 'text' as const, text: JSON.stringify(body) }] };
      } catch (err) {
        return errorResult(err);
      }
    };

    server.registerTool(rel.name, { description: rel.description, inputSchema: shape }, handler);
  }

  // Special-case: serial lookup uses the serial STRING as the path param, not an id.
  server.registerTool(
    'lookup_serial',
    {
      description:
        'Look up an item by its serial number (case-insensitive). Returns the serial record plus linked product/ticket/invoice/estimate/asset. The input is the serial string itself, not an id.',
      inputSchema: {
        serial: z.string().describe('The serial number string to look up.'),
      },
    },
    async ({ serial }) => {
      try {
        const result = await backendGet(`serials/${encodeURIComponent(serial)}`);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

/** Type guard for the backend paginated envelope. */
function isPaginated(v: unknown): v is Paginated<unknown> {
  return !!v && typeof v === 'object' && 'pagination' in (v as Record<string, unknown>);
}
