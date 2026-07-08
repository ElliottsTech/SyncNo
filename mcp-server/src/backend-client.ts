/**
 * Thin typed HTTP client over the SyncNo backend REST API.
 *
 * Every request carries `Authorization: Bearer <SYNCNO_API_KEY>`, which the
 * backend authenticates as `role: 'service'` — passing requireAuth but blocked
 * from admin/service-only mutations. We only ever issue GETs (read-only).
 *
 * Context hygiene: detail endpoints return a large `raw_json` column holding the
 * original Syncro payload, which duplicates the structured fields and bloats an
 * LLM context window. Callers pass `{ includeRawJson }`; when false (the
 * default) the field is stripped from the response before it ever reaches a tool.
 */

import { config } from './config.js';

/** Error thrown when the backend returns a non-2xx or is unreachable. */
export class BackendError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

/** Recursively remove every `raw_json` key from objects/arrays. Exported for tests. */
export function stripRawJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripRawJson);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'raw_json') continue;
      out[k] = stripRawJson(v);
    }
    return out;
  }
  return value;
}

export interface GetOptions {
  /** When false (default), `raw_json` keys are stripped from the response. */
  includeRawJson?: boolean;
  /** Abort the request after this many ms. Defaults to config.backendTimeoutMs. */
  timeoutMs?: number;
}

/**
 * Perform a GET against `/api/<path>` on the backend and return parsed JSON.
 * @param path path under `/api/` (without the leading `/api/`), e.g. `customers/123`
 * @param query query-string parameters; values are URL-encoded.
 */
export async function backendGet<T = unknown>(
  path: string,
  query: Record<string, unknown> = {},
  opts: GetOptions = {},
): Promise<T> {
  const qs = buildQueryString(query);
  const url = `${config.backendUrl}/api/${path}${qs}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? config.backendTimeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.syncnoApiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new BackendError(`Backend request timed out after ${opts.timeoutMs ?? config.backendTimeoutMs}ms`, 504);
    }
    throw new BackendError(`Backend unreachable: ${(err as Error).message}`, 502);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const errMsg =
      parsed && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as Record<string, unknown>).error)
        : `Backend returned ${res.status}`;
    throw new BackendError(errMsg, res.status, parsed);
  }

  return (opts.includeRawJson ? parsed : stripRawJson(parsed)) as T;
}

/** Build a query string from a record, dropping undefined/null/empty values. */
function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'boolean') {
      if (value) params.set(key, 'true');
      continue;
    }
    params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** Shape of a paginated backend list response. */
export interface Paginated<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number };
}
