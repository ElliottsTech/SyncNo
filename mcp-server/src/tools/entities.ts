/**
 * Entity factory: turns each `EntitySpec` in `schemas.ts` into a pair of
 * well-named, self-describing MCP tools — `list_<entity>` and `get_<entity>` —
 * registered on the given server.
 *
 * Why a factory: the backend exposes ~18 read entities with a uniform
 * list/detail contract (pagination, column filters, sort allowlist). Generating
 * the tools from a declaration table keeps the surface consistent, the schemas
 * accurate, and lets the LLM discover valid filters/sorts directly from the
 * tool input schema.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { backendGet, type Paginated } from '../backend-client.js';
import { DEFAULT_LIMIT, MAX_LIMIT } from '../config.js';
import { ENTITIES, type EntitySpec } from '../schemas.js';

/** Pluralize a tool suffix crudely but acceptably for tool names. */
function plural(entity: string): string {
  if (entity.endsWith('y')) return entity.slice(0, -1) + 'ies';
  if (entity.endsWith('s')) return entity + 'es';
  return entity + 's';
}

/** Cap the caller's requested page size to MAX_LIMIT, default to DEFAULT_LIMIT. */
function clampLimit(raw: number | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

/**
 * Build the Zod input shape for a `list_<entity>` tool from an EntitySpec:
 * page/limit/search, one optional field per filter (substring match), and
 * sortCol constrained to the backend's allowlist.
 */
function buildListShape(spec: EntitySpec): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {
    page: z.number().int().min(1).optional().describe('1-based page number (default 1).'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_LIMIT)
      .optional()
      .describe(`Max rows per page (server caps at ${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`),
  };

  // customers/tickets support a global `search`; expose it for those two.
  if (spec.entity === 'customer' || spec.entity === 'ticket') {
    shape.search = z
      .string()
      .optional()
      .describe('Global substring search across the entity’s primary text fields.');
  }

  for (const f of spec.filters) {
    shape[`filter_${f}`] = z
      .string()
      .optional()
      .describe(`Substring match on the ${f} column.`);
  }

  if (spec.sorts.length) {
    shape.sortCol = z
      .enum(spec.sorts as [string, ...string[]])
      .optional()
      .describe(`Sort column. One of: ${spec.sorts.join(', ')}. Default ${spec.defaultSort}.`);
    shape.sortDir = z
      .enum(['asc', 'desc'])
      .optional()
      .describe('Sort direction. Default depends on the entity.');
  }

  return shape;
}

/** Build the list-handler that calls the backend list endpoint. */
function makeListHandler(spec: EntitySpec) {
  return async (args: Record<string, unknown>) => {
    const limit = clampLimit(args.limit as number | undefined);
    const page = Number(args.page ?? 1);
    const query: Record<string, unknown> = { page, limit };

    for (const [k, v] of Object.entries(args)) {
      if (k === 'page' || k === 'limit') continue;
      query[k] = v;
    }

    try {
      const result = await backendGet<Paginated<unknown>>(spec.path, query);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              data: result.data,
              pagination: result.pagination,
            }),
          },
        ],
      };
    } catch (err) {
      return errorResult(err);
    }
  };
}

/** Build the get-handler that calls the backend detail endpoint. */
function makeGetHandler(spec: EntitySpec) {
  return async (args: { id: string | number; includeRawJson?: boolean }) => {
    try {
      const result = await backendGet(`${spec.path}/${encodeURIComponent(args.id)}`, {}, {
        includeRawJson: args.includeRawJson === true,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return errorResult(err);
    }
  };
}

/** Format an error (backend or otherwise) as a non-throwing tool result. */
function errorResult(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const status = err && typeof err === 'object' && 'status' in err ? (err as { status: number }).status : undefined;
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: `Error${status ? ` (HTTP ${status})` : ''}: ${msg}`,
      },
    ],
  };
}

/** Register the full list/get tool family for every declared entity. */
export function registerEntityTools(server: McpServer): void {
  for (const spec of ENTITIES) {
    const listName = `list_${plural(spec.entity)}`;
    const getName = `get_${spec.entity}`;
    const filterHelp = spec.filters.length
      ? ` Filters (substring): ${spec.filters.map((f) => 'filter_' + f).join(', ')}.`
      : '';
    const sortHelp = spec.sorts.length
      ? ` Sortable by: ${spec.sorts.join(', ')}.`
      : '';
    const vendorNote =
      spec.entity === 'vendor'
        ? ' NOTE: this endpoint returns all vendors with no pagination/filter/sort; page/limit are ignored.'
        : '';

    // list_<entity>
    server.registerTool(
      listName,
      {
        description: `List ${spec.label}.${filterHelp}${sortHelp}${vendorNote} ${spec.what}`,
        inputSchema: buildListShape(spec),
      },
      makeListHandler(spec),
    );

    // get_<entity>
    server.registerTool(
      getName,
      {
        description: `Get a single ${spec.entity} by id. ${spec.what}${spec.detailNote ? ' ' + spec.detailNote : ''}`,
        inputSchema: {
          id: z
            .string()
            .describe(`The ${spec.entity} id (Syncro numeric id as a string).`),
          includeRawJson: z
            .boolean()
            .optional()
            .describe(
              'If true, include the raw_json field (the original Syncro payload, often large). Default false — it is stripped to save context.',
            ),
        },
      },
      makeGetHandler(spec),
    );
  }
}

/** Re-export for the registry and tests. */
export { errorResult, clampLimit, plural };
