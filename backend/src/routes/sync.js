import { Router } from 'express';
import { getDb } from '../db/database.js';
import fs from 'fs';
import path from 'path';

const router = Router();

// Ensure new sync_state columns exist (migration for existing DBs)
try {
  const db = getDb();
  db.prepare("ALTER TABLE sync_state ADD COLUMN catalog_page1_ids TEXT DEFAULT '[]'").run();
  db.prepare("ALTER TABLE sync_state ADD COLUMN catalog_total_pages INTEGER DEFAULT 0").run();
  db.prepare("ALTER TABLE sync_state ADD COLUMN last_result_count INTEGER DEFAULT 0").run();
  db.prepare("ALTER TABLE sync_state ADD COLUMN last_result_error TEXT DEFAULT NULL").run();
  db.prepare("ALTER TABLE sync_state ADD COLUMN detail_page INTEGER DEFAULT 1").run();
  db.prepare("ALTER TABLE sync_state ADD COLUMN detail_item_index INTEGER DEFAULT 0").run();
} catch (_) {}
try {
  const db = getDb();
  db.prepare("ALTER TABLE tickets ADD COLUMN deleted_at TEXT DEFAULT NULL").run();
} catch (_) {}
// Ensure new sync_events columns exist (migration)
// Each ALTER in own try/catch — first failure must not skip subsequent.
try { getDb().prepare("ALTER TABLE sync_events ADD COLUMN current_record_id TEXT").run(); } catch (_) {}
try { getDb().prepare("ALTER TABLE sync_events ADD COLUMN current_record_name TEXT").run(); } catch (_) {}
try { getDb().prepare("ALTER TABLE sync_events ADD COLUMN data_json TEXT").run(); } catch (_) {}
// Ensure raw_json columns exist on assets and purchase_orders (migration)
try {
  const db = getDb();
  db.prepare("ALTER TABLE assets ADD COLUMN raw_json TEXT").run();
} catch (_) {}
try {
  const db = getDb();
  db.prepare("ALTER TABLE purchase_orders ADD COLUMN raw_json TEXT").run();
} catch (_) {}
try {
  const db = getDb();
  db.prepare("ALTER TABLE estimates ADD COLUMN raw_json TEXT").run();
} catch (_) {}
try {
  const db = getDb();
  db.prepare("ALTER TABLE vendors ADD COLUMN raw_json TEXT").run();
} catch (_) {}
try {
  const db = getDb();
  db.prepare("ALTER TABLE contacts ADD COLUMN raw_json TEXT").run();
} catch (_) {}
try {
  const db = getDb();
  db.prepare("ALTER TABLE invoices ADD COLUMN raw_json TEXT").run();
} catch (_) {}

// In-memory abort controller for cancelling running sync
// Per-sync abort controllers keyed by sync ID (entity name or 'all').
// Each running sync gets its own so cancelling one doesn't kill the others.
const syncAbort = new Map();

// ─── Global rate-limit throttle ──────────────────────────────────────────────
// Syncro API limit is global (~150 req/min). All concurrent sync runs share it.
// Enforce a minimum interval between outgoing requests across ALL syncs to stay
// under the limit and avoid reactive 429 backoffs (65s each).
const MIN_REQUEST_INTERVAL_MS = 420; // ~143 req/min, just under 150 cap
let lastRequestAt = 0;
let requestChain = Promise.resolve();
function throttleRequest() {
  const next = requestChain.then(async () => {
    const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastRequestAt = Date.now();
  });
  // Keep chain alive even if a caller rejects — never block subsequent requests.
  requestChain = next.catch(() => {});
  return next;
}

function getSyncAbortController(id) {
  if (!syncAbort.has(id)) {
    syncAbort.set(id, new AbortController());
  }
  return syncAbort.get(id);
}

function abortSync(id) {
  const ctrl = syncAbort.get(id);
  if (ctrl) {
    try { ctrl.abort(); } catch (_) {}
    syncAbort.delete(id);
    return true;
  }
  return false;
}

// ─── Settings helpers ─────────────────────────────────────────────────────────

function getSetting(key) {
  const envKey = key.toUpperCase();
  const envVal = process.env[envKey];
  if (envVal) return envVal;
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

// ─── Sync state helpers ───────────────────────────────────────────────────────

function getSyncState(entity) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sync_state WHERE entity = ?').get(entity);
  if (!row) {
    db.prepare('INSERT INTO sync_state (entity, catalog_page1_ids, catalog_total_pages, detail_page, detail_item_index) VALUES (?, ?, ?, 1, 0)').run(entity, '[]', 0);
    return db.prepare('SELECT * FROM sync_state WHERE entity = ?').get(entity);
  }
  return row;
}

function saveSyncState(state) {
  const db = getDb();
  db.prepare(`
    UPDATE sync_state SET
      phase = ?,
      total_pages = ?,
      last_page_synced = ?,
      detail_cursor = ?,
      detail_page = ?,
      detail_item_index = ?,
      detail_total = ?,
      detail_synced = ?,
      last_sync = ?,
      updated_at = datetime('now'),
      catalog_page1_ids = ?,
      catalog_total_pages = ?,
      last_result_count = ?,
      last_result_error = ?
    WHERE entity = ?
  `).run(
    state.phase,
    state.total_pages,
    state.last_page_synced,
    state.detail_cursor,
    state.detail_page || 1,
    state.detail_item_index || 0,
    state.detail_total,
    state.detail_synced,
    state.last_sync,
    state.catalog_page1_ids || '[]',
    state.catalog_total_pages || 0,
    state.last_result_count != null ? state.last_result_count : 0,
    state.last_result_error || null,
    state.entity
  );
}

// ─── Event helpers ──────────────────────────────────────────────────────────

let liveClients = [];

function clearEventsForEntity(entity) {
  try {
    const db = getDb();
    db.prepare('DELETE FROM sync_events WHERE entity = ?').run(entity);
  } catch (e) { console.error('clearEventsForEntity error:', e.message); }
}

function emitEvent(data, res) {
  // Write to DB for polling clients
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO sync_events (entity, phase, status, message, error, current, total, subphase, detail_total, detail_synced, current_ticket_id, current_ticket_number, count, current_record_id, current_record_name, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.phase || null,
      data.phase || null,
      data.status || null,
      data.message || null,
      data.error || null,
      data.current || null,
      data.total || null,
      data.subphase || null,
      data.detailTotal || null,
      data.detailSynced || null,
      data.currentTicketId || null,
      data.currentTicketNumber || null,
      data.count || null,
      data.currentRecordId || null,
      data.currentRecordName || null,
      JSON.stringify(data)
    );
  } catch (e) { console.error('emitEvent error:', e.message); }

  const payload = `data: ${JSON.stringify(data)}\n\n`;
  // Write directly to primary SSE response
  if (res) {
    try { res.write(payload); } catch (_) {}
  }
  // Also push to live SSE clients (for SyncTerminal fan-out)
  if (liveClients.length > 0) {
    for (const client of liveClients) {
      try { client.write(payload); } catch (_) {}
    }
  }
}

// ─── API: Status ──────────────────────────────────────────────────────────────

router.get('/status', (req, res) => {
  const apiKey = getSetting('syncro_api_key');
  const subdomain = getSetting('syncro_subdomain');
  const lastSync = getSetting('last_sync');
  const azureClientId = process.env.AZURE_CLIENT_ID;
  const azureTenantId = process.env.AZURE_TENANT_ID;
  const nextAuthUrl = process.env.NEXTAUTH_URL;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  res.json({
    syncro: {
      configured: !!(apiKey && subdomain),
      subdomain: subdomain || null,
      apiKeyMasked: apiKey ? '***' + apiKey.slice(-4) : null,
      lastSync: lastSync || null,
    },
    entra: {
      configured: !!(azureClientId && azureTenantId),
      clientId: azureClientId ? '***' + azureClientId.slice(-8) : null,
      tenantId: azureTenantId || null,
    },
    urls: {
      nextAuth: nextAuthUrl || null,
      api: apiUrl || null,
    },
  });
});

// ─── API: Last results per entity ─────────────────────────────────────────────

router.get('/last-results', (req, res) => {
  const db = getDb();
  const entities = ['customers', 'contacts', 'tickets', 'invoices', 'assets', 'estimates', 'purchase_orders', 'vendors'];
  const results = {};
  for (const ent of entities) {
    const state = getSyncState(ent);
    results[ent] = {
      count: state.last_result_count || 0,
      error: state.last_result_error || null,
      last_sync: state.last_sync || null,
    };
  }
  res.json(results);
});

// ─── API: Progress (polling) ───────────────────────────────────────────────────

router.get('/progress', (req, res) => {
  const db = getDb();
  const ticketState = getSyncState('tickets');
  const customerState = getSyncState('customers');
  const contactState = getSyncState('contacts');
  const invoiceState = getSyncState('invoices');
  const assetState = getSyncState('assets');
  const estimateState = getSyncState('estimates');
  const poState = getSyncState('purchase_orders');
  const vendorState = getSyncState('vendors');

  res.json({
    tickets: ticketState,
    customers: customerState,
    contacts: contactState,
    invoices: invoiceState,
    assets: assetState,
    estimates: estimateState,
    purchase_orders: poState,
    vendors: vendorState,
  });
});

// ─── API: Sync events stream (polling fallback) ─────────────────────────────────

router.get('/events', (req, res) => {
  const db = getDb();
  const since = (req.query.since || '1970-01-01').replace('T', ' ');
  const events = db.prepare(`
    SELECT * FROM sync_events WHERE created_at > ? ORDER BY id DESC LIMIT 500
  `).all(since);
  // Convert snake_case DB columns to camelCase to match SSE event format.
  // If data_json present (full payload including http_log fields), merge it on top.
  const camelEvents = events.map(e => {
    const base = {
      id: e.id,
      entity: e.entity,
      phase: e.phase,
      status: e.status,
      message: e.message,
      error: e.error,
      current: e.current,
      total: e.total,
      subphase: e.subphase,
      detailTotal: e.detail_total,
      detailSynced: e.detail_synced,
      currentTicketId: e.current_ticket_id,
      currentTicketNumber: e.current_ticket_number,
      count: e.count,
      currentRecordId: e.current_record_id,
      currentRecordName: e.current_record_name,
      createdAt: e.created_at,
    };
    if (e.data_json) {
      try {
        const parsed = JSON.parse(e.data_json);
        // data_json fields win (preserves http_log method/url/duration/type)
        return { ...base, ...parsed, id: e.id, createdAt: e.created_at };
      } catch (_) {}
    }
    return base;
  });
  res.json(camelEvents.reverse()); // reverse to ASC for client
});

// ─── API: Save credentials ─────────────────────────────────────────────────────

router.post('/save', (req, res) => {
  const { apiKey, subdomain } = req.body;
  if (!apiKey || !subdomain) {
    return res.status(400).json({ error: 'apiKey and subdomain required' });
  }
  setSetting('syncro_api_key', apiKey);
  setSetting('syncro_subdomain', subdomain);

  try {
    const envPath = path.resolve(process.cwd(), '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');
    const updated = lines.map(line => {
      if (line.startsWith('SYNCRO_API_KEY=')) return `SYNCRO_API_KEY=${apiKey}`;
      if (line.startsWith('SYNCRO_SUBDOMAIN=')) return `SYNCRO_SUBDOMAIN=${subdomain}`;
      return line;
    }).join('\n');
    fs.writeFileSync(envPath, updated);
  } catch (e) {
    console.error('Failed to write .env:', e.message);
  }

  res.json({ success: true });
});

// ─── API: Preview ─────────────────────────────────────────────────────────────

router.post('/preview', async (req, res) => {
  const apiKey = getSetting('syncro_api_key');
  const subdomain = getSetting('syncro_subdomain');

  if (!apiKey || !subdomain) {
    return res.status(400).json({ error: 'Syncro not configured' });
  }

  const db = getDb();
  const baseUrl = `https://${subdomain}.syncromsp.com/api/v1`;
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const lastSync = getSetting('last_sync') || null;

  const preview = {
    since: lastSync,
    sinceLabel: lastSync ? `Updated since: ${new Date(lastSync).toLocaleString()}` : 'Never (full sync)',
    entities: {},
    errors: [],
  };

  async function countNewer(endpoint) {
    if (!lastSync) return null;
    const url = new URL(`${baseUrl}/${endpoint}`);
    url.searchParams.set('page', 1);
    url.searchParams.set('per_page', 100);
    const resp = await fetch(url.toString(), { headers });
    if (!resp.ok) return null;
    const data = await resp.json();
    const items = data.customers || data.contacts || data.tickets || data.invoices || [];
    const newer = items.filter(i => i.updated_at && i.updated_at > lastSync).length;
    const meta = data.meta || {};
    const total = meta.total_entries || 0;
    return { newer, total };
  }

  try {
    const cust = await countNewer('customers');
    preview.entities.customers = { total: cust ? cust.newer : 0, page1Total: cust ? cust.total : 0 };
  } catch (e) { preview.errors.push(`customers: ${e.message}`); }

  try {
    const cont = await countNewer('contacts');
    preview.entities.contacts = { total: cont ? cont.newer : 0, page1Total: cont ? cont.total : 0 };
  } catch (e) { preview.errors.push(`contacts: ${e.message}`); }

  try {
    const tick = await countNewer('tickets');
    preview.entities.tickets = { total: tick ? tick.newer : 0, page1Total: tick ? tick.total : 0 };
  } catch (e) { preview.errors.push(`tickets: ${e.message}`); }

  try {
    const inv = await countNewer('invoices');
    preview.entities.invoices = { total: inv ? inv.newer : 0, page1Total: inv ? inv.total : 0 };
  } catch (e) { preview.errors.push(`invoices: ${e.message}`); }

  res.json(preview);
});

// ─── API: Trigger ─────────────────────────────────────────────────────────────

router.post('/trigger', async (req, res) => {
  const { entity } = req.body; // 'tickets', 'customers', etc. defaults to 'all'
  const forceAll = req.query.forceAll === 'true';

  const apiKey = getSetting('syncro_api_key');
  const subdomain = getSetting('syncro_subdomain');

  if (!apiKey || !subdomain) {
    return res.status(400).json({ error: 'Syncro not configured' });
  }

  // Reset abort controller for new sync (per-sync keyed)
  const syncId = (entity && entity !== 'all') ? entity : 'all';
  syncAbort.delete(syncId);
  rateLimitHits = 0;

  // Check if this entity is already running
  const ALL_ENTITIES = ['customers', 'contacts', 'tickets', 'invoices', 'assets', 'estimates', 'purchase_orders', 'vendors'];
  const entitiesToRun = entity && entity !== 'all'
    ? [entity]
    : ALL_ENTITIES;

  for (const ent of entitiesToRun) {
    const state = getSyncState(ent);
    if (state.phase !== 'idle' && state.phase !== 'error') {
      return res.status(409).json({
        error: `Sync for ${ent} already in progress`,
        entity: ent,
        phase: state.phase,
      });
    }
  }

  // SSE response — writeHead sets status + headers atomically, no separate flush
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Track this response for http_log streaming
  liveClients.push(res);

  const db = getDb();
  const log = (action, details) => {
    try {
      db.prepare(`INSERT INTO logs (action, details, ip_address) VALUES (?, ?, ?)`)
        .run(action, details, null);
    } catch (_) {}
  };

  log('SYNC_START', `Sync triggered for: ${entitiesToRun.join(', ')}, forceAll: ${forceAll}`);

  // Send 202 acknowledgment as SSE event (stream stays open for subsequent events)
  res.write(`data: ${JSON.stringify({ accepted: true, entities: entitiesToRun })}\n\n`);

  // Run sync in next tick (non-blocking)
  setImmediate(() => {
    try {
      Promise.resolve(runSync(entitiesToRun, forceAll, apiKey, subdomain, res, syncId))
        .catch(err => console.error('runSync unhandled:', err.message));
    } catch (err) {
      console.error('runSync threw synchronously:', err.message);
    }
  });
});

// ─── Sync runner (runs detached from HTTP response) ───────────────────────────

let rateLimitHits = 0;

async function runSync(entitiesToRun, forceAll, apiKey, subdomain, res, syncId) {
  const db = getDb();
  const results = {};
  const startTime = Date.now();
  const abortCtrl = getSyncAbortController(syncId);
  const syncSignal = abortCtrl.signal;

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  const baseUrl = `https://${subdomain}.syncromsp.com/api/v1`;

  // Compute accurate total record count: page1_count * (totalPages - 1) + lastPage_count
  async function computeTotalRecords(page1Data, endpoint, arrayField) {
    const totalPages = page1Data.meta?.total_pages || 1;
    const page1Count = (page1Data[arrayField] || []).length;
    if (totalPages <= 1) return page1Count;
    const lastPageData = await fetchJson(`${baseUrl}/${endpoint}?page=${totalPages}&per_page=100`, `${endpoint}_last_page`);
    const lastPageCount = (lastPageData[arrayField] || []).length;
    return page1Count * (totalPages - 1) + lastPageCount;
  }

  const log = (action, details) => {
    try {
      db.prepare(`INSERT INTO logs (action, details, ip_address) VALUES (?, ?, ?)`)
        .run(action, details, null);
    } catch (_) {}
  };

  // ─── Shared helpers ─────────────────────────────────────────────────────────

  class ApiError extends Error {
    constructor(endpoint, pageOrId, status, body) {
      super(`${endpoint} ${pageOrId} failed ${status}`);
      this.endpoint = endpoint;
      this.pageOrId = pageOrId;
      this.status = status;
      this.body = body;
    }
  }

  async function fetchWithRetry(url, phase) {
    await throttleRequest(); // global rate-limit gate (shared across all sync runs)
    const start = Date.now();
    const combinedSignal = AbortSignal.any([syncSignal, AbortSignal.timeout(30000)]);
    const resp = await fetch(url, { headers, signal: combinedSignal });
    const ms = Date.now() - start;

    let body = '';
    try { body = await resp.clone().text(); } catch (_) {}

    emitEvent( {
      type: 'http_log',
      direction: 'response',
      method: 'GET',
      url,
      status: resp.status,
      phase: 'http_log',
      duration_ms: ms,
      body_preview: body.slice(0, 300),
    }, res);

    if (resp.status === 429) {
      rateLimitHits++;
      log('SYNC_RATE_LIMIT', `429 hit on ${url} — total hits: ${rateLimitHits}`);
      // Wait out rate limit but allow abort to interrupt the sleep
      try {
        await new Promise((_, reject) => {
          const t = setTimeout(() => reject(new Error('rate_limit_wait_done')), 65000);
          syncSignal.addEventListener('abort', () => { clearTimeout(t); reject(syncSignal.reason); }, { once: true });
        });
      } catch (e) {
        if (syncSignal.aborted) throw new Error('Sync cancelled');
        // Rate limit wait completed normally — proceed to retry
      }
      await throttleRequest();
      const retry = await fetch(url, { headers, signal: combinedSignal });
      let retryBody = '';
      try { retryBody = await retry.clone().text(); } catch (_) {}
      emitEvent( {
        type: 'http_log',
        direction: 'response',
        method: 'GET',
        url,
        status: retry.status,
        phase: 'http_log',
        duration_ms: Date.now() - start,
        body_preview: retryBody.slice(0, 300),
      }, res);
      if (!retry.ok) throw new ApiError(url, 'retry', retry.status, retryBody);
      return { resp: retry, body: retryBody };
    }

    if (!resp.ok) throw new ApiError(url, 'page', resp.status, body);
    return { resp, body };
  }

  async function fetchJson(url, phase) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { resp, body } = await fetchWithRetry(url, phase);
        if (!body || !body.trim()) throw new ApiError(url, 'empty_body', resp.status, body);
        return JSON.parse(body);
      } catch (e) {
        lastError = e;
        if (syncSignal.aborted) throw new Error('Sync cancelled');
        // Retry once on empty body, parse error, or transient timeout
        const transient = e instanceof SyntaxError
          || (e instanceof ApiError && e.message === 'empty_body')
          || e.name === 'TimeoutError'
          || e.name === 'AbortError';
        if (attempt === 0 && transient) continue;
        throw e;
      }
    }
    throw lastError;
  }

  function checkAbort() {
    if (syncSignal.aborted) throw new Error('Sync cancelled');
  }

  function markDeletedTickets(seenIds) {
    if (seenIds.size === 0) return;
    // Mark tickets that were previously synced but not seen in this catalog pass as deleted
    const ids = Array.from(seenIds);
    const batchSize = 500;
    let deleted = 0;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const placeholders = batch.map(() => '?').join(',');
      const result = db.prepare(`
        UPDATE tickets
        SET deleted_at = datetime('now')
        WHERE id NOT IN (${placeholders})
          AND deleted_at IS NULL
          AND has_detail = 1
      `).run(...batch);
      deleted += result.changes;
    }
    if (deleted > 0) {
      log('SYNC_SOFT_DELETE', `Tickets soft-deleted: ${deleted}`);
      emitEvent({ phase: 'tickets', status: 'progress', subphase: 'catalog', message: `${deleted} tickets removed from Syncro — soft-deleted` }, res);
    }
  }

  // ─── Ticket sync ─────────────────────────────────────────────────────────────

  async function syncTickets() {
    const state = getSyncState('tickets');

    const isInitialSync = !state.last_sync || forceAll;

    // ── Catalog phase ─────────────────────────────────────────────────────────
    state.phase = 'catalog';
    saveSyncState(state);
    emitEvent( { phase: 'tickets', status: 'started', subphase: 'catalog', message: 'Building ticket catalog...' }, res);

    try {
      let totalPages = state.total_pages || 0;
      let lastPageSynced = state.last_page_synced || 0;
      let startPage = 1;
      let skipCatalog = false;
      const seenTicketIds = new Set();

      if (forceAll) {
        // Force all: clear has_detail on all tickets, start fresh
        db.prepare('UPDATE tickets SET has_detail = 0, synced_at = NULL').run();
        lastPageSynced = 0;
        startPage = 1;
        totalPages = 0;
      } else if (lastPageSynced > 0) {
        // Prior catalog run exists. Two cases:
        //  (a) catalog_page1_ids populated → catalog completed before, check page 1 for changes
        //  (b) catalog_page1_ids null/empty → catalog was cancelled mid-run, resume from last_page_synced + 1
        const hasStoredPage1Ids = state.catalog_page1_ids && state.catalog_page1_ids !== '[]';

        if (!hasStoredPage1Ids) {
          // Resume incomplete catalog — continue from where it stopped.
          // Rebuild seenTicketIds from DB so markDeletedTickets doesn't soft-delete
          // tickets from pages 1..lastPageSynced that we won't re-visit this run.
          const existingRows = db.prepare("SELECT id FROM tickets WHERE status != 'Resolved' AND deleted_at IS NULL").all();
          for (const r of existingRows) seenTicketIds.add(r.id);
          startPage = lastPageSynced + 1;
          totalPages = state.total_pages || 0;
          emitEvent( { phase: 'tickets', status: 'started', subphase: 'catalog', message: `Resuming catalog from page ${startPage}/${totalPages || '?'}...` }, res);
        } else {
          // Catalog completed previously — check page 1 for new/updated tickets
          const page1Data = await fetchJson(`${baseUrl}/tickets?page=1&per_page=100`, 'tickets_catalog');
          const page1Tickets = page1Data.tickets || [];
          const page1Ids = page1Tickets.map(t => t.id).sort();
          const prevIds = JSON.parse(state.catalog_page1_ids || '[]').sort();

          if (JSON.stringify(page1Ids) !== JSON.stringify(prevIds)) {
            // Page 1 changed: new or updated tickets exist — reprocess from page 1
            db.prepare('UPDATE tickets SET has_detail = 0, synced_at = NULL').run();
            lastPageSynced = 0;
            startPage = 1;
            totalPages = 0;
            emitEvent( { phase: 'tickets', status: 'started', subphase: 'catalog', message: 'New tickets detected, rebuilding catalog...' }, res);
          } else {
            // Page 1 unchanged: skip catalog phase, go straight to detail
            skipCatalog = true;
          }
        }
      }

      if (skipCatalog) {
        // No new tickets — skip catalog, go directly to detail phase
        return finishCatalog(state, isInitialSync);
      }

      // If we don't know total pages yet, fetch page 1
      if (totalPages === 0) {
        const data = await fetchJson(`${baseUrl}/tickets?page=1&per_page=100`, 'tickets_catalog');
        const tickets = data.tickets || [];
        totalPages = data.meta?.total_pages || 1;

        const insertMany = db.transaction((ticketList) => {
          for (const t of ticketList) {
            if (t.status === 'Resolved') continue;
            seenTicketIds.add(t.id);
            db.prepare(`
              INSERT OR REPLACE INTO tickets (id, number, subject, status, created_at, updated_at, raw_json, has_detail, synced_at, deleted_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), NULL)
            `).run(
              t.id,
              String(t.number || ''),
              t.subject || '',
              t.status || '',
              t.created_at || '',
              t.updated_at || '',
              JSON.stringify(t)
            );
          }
        });
        insertMany(tickets);

        state.total_pages = totalPages;
        state.last_page_synced = 1;
        saveSyncState(state);
        emitEvent( { phase: 'tickets', status: 'progress', subphase: 'catalog', current: 1, total: state.total_pages }, res);

        if (totalPages === 1 || startPage >= totalPages) {
          // Store page 1 IDs before finishing
          state.catalog_page1_ids = JSON.stringify(tickets.map(t => t.id));
          state.catalog_total_pages = totalPages;
          state._seenTicketIds = seenTicketIds;
          return finishCatalog(state, isInitialSync);
        }
        startPage = 2;
      }

      // Fetch remaining pages
      for (let page = startPage; page <= totalPages; page++) {
        const data = await fetchJson(`${baseUrl}/tickets?page=${page}&per_page=100`, 'tickets_catalog');
        const tickets = data.tickets || [];

        // Handle page growth
        if (data.meta?.total_pages > totalPages) {
          totalPages = data.meta.total_pages;
        }

        const insertMany = db.transaction((ticketList) => {
          for (const t of ticketList) {
            if (t.status === 'Resolved') continue;
            const existing = db.prepare('SELECT has_detail FROM tickets WHERE id = ?').get(t.id);
            if (existing && existing.has_detail === 1) {
              // Already fully synced — stop catalog here
              return;
            }
            seenTicketIds.add(t.id);
            db.prepare(`
              INSERT OR REPLACE INTO tickets (id, number, subject, status, created_at, updated_at, raw_json, has_detail, synced_at, deleted_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT has_detail FROM tickets WHERE id = ?), 0), datetime('now'), NULL)
            `).run(
              t.id,
              String(t.number || ''),
              t.subject || '',
              t.status || '',
              t.created_at || '',
              t.updated_at || '',
              JSON.stringify(t),
              t.id
            );
          }
        });
        insertMany(tickets);

        state.total_pages = totalPages;
        state.last_page_synced = page;
        saveSyncState(state);
        emitEvent( { phase: 'tickets', status: 'progress', subphase: 'catalog', current: page, total: state.total_pages }, res);

        await new Promise(r => setTimeout(r, 600));
      }

      // Store page 1 IDs and total pages at end of catalog phase
      const finalPage1Data = await fetchJson(`${baseUrl}/tickets?page=1&per_page=100`, 'tickets_catalog');
      const finalPage1Ids = (finalPage1Data.tickets || []).map(t => t.id);
      state.catalog_page1_ids = JSON.stringify(finalPage1Ids);
      state.catalog_total_pages = totalPages;
      state._seenTicketIds = seenTicketIds;
      saveSyncState(state);

      await finishCatalog(state, isInitialSync);

    } catch (e) {
      state.phase = 'error';
      saveSyncState(state);
      emitEvent( { phase: 'tickets', status: 'error', error: e.message }, res);
      throw e;
    }
  }

  async function finishCatalog(state, isInitialSync) {
    // Compute detail_total — count all non-resolved tickets (we re-fetch all every sync)
    const row = db.prepare("SELECT COUNT(*) as cnt FROM tickets WHERE status != 'Resolved' AND deleted_at IS NULL").get();
    state.detail_total = row.cnt;
    state.detail_cursor = null;
    state.detail_synced = 0;
    state.phase = 'detail';
    state.last_sync = new Date().toISOString();

    // Fetch page 1 for deletion detection and catalog tracking (always runs even in skipCatalog path)
    let page1Ids = [];
    try {
      const page1Data = await fetchJson(`${baseUrl}/tickets?page=1&per_page=100`, 'tickets_catalog');
      page1Ids = (page1Data.tickets || []).map(t => t.id);
      state.catalog_page1_ids = JSON.stringify(page1Ids);
      state.catalog_total_pages = page1Data.meta?.total_pages || state.catalog_total_pages || 0;
    } catch (_) {}

    // Mark tickets deleted in Syncro (full catalog flow only; skipCatalog can't reliably detect deletions without fetching all pages)
    if (state._seenTicketIds) {
      markDeletedTickets(state._seenTicketIds);
    }

    saveSyncState(state);
    emitEvent( { phase: 'tickets', status: 'catalog_done', detailTotal: state.detail_total }, res);

    // ── Detail phase ─────────────────────────────────────────────────────────
    await syncTicketDetails(state, isInitialSync);
  }

  async function syncTicketDetails(state, isInitialSync) {
    emitEvent( { phase: 'tickets', status: 'started', subphase: 'detail', message: 'Fetching ticket details...' }, res);

    try {
      let total = state.detail_total;
      let synced = state.detail_synced;
      let cursor = state.detail_cursor;

      // Build query - always re-fetch all non-resolved tickets to catch updates
      let query, params;
      if (!cursor) {
        query = "SELECT id, status FROM tickets WHERE status != 'Resolved' AND deleted_at IS NULL ORDER BY id ASC";
        params = [];
      } else {
        query = "SELECT id, status FROM tickets WHERE status != 'Resolved' AND deleted_at IS NULL AND id > ? ORDER BY id ASC";
        params = [cursor];
      }

      let tickets = db.prepare(query).all(...params);

      // If total is 0 but we're in detail phase, recalculate
      if (tickets.length === 0 && total > 0) {
        // All done
        state.phase = 'idle';
        state.detail_cursor = null;
        state.detail_synced = 0;
        saveSyncState(state);
        emitEvent( { phase: 'tickets', status: 'done', count: synced }, res);
        return;
      }

      // Recalculate total if needed
      if (total === 0) {
        const row = db.prepare("SELECT COUNT(*) as cnt FROM tickets WHERE status != 'Resolved' AND deleted_at IS NULL").get();
        total = row.cnt;
        state.detail_total = total;
        saveSyncState(state);
      }

      for (const ticket of tickets) {
        checkAbort();
        let detail = null;
        let deleted404 = false;

        // Try fetching ticket detail with one retry on 404
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const detailData = await fetchJson(`${baseUrl}/tickets/${ticket.id}`, 'tickets_detail');
            detail = detailData.ticket || detailData;
            break;
          } catch (e) {
            if (e instanceof ApiError && e.status === 404) {
              if (attempt === 0) {
                // First 404 — retry once to rule out transient error
                await new Promise(r => setTimeout(r, 500));
                continue;
              }
              // Second 404 — ticket was deleted in Syncro
              deleted404 = true;
              break;
            }
            throw e;
          }
        }

        if (deleted404) {
          db.prepare('UPDATE tickets SET deleted_at = datetime(\'now\') WHERE id = ?').run(ticket.id);
          log('SYNC_SOFT_DELETE', `Ticket ${ticket.id} returned 404 — soft-deleted`);
          try { emitEvent({ phase: 'tickets', status: 'progress', subphase: 'detail', current: synced + 1, total, message: `ticket ${ticket.id} deleted in Syncro — skipped` }, res); } catch (_) {}
          state.detail_cursor = String(ticket.id);
          state.detail_synced = synced + 1;
          saveSyncState(state);
          synced++;
          continue;
        }

        if (!detail) {
          // Unexpected state — skip
          synced++;
          continue;
        }

        // Update ticket with full detail
        db.prepare(`
          UPDATE tickets
          SET raw_json = ?, has_detail = 1, synced_at = datetime('now'), updated_at = ?,
              subject = ?, status = ?, number = ?, customer_id = ?, customer_business_then_name = ?,
              due_date = ?, resolved_at = ?, start_at = ?, end_at = ?, location_id = ?,
              problem_type = ?, ticket_type_id = ?, user_id = ?, pdf_url = ?, priority = ?,
              comments = ?, user = ?
          WHERE id = ?
        `).run(
          JSON.stringify(detail),
          detail.updated_at || '',
          detail.subject || '',
          detail.status || '',
          String(detail.number || ''),
          detail.customer_id,
          detail.customer_business_then_name || '',
          detail.due_date || '',
          detail.resolved_at || '',
          detail.start_at || '',
          detail.end_at || '',
          detail.location_id || '',
          detail.problem_type || '',
          detail.ticket_type_id || '',
          detail.user_id || '',
          detail.pdf_url || '',
          detail.priority || '',
          JSON.stringify(detail.comments || []),
          detail.user ? JSON.stringify(detail.user) : '',
          detail.id
        );

        // Store child entities
        const comments = detail.comments || [];
        for (const c of comments) {
          db.prepare(`INSERT OR REPLACE INTO ticket_comments (id, ticket_id, body, tech, user_id, created_at, updated_at, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(c.id, detail.id, c.body || '', c.tech || c.user || c.author || '', c.user_id || '', c.created_at || '', c.updated_at || '', JSON.stringify(c));
        }

        const timers = detail.ticket_timers || [];
        for (const te of timers) {
          db.prepare(`INSERT OR REPLACE INTO ticket_time_entries (id, ticket_id, user_id, start_time, end_time, recorded, billable, notes, active_duration, product_id, created_at, updated_at, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(te.id, detail.id, te.user_id || '', te.start_time || '', te.end_time || '', te.recorded ? 1 : 0, te.billable ? 1 : 0, te.notes || '', te.active_duration || 0, te.product_id || '', te.created_at || '', te.updated_at || '', JSON.stringify(te));
        }

        const lineItems = detail.line_items || [];
        for (const li of lineItems) {
          db.prepare(`INSERT OR REPLACE INTO ticket_line_items (id, ticket_id, product_id, quantity, price, description, created_at, updated_at, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(li.id, detail.id, li.product_id || '', parseFloat(li.quantity) || 0, parseFloat(li.retail_cents) / 100 || parseFloat(li.price) || 0, li.description || li.name || '', li.created_at || '', li.updated_at || '', JSON.stringify(li));
        }

        state.detail_cursor = String(detail.id);
        state.detail_synced = synced + 1;
        saveSyncState(state);

        synced++;
        emitEvent( {
          phase: 'tickets',
          status: 'progress',
          subphase: 'detail',
          current: synced,
          total,
          message: `detail ${synced}/${total}`,
          currentTicketId: detail.id,
          currentTicketNumber: detail.number,
        }, res);

        await new Promise(r => setTimeout(r, 350));
        checkAbort();
      }

      // Done
      state.phase = 'idle';
      state.detail_cursor = null;
      state.detail_synced = 0;
      state.last_result_count = synced;
      state.last_result_error = null;
      saveSyncState(state);
      results.tickets = synced;
      log('SYNC_ENTITY', `Tickets detail: ${synced} fetched`);
      emitEvent( { phase: 'tickets', status: 'done', count: synced }, res);
      clearEventsForEntity('tickets');

    } catch (e) {
      state.phase = 'error';
      state.last_result_error = e.message;
      saveSyncState(state);
      emitEvent( { phase: 'tickets', status: 'error', error: e.message }, res);
      throw e;
    }
  }

  // ─── Customer sync ───────────────────────────────────────────────────────────

  async function syncCustomers() {
    emitEvent( { phase: 'customers', status: 'started' }, res);
    const localMax = forceAll ? null : (getSetting('last_sync') || null);
    const state = getSyncState('customers');

    // detail_item_index is the absolute 1-based position across all pages.
    // On resume we skip items 1..resumeOffset and process from resumeOffset+1.
    const resumeOffset = forceAll ? 0 : (state.detail_item_index || 0);

    let absoluteIndex = 0;
    let latestUpdatedAt = localMax;
    let inserts = 0;

    try {
      const page1 = await fetchJson(`${baseUrl}/customers?page=1&per_page=100`, 'customers');
      const totalPages = page1.meta?.total_pages || 1;
      const total = await computeTotalRecords(page1, 'customers', 'customers');

      state.phase = 'detail';
      state.detail_total = total;
      state.detail_synced = 0;
      // Only wipe checkpoint on forceAll — otherwise preserve for resume.
      if (forceAll) {
        state.detail_page = 1;
        state.detail_item_index = 0;
      }
      saveSyncState(state);

      for (let page = 1; page <= totalPages; page++) {
        const data = page === 1 ? page1 : await fetchJson(`${baseUrl}/customers?page=${page}&per_page=100}`, 'customers');
        checkAbort();
        const customers = data.customers || [];

        for (const c of customers) {
          absoluteIndex++;
          checkAbort();
          // Skip items already processed in a prior run
          if (absoluteIndex <= resumeOffset) continue;

          // Decide whether to fetch+insert: forceAll, new record, or delta update
          const existing = db.prepare('SELECT id FROM customers WHERE id = ?').get(c.id);
          const shouldSync =
            forceAll ||
            !existing ||
            !localMax ||
            !c.updated_at ||
            c.updated_at > localMax;

          if (shouldSync) {
            try {
              const detailData = await fetchJson(`${baseUrl}/customers/${c.id}`, 'customers');
              const detail = detailData.customer || detailData;
              db.prepare(`
                INSERT OR REPLACE INTO customers (id, business_name, fullname, email, phone, mobile, address, address_2, city, state, zip, notes, created_at, updated_at, disabled, location_name, location_id, pdf_url, tax_rate_id, invoice_term_id, referred_by, ref_customer_id, business_and_full_name, business_then_name, contacts, properties, notification_email, invoice_cc_emails, get_sms, opt_out, no_email, latitude, longitude, online_profile_url, raw_json, synced)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
              `).run(
                detail.id, detail.business_name || '', detail.fullname || '', detail.email || '', detail.phone || '', detail.mobile || '',
                detail.address || '', detail.address_2 || '', detail.city || '', detail.state || '', detail.zip || '',
                detail.notes || '', detail.created_at || '', detail.updated_at || '',
                detail.disabled ? 1 : 0, detail.location_name || '', detail.location_id || '', detail.pdf_url || '',
                detail.tax_rate_id || '', detail.invoice_term_id || '', detail.referred_by || '', detail.ref_customer_id || '',
                detail.business_and_full_name || '', detail.business_then_name || '',
                JSON.stringify(detail.contacts || []), JSON.stringify(detail.properties || {}),
                detail.notification_email || '', detail.invoice_cc_emails || '',
                detail.get_sms ? 1 : 0, detail.opt_out ? 1 : 0, detail.no_email ? 1 : 0,
                detail.latitude || '', detail.longitude || '', detail.online_profile_url || '',
                JSON.stringify(detail)
              );
              if (!existing) inserts++;
              if (detail.updated_at && detail.updated_at > (latestUpdatedAt || '')) latestUpdatedAt = detail.updated_at;
            } catch (detailErr) {
              if (syncSignal.aborted) throw new Error('Sync cancelled');
              results.errors = results.errors || [];
              results.errors.push(`customers/${c.id}: ${detailErr.message}`);
            }
          }

          state.detail_page = page;
          state.detail_item_index = absoluteIndex;
          saveSyncState(state);
          emitEvent( { phase: 'customers', status: 'progress', current: absoluteIndex, total, currentRecordId: c.id, currentRecordName: c.business_name || c.fullname }, res);
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, 350);
            syncSignal.addEventListener('abort', () => { clearTimeout(t); reject(syncSignal.reason); }, { once: true });
          }).catch(e => { if (syncSignal.aborted) throw new Error('Sync cancelled'); });
        }

        if (data.meta?.total_pages > totalPages) totalPages = data.meta.total_pages;
      }

      if (latestUpdatedAt) setSetting('last_sync', latestUpdatedAt);
      results.customers = absoluteIndex;
      results.customersInserted = inserts;
      state.phase = 'idle';
      state.detail_page = 1;
      state.detail_item_index = 0;
      state.last_result_count = inserts;
      state.last_result_error = null;
      saveSyncState(state);
      log('SYNC_ENTITY', `Customers: ${absoluteIndex} iterated, ${inserts} inserted`);
      emitEvent( { phase: 'customers', status: 'done', count: inserts }, res);
      clearEventsForEntity('customers');
    } catch (e) {
      state.phase = 'error';
      state.last_result_error = e.message;
      saveSyncState(state);
      results.errors = results.errors || [];
      results.errors.push(`customers: ${e.message}`);
      log('SYNC_ERROR', e.message);
      emitEvent( { phase: 'customers', status: 'error', error: e.message }, res);
    }
  }

  // ─── Contacts sync ──────────────────────────────────────────────────────────

  async function syncContacts() {
    emitEvent( { phase: 'contacts', status: 'started' }, res);
    const localMax = forceAll ? null : (getSetting('last_sync') || null);
    const state = getSyncState('contacts');

    const resumeOffset = forceAll ? 0 : (state.detail_item_index || 0);

    let absoluteIndex = 0;
    let latestUpdatedAt = localMax;
    let inserts = 0;

    try {
      const page1 = await fetchJson(`${baseUrl}/contacts?page=1&per_page=100`, 'contacts');
      const totalPages = page1.meta?.total_pages || 1;
      const total = await computeTotalRecords(page1, 'contacts', 'contacts');

      state.phase = 'detail';
      state.detail_total = total;
      state.detail_synced = 0;
      if (forceAll) {
        state.detail_page = 1;
        state.detail_item_index = 0;
      }
      saveSyncState(state);

      for (let page = 1; page <= totalPages; page++) {
        const data = page === 1 ? page1 : await fetchJson(`${baseUrl}/contacts?page=${page}&per_page=100`, 'contacts');
        checkAbort();
        const contacts = data.contacts || [];

        for (const c of contacts) {
          absoluteIndex++;
          checkAbort();
          if (absoluteIndex <= resumeOffset) continue;

          const existing = db.prepare('SELECT id FROM contacts WHERE id = ?').get(c.id);
          const shouldSync =
            forceAll ||
            !existing ||
            !localMax ||
            !c.updated_at ||
            c.updated_at > localMax;

          if (shouldSync) {
            try {
              const detailData = await fetchJson(`${baseUrl}/contacts/${c.id}`, 'contacts');
              const detail = detailData.contact || detailData;
              db.prepare(`
                INSERT OR REPLACE INTO contacts (id, customer_id, name, address1, address2, city, state, zip, email, phone, mobile, latitude, longitude, notes, created_at, updated_at, vendor_id, opt_out, extension, processed_phone, processed_mobile, ticket_matching_emails, properties, account_id, raw_json, synced)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
              `).run(
                detail.id, detail.customer_id, detail.name || '', detail.address1 || '', detail.address2 || '',
                detail.city || '', detail.state || '', detail.zip || '', detail.email || '',
                detail.phone || '', detail.mobile || '', detail.latitude || '', detail.longitude || '',
                detail.notes || '', detail.created_at || '', detail.updated_at || '',
                detail.vendor_id || '', detail.opt_out ? 1 : 0, detail.extension || '',
                detail.processed_phone || '', detail.processed_mobile || '',
                JSON.stringify(detail.ticket_matching_emails || []),
                JSON.stringify(detail.properties || {}),
                detail.account_id || '', JSON.stringify(detail)
              );
              if (!existing) inserts++;
              if (detail.updated_at && detail.updated_at > (latestUpdatedAt || '')) latestUpdatedAt = detail.updated_at;
            } catch (detailErr) {
              if (syncSignal.aborted) throw new Error('Sync cancelled');
              results.errors = results.errors || [];
              results.errors.push(`contacts/${c.id}: ${detailErr.message}`);
            }
          }

          state.detail_page = page;
          state.detail_item_index = absoluteIndex;
          saveSyncState(state);
          emitEvent( { phase: 'contacts', status: 'progress', current: absoluteIndex, total, currentRecordId: c.id, currentRecordName: c.name }, res);
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, 350);
            syncSignal.addEventListener('abort', () => { clearTimeout(t); reject(syncSignal.reason); }, { once: true });
          }).catch(e => { if (syncSignal.aborted) throw new Error('Sync cancelled'); });
        }

        if (data.meta?.total_pages > totalPages) totalPages = data.meta.total_pages;
      }

      if (latestUpdatedAt) setSetting('last_sync', latestUpdatedAt);
      results.contacts = absoluteIndex;
      results.contactsInserted = inserts;
      state.phase = 'idle';
      state.detail_page = 1;
      state.detail_item_index = 0;
      state.last_result_count = inserts;
      state.last_result_error = null;
      saveSyncState(state);
      log('SYNC_ENTITY', `Contacts: ${absoluteIndex} iterated, ${inserts} inserted`);
      emitEvent( { phase: 'contacts', status: 'done', count: inserts }, res);
      clearEventsForEntity('contacts');
    } catch (e) {
      state.phase = 'error';
      state.last_result_error = e.message;
      saveSyncState(state);
      results.errors = results.errors || [];
      results.errors.push(`contacts: ${e.message}`);
      log('SYNC_ERROR', e.message);
      emitEvent( { phase: 'contacts', status: 'error', error: e.message }, res);
    }
  }

  // ─── Invoices sync ───────────────────────────────────────────────────────────

  async function syncInvoices() {
    emitEvent( { phase: 'invoices', status: 'started' }, res);
    const localMax = forceAll ? null : (getSetting('last_sync') || null);
    const state = getSyncState('invoices');

    const resumeOffset = forceAll ? 0 : (state.detail_item_index || 0);

    let absoluteIndex = 0;
    let latestUpdatedAt = localMax;
    let inserts = 0;

    try {
      const page1 = await fetchJson(`${baseUrl}/invoices?page=1&per_page=100`, 'invoices');
      const totalPages = page1.meta?.total_pages || 1;
      const total = await computeTotalRecords(page1, 'invoices', 'invoices');

      state.phase = 'detail';
      state.detail_total = total;
      state.detail_synced = 0;
      if (forceAll) {
        state.detail_page = 1;
        state.detail_item_index = 0;
      }
      saveSyncState(state);

      for (let page = 1; page <= totalPages; page++) {
        const data = page === 1 ? page1 : await fetchJson(`${baseUrl}/invoices?page=${page}&per_page=100`, 'invoices');
        checkAbort();
        const invoices = data.invoices || [];

        for (const inv of invoices) {
          absoluteIndex++;
          checkAbort();
          if (absoluteIndex <= resumeOffset) continue;

          const existing = db.prepare('SELECT id FROM invoices WHERE id = ?').get(inv.id);
          const shouldSync =
            forceAll ||
            !existing ||
            !localMax ||
            !inv.updated_at ||
            inv.updated_at > localMax;

          if (shouldSync) {
            try {
              const detailData = await fetchJson(`${baseUrl}/invoices/${inv.id}`, 'invoices');
              const detail = detailData.invoice || detailData;
              db.prepare(`
                INSERT OR REPLACE INTO invoices (id, customer_id, customer_business_then_name, number, created_at, updated_at, date, due_date, subtotal, total, tax, verified_paid, tech_marked_paid, ticket_id, pdf_url, is_paid, location_id, po_number, contact_id, note, hardwarecost, user_id, raw_json, synced)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
              `).run(
                detail.id, detail.customer_id,
                detail.customer_business_then_name || detail.customer?.business_name || detail.customer?.fullname || '',
                String(detail.number || ''), detail.created_at || '', detail.updated_at || '',
                detail.date || '', detail.due_date || '', detail.subtotal || '', detail.total || '', detail.tax || '',
                detail.verified_paid ? 1 : 0, detail.tech_marked_paid ? 1 : 0,
                detail.ticket_id || '', detail.pdf_url || '',
                detail.is_paid ? 1 : 0, detail.location_id || '',
                detail.po_number || '', detail.contact_id || '',
                detail.note || '', detail.hardwarecost || '', detail.user_id || '', JSON.stringify(detail)
              );
              if (!existing) inserts++;
              if (detail.updated_at && detail.updated_at > (latestUpdatedAt || '')) latestUpdatedAt = detail.updated_at;
            } catch (detailErr) {
              if (syncSignal.aborted) throw new Error('Sync cancelled');
              results.errors = results.errors || [];
              results.errors.push(`invoices/${inv.id}: ${detailErr.message}`);
            }
          }

          state.detail_page = page;
          state.detail_item_index = absoluteIndex;
          saveSyncState(state);
          emitEvent( { phase: 'invoices', status: 'progress', current: absoluteIndex, total, currentRecordId: inv.id, currentRecordName: inv.number }, res);
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, 350);
            syncSignal.addEventListener('abort', () => { clearTimeout(t); reject(syncSignal.reason); }, { once: true });
          }).catch(e => { if (syncSignal.aborted) throw new Error('Sync cancelled'); });
        }

        if (data.meta?.total_pages > totalPages) totalPages = data.meta.total_pages;
      }

      if (latestUpdatedAt) setSetting('last_sync', latestUpdatedAt);
      results.invoices = absoluteIndex;
      results.invoicesInserted = inserts;
      state.phase = 'idle';
      state.detail_page = 1;
      state.detail_item_index = 0;
      state.last_result_count = inserts;
      state.last_result_error = null;
      saveSyncState(state);
      log('SYNC_ENTITY', `Invoices: ${absoluteIndex} iterated, ${inserts} inserted`);
      emitEvent( { phase: 'invoices', status: 'done', count: inserts }, res);
      clearEventsForEntity('invoices');
    } catch (e) {
      state.phase = 'error';
      state.last_result_error = e.message;
      saveSyncState(state);
      results.errors = results.errors || [];
      results.errors.push(`invoices: ${e.message}`);
      log('SYNC_ERROR', e.message);
      emitEvent( { phase: 'invoices', status: 'error', error: e.message }, res);
    }
  }

  // ─── Assets sync ─────────────────────────────────────────────────────────────

  async function syncAssets() {
    emitEvent( { phase: 'assets', status: 'started' }, res);
    const localMax = forceAll ? null : (getSetting('last_sync') || null);
    const state = getSyncState('assets');

    const resumeOffset = forceAll ? 0 : (state.detail_item_index || 0);

    let absoluteIndex = 0;
    let latestUpdatedAt = localMax;
    let inserts = 0;

    try {
      const page1 = await fetchJson(`${baseUrl}/customer_assets?page=1&per_page=100`, 'assets');
      const totalPages = page1.meta?.total_pages || 1;
      const total = await computeTotalRecords(page1, 'customer_assets', 'assets');

      state.phase = 'detail';
      state.detail_total = total;
      state.detail_synced = 0;
      if (forceAll) {
        state.detail_page = 1;
        state.detail_item_index = 0;
      }
      saveSyncState(state);

      for (let page = 1; page <= totalPages; page++) {
        const data = page === 1 ? page1 : await fetchJson(`${baseUrl}/customer_assets?page=${page}&per_page=100`, 'assets');
        checkAbort();
        const assets = data.assets || [];

        for (const a of assets) {
          absoluteIndex++;
          checkAbort();
          if (absoluteIndex <= resumeOffset) continue;

          const existing = db.prepare('SELECT id FROM assets WHERE id = ?').get(a.id);
          const shouldSync =
            forceAll ||
            !existing ||
            !localMax ||
            !a.updated_at ||
            a.updated_at > localMax;

          if (shouldSync) {
            try {
              const detailData = await fetchJson(`${baseUrl}/customer_assets/${a.id}`, 'assets');
              const detail = detailData.asset || detailData;
              db.prepare(`
                INSERT OR REPLACE INTO assets (id, name, customer_id, contact_id, created_at, updated_at, properties, asset_type, asset_serial, external_rmm_link, rmm_links, has_live_chat, snmp_enabled, device_info, rmm_store, address, customer, raw_json, synced)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
              `).run(
                detail.id, detail.name || '', detail.customer_id || null, detail.contact_id || null,
                detail.created_at || '', detail.updated_at || '',
                JSON.stringify(detail.properties || {}), detail.asset_type || '', detail.asset_serial || '',
                detail.external_rmm_link || '', JSON.stringify(detail.rmm_links || []),
                detail.has_live_chat ? 1 : 0, detail.snmp_enabled ? 1 : 0,
                JSON.stringify(detail.device_info || {}), JSON.stringify(detail.rmm_store || {}),
                JSON.stringify(detail.address || {}), JSON.stringify(detail.customer || {}), JSON.stringify(detail)
              );
              if (!existing) inserts++;
              if (detail.updated_at && detail.updated_at > (latestUpdatedAt || '')) latestUpdatedAt = detail.updated_at;
            } catch (detailErr) {
              if (syncSignal.aborted) throw new Error('Sync cancelled');
              results.errors = results.errors || [];
              results.errors.push(`assets/${a.id}: ${detailErr.message}`);
            }
          }

          state.detail_page = page;
          state.detail_item_index = absoluteIndex;
          saveSyncState(state);
          emitEvent( { phase: 'assets', status: 'progress', current: absoluteIndex, total, currentRecordId: a.id, currentRecordName: a.name }, res);
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, 350);
            syncSignal.addEventListener('abort', () => { clearTimeout(t); reject(syncSignal.reason); }, { once: true });
          }).catch(e => { if (syncSignal.aborted) throw new Error('Sync cancelled'); });
        }

        if (data.meta?.total_pages > totalPages) totalPages = data.meta.total_pages;
      }

      if (latestUpdatedAt) setSetting('last_sync', latestUpdatedAt);
      results.assets = absoluteIndex;
      results.assetsInserted = inserts;
      state.phase = 'idle';
      state.detail_page = 1;
      state.detail_item_index = 0;
      state.detail_synced = 0;
      state.last_result_count = inserts;
      state.last_result_error = null;
      saveSyncState(state);
      log('SYNC_ENTITY', `Assets: ${absoluteIndex} iterated, ${inserts} inserted`);
      emitEvent( { phase: 'assets', status: 'done', count: inserts }, res);
      clearEventsForEntity('assets');
    } catch (e) {
      state.phase = 'error';
      state.last_result_error = e.message;
      saveSyncState(state);
      results.errors = results.errors || [];
      results.errors.push(`assets: ${e.message}`);
      log('SYNC_ERROR', e.message);
      emitEvent( { phase: 'assets', status: 'error', error: e.message }, res);
    }
  }

  // ─── Estimates sync ───────────────────────────────────────────────────────────

  async function syncEstimates() {
    emitEvent( { phase: 'estimates', status: 'started' }, res);
    const localMax = forceAll ? null : (getSetting('last_sync') || null);
    const state = getSyncState('estimates');

    const resumeOffset = forceAll ? 0 : (state.detail_item_index || 0);

    let absoluteIndex = 0;
    let latestUpdatedAt = localMax;
    let inserts = 0;

    try {
      const page1 = await fetchJson(`${baseUrl}/estimates?page=1&per_page=100`, 'estimates');
      const totalPages = page1.meta?.total_pages || 1;
      const total = await computeTotalRecords(page1, 'estimates', 'estimates');

      state.phase = 'detail';
      state.detail_total = total;
      state.detail_synced = 0;
      if (forceAll) {
        state.detail_page = 1;
        state.detail_item_index = 0;
      }
      saveSyncState(state);

      for (let page = 1; page <= totalPages; page++) {
        const data = page === 1 ? page1 : await fetchJson(`${baseUrl}/estimates?page=${page}&per_page=100`, 'estimates');
        checkAbort();
        const estimates = data.estimates || [];

        for (const e of estimates) {
          absoluteIndex++;
          checkAbort();
          if (absoluteIndex <= resumeOffset) continue;

          const existing = db.prepare('SELECT id FROM estimates WHERE id = ?').get(e.id);
          const shouldSync =
            forceAll ||
            !existing ||
            !localMax ||
            !e.updated_at ||
            e.updated_at > localMax;

          if (shouldSync) {
            try {
              const detailData = await fetchJson(`${baseUrl}/estimates/${e.id}`, 'estimates');
              const detail = detailData.estimate || detailData;
              db.prepare(`
                INSERT OR REPLACE INTO estimates (id, customer_business_then_name, number, status, created_at, updated_at, customer_id, date, subtotal, total, tax, ticket_id, pdf_url, location_id, invoice_id, employee, raw_json, synced)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
              `).run(
                detail.id, detail.customer_business_then_name || '',
                String(detail.number || ''), detail.status || '',
                detail.created_at || '', detail.updated_at || '',
                detail.customer_id || null, detail.date || '',
                detail.subtotal || '', detail.total || '', detail.tax || '',
                detail.ticket_id || '', detail.pdf_url || '',
                detail.location_id || '', detail.invoice_id || '',
                detail.employee || '', JSON.stringify(detail)
              );
              if (!existing) inserts++;
              if (detail.updated_at && detail.updated_at > (latestUpdatedAt || '')) latestUpdatedAt = detail.updated_at;
            } catch (detailErr) {
              if (syncSignal.aborted) throw new Error('Sync cancelled');
              results.errors = results.errors || [];
              results.errors.push(`estimates/${e.id}: ${detailErr.message}`);
            }
          }

          state.detail_page = page;
          state.detail_item_index = absoluteIndex;
          saveSyncState(state);
          emitEvent( { phase: 'estimates', status: 'progress', current: absoluteIndex, total, currentRecordId: e.id, currentRecordName: e.number }, res);
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, 350);
            syncSignal.addEventListener('abort', () => { clearTimeout(t); reject(syncSignal.reason); }, { once: true });
          }).catch(e => { if (syncSignal.aborted) throw new Error('Sync cancelled'); });
        }

        if (data.meta?.total_pages > totalPages) totalPages = data.meta.total_pages;
      }

      if (latestUpdatedAt) setSetting('last_sync', latestUpdatedAt);
      results.estimates = absoluteIndex;
      results.estimatesInserted = inserts;
      state.phase = 'idle';
      state.detail_page = 1;
      state.detail_item_index = 0;
      state.last_result_count = inserts;
      state.last_result_error = null;
      saveSyncState(state);
      log('SYNC_ENTITY', `Estimates: ${absoluteIndex} iterated, ${inserts} inserted`);
      emitEvent( { phase: 'estimates', status: 'done', count: inserts }, res);
      clearEventsForEntity('estimates');
    } catch (e) {
      state.phase = 'error';
      state.last_result_error = e.message;
      saveSyncState(state);
      results.errors = results.errors || [];
      results.errors.push(`estimates: ${e.message}`);
      log('SYNC_ERROR', e.message);
      emitEvent( { phase: 'estimates', status: 'error', error: e.message }, res);
    }
  }

  // ─── Purchase orders sync ────────────────────────────────────────────────────

  async function syncPurchaseOrders() {
    emitEvent( { phase: 'purchase_orders', status: 'started' }, res);
    const localMax = forceAll ? null : (getSetting('last_sync') || null);
    const state = getSyncState('purchase_orders');

    const resumeOffset = forceAll ? 0 : (state.detail_item_index || 0);

    let absoluteIndex = 0;
    let latestUpdatedAt = localMax;
    let inserts = 0;

    try {
      const page1 = await fetchJson(`${baseUrl}/purchase_orders?page=1&per_page=100`, 'purchase_orders');
      const totalPages = page1.meta?.total_pages || 1;
      const total = await computeTotalRecords(page1, 'purchase_orders', 'purchase_orders');

      state.phase = 'detail';
      state.detail_total = total;
      state.detail_synced = 0;
      if (forceAll) {
        state.detail_page = 1;
        state.detail_item_index = 0;
      }
      saveSyncState(state);

      for (let page = 1; page <= totalPages; page++) {
        const data = page === 1 ? page1 : await fetchJson(`${baseUrl}/purchase_orders?page=${page}&per_page=100`, 'purchase_orders');
        checkAbort();
        const pos = data.purchase_orders || [];

        for (const p of pos) {
          absoluteIndex++;
          checkAbort();
          if (absoluteIndex <= resumeOffset) continue;

          const existing = db.prepare('SELECT id FROM purchase_orders WHERE id = ?').get(p.id);
          const shouldSync =
            forceAll ||
            !existing ||
            !localMax ||
            !p.updated_at ||
            p.updated_at > localMax;

          if (shouldSync) {
            try {
              const detailData = await fetchJson(`${baseUrl}/purchase_orders/${p.id}`, 'purchase_orders');
              const detail = detailData.purchase_order || detailData;
              db.prepare(`
                INSERT OR REPLACE INTO purchase_orders (id, account_subdomain, created_at, updated_at, expected_date, number, other, shipping, shipping_notes, status, total, user_id, vendor_id, location_id, due_date, paid_date, delivery_tracking, vendor, location, line_items, raw_json, synced)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
              `).run(
                detail.id, detail.account_subdomain || '', detail.created_at || '', detail.updated_at || '',
                detail.expected_date || '', detail.number || '',
                detail.other || '', detail.shipping || '', detail.shipping_notes || '',
                detail.status || '', detail.total || '', detail.user_id || '',
                detail.vendor_id || null, detail.location_id || '',
                detail.due_date || '', detail.paid_date || '',
                detail.delivery_tracking || '',
                JSON.stringify(detail.vendor || {}), JSON.stringify(detail.location || {}),
                JSON.stringify(detail.line_items || []), JSON.stringify(detail)
              );
              if (!existing) inserts++;
              if (detail.updated_at && detail.updated_at > (latestUpdatedAt || '')) latestUpdatedAt = detail.updated_at;
            } catch (detailErr) {
              if (syncSignal.aborted) throw new Error('Sync cancelled');
              results.errors = results.errors || [];
              results.errors.push(`purchase_orders/${p.id}: ${detailErr.message}`);
            }
          }

          state.detail_page = page;
          state.detail_item_index = absoluteIndex;
          saveSyncState(state);
          emitEvent( { phase: 'purchase_orders', status: 'progress', current: absoluteIndex, total, currentRecordId: p.id, currentRecordName: p.number }, res);
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, 350);
            syncSignal.addEventListener('abort', () => { clearTimeout(t); reject(syncSignal.reason); }, { once: true });
          }).catch(e => { if (syncSignal.aborted) throw new Error('Sync cancelled'); });
        }

        if (data.meta?.total_pages > totalPages) totalPages = data.meta.total_pages;
      }

      if (latestUpdatedAt) setSetting('last_sync', latestUpdatedAt);
      results.purchase_orders = absoluteIndex;
      results.purchaseOrdersInserted = inserts;
      state.phase = 'idle';
      state.detail_page = 1;
      state.detail_item_index = 0;
      state.last_result_count = inserts;
      state.last_result_error = null;
      saveSyncState(state);
      log('SYNC_ENTITY', `Purchase orders: ${absoluteIndex} iterated, ${inserts} inserted`);
      emitEvent( { phase: 'purchase_orders', status: 'done', count: inserts }, res);
      clearEventsForEntity('purchase_orders');
    } catch (e) {
      state.phase = 'error';
      state.last_result_error = e.message;
      saveSyncState(state);
      results.errors = results.errors || [];
      results.errors.push(`purchase_orders: ${e.message}`);
      log('SYNC_ERROR', e.message);
      emitEvent( { phase: 'purchase_orders', status: 'error', error: e.message }, res);
    }
  }
  async function syncVendors() {
    emitEvent( { phase: 'vendors', status: 'started' }, res);
    const localMax = forceAll ? null : (getSetting('last_sync') || null);
    const state = getSyncState('vendors');

    const resumeOffset = forceAll ? 0 : (state.detail_item_index || 0);

    let absoluteIndex = 0;
    let latestUpdatedAt = localMax;
    let inserts = 0;

    try {
      const page1 = await fetchJson(`${baseUrl}/vendors?page=1&per_page=100`, 'vendors');
      const totalPages = page1.meta?.total_pages || 1;
      const total = await computeTotalRecords(page1, 'vendors', 'vendors');

      state.phase = 'detail';
      state.detail_total = total;
      state.detail_synced = 0;
      if (forceAll) {
        state.detail_page = 1;
        state.detail_item_index = 0;
      }
      saveSyncState(state);

      for (let page = 1; page <= totalPages; page++) {
        const data = page === 1 ? page1 : await fetchJson(`${baseUrl}/vendors?page=${page}&per_page=100`, 'vendors');
        checkAbort();
        const vendors = data.vendors || [];

        for (const v of vendors) {
          absoluteIndex++;
          checkAbort();
          if (absoluteIndex <= resumeOffset) continue;

          const existing = db.prepare('SELECT id FROM vendors WHERE id = ?').get(v.id);
          const shouldSync =
            forceAll ||
            !existing ||
            !localMax ||
            !v.updated_at ||
            v.updated_at > localMax;

          if (shouldSync) {
            try {
              const detailData = await fetchJson(`${baseUrl}/vendors/${v.id}`, 'vendors');
              const detail = detailData.vendor || detailData;
              db.prepare(`
                INSERT OR REPLACE INTO vendors (id, name, rep_first_name, rep_last_name, email, phone, account_number, created_at, updated_at, address, city, state, zip, website, notes, raw_json, synced)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
              `).run(
                detail.id, detail.name || '',
                detail.rep_first_name || '', detail.rep_last_name || '',
                detail.email || '', detail.phone || '',
                detail.account_number || '',
                detail.created_at || '', detail.updated_at || '',
                detail.address || '', detail.city || '',
                detail.state || '', detail.zip || '',
                detail.website || '', detail.notes || '', JSON.stringify(detail)
              );
              if (!existing) inserts++;
              if (detail.updated_at && detail.updated_at > (latestUpdatedAt || '')) latestUpdatedAt = detail.updated_at;
            } catch (detailErr) {
              if (syncSignal.aborted) throw new Error('Sync cancelled');
              results.errors = results.errors || [];
              results.errors.push(`vendors/${v.id}: ${detailErr.message}`);
            }
          }

          state.detail_page = page;
          state.detail_item_index = absoluteIndex;
          saveSyncState(state);
          emitEvent( { phase: 'vendors', status: 'progress', current: absoluteIndex, total, currentRecordId: v.id, currentRecordName: v.name }, res);
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, 350);
            syncSignal.addEventListener('abort', () => { clearTimeout(t); reject(syncSignal.reason); }, { once: true });
          }).catch(e => { if (syncSignal.aborted) throw new Error('Sync cancelled'); });
        }

        if (data.meta?.total_pages > totalPages) totalPages = data.meta.total_pages;
      }

      if (latestUpdatedAt) setSetting('last_sync', latestUpdatedAt);
      results.vendors = absoluteIndex;
      results.vendorsInserted = inserts;
      state.phase = 'idle';
      state.detail_page = 1;
      state.detail_item_index = 0;
      state.last_result_count = inserts;
      state.last_result_error = null;
      saveSyncState(state);
      log('SYNC_ENTITY', `Vendors: ${absoluteIndex} iterated, ${inserts} inserted`);
      emitEvent( { phase: 'vendors', status: 'done', count: inserts }, res);
      clearEventsForEntity('vendors');
    } catch (e) {
      state.phase = 'error';
      state.last_result_error = e.message;
      saveSyncState(state);
      results.errors = results.errors || [];
      results.errors.push(`vendors: ${e.message}`);
      log('SYNC_ERROR', e.message);
      emitEvent( { phase: 'vendors', status: 'error', error: e.message }, res);
    }
  }

  // ─── Run all entity syncs ───────────────────────────────────────────────────

  try {
    for (const ent of entitiesToRun) {
      if (ent === 'tickets') await syncTickets();
      else if (ent === 'customers') await syncCustomers();
      else if (ent === 'contacts') await syncContacts();
      else if (ent === 'invoices') await syncInvoices();
      else if (ent === 'assets') await syncAssets();
      else if (ent === 'estimates') await syncEstimates();
      else if (ent === 'purchase_orders') await syncPurchaseOrders();
      else if (ent === 'vendors') await syncVendors();
    }

    results.duration = Date.now() - startTime;
    log('SYNC_COMPLETE', `Sync complete — ${JSON.stringify(results)}, errors: ${(results.errors || []).length}`);
    emitEvent( { phase: 'done', results }, res);
  } catch (e) {
    log('SYNC_ERROR', e.message);
    const isCancel = e.message === 'Sync cancelled';
    if (isCancel) {
      emitEvent( { phase: 'done', status: 'cancelled' }, res);
    } else {
      emitEvent( { phase: 'error', error: e.message, results }, res);
    }
    // Do NOT re-throw — error is logged + emitted. Re-throwing escapes runSync
    // (called via setImmediate) and becomes an unhandled rejection that kills the process.
  } finally {
    syncAbort.delete(syncId);
  }
}

// ─── API: Cancel sync ─────────────────────────────────────────────────────────

router.delete('/trigger', (req, res) => {
  // Optional ?entity=X scopes the cancel to one running sync.
  // Without it, cancels everything (backward compat).
  const targetEntity = req.query.entity || (req.body && req.body.entity) || null;
  const targetSyncId = targetEntity || 'all';

  const cancelledIds = [];
  if (targetEntity) {
    if (abortSync(targetSyncId)) cancelledIds.push(targetSyncId);
  } else {
    for (const id of Array.from(syncAbort.keys())) {
      if (abortSync(id)) cancelledIds.push(id);
    }
  }

  // Reset DB state for affected entities only (preserves cursor for resume)
  const entities = targetEntity && targetEntity !== 'all'
    ? [targetEntity]
    : ['customers', 'contacts', 'tickets', 'invoices', 'assets', 'estimates', 'purchase_orders', 'vendors'];
  for (const ent of entities) {
    const state = getSyncState(ent);
    if (state.phase !== 'idle' && state.phase !== 'error') {
      const lastCount = state.detail_synced || 0;
      state.phase = 'idle';
      state.detail_synced = 0;
      state.last_result_count = lastCount;
      state.last_result_error = 'cancelled';
      // Keep detail_cursor intact as resume point — don't destroy it on cancel
      saveSyncState(state);
    }
  }
  res.json({ cancelled: true, ids: cancelledIds });
});

// ─── API: Reset sync state ───────────────────────────────────────────────────

router.post('/reset', (req, res) => {
  const { entity } = req.body;
  const entities = entity ? [entity] : ['customers', 'contacts', 'tickets', 'invoices', 'assets', 'estimates', 'purchase_orders', 'vendors'];
  for (const ent of entities) {
    const state = getSyncState(ent);
    state.phase = 'idle';
    state.last_result_error = null;
    // Preserve checkpoint (detail_page, detail_item_index, detail_total) so sync can resume
    saveSyncState(state);
  }
  res.json({ ok: true });
});

// ─── API: Toggle synced flag ──────────────────────────────────────────────────

router.patch('/synced', (req, res) => {
  const { table, id, synced } = req.body;
  const allowedTables = ['customers', 'contacts', 'tickets', 'assets', 'invoices', 'estimates', 'purchase_orders', 'vendors'];
  if (!table || !id || typeof synced !== 'boolean') {
    return res.status(400).json({ error: 'table, id, and synced required' });
  }
  if (!allowedTables.includes(table)) {
    return res.status(400).json({ error: 'Invalid table' });
  }
  try {
    const db = getDb();
    const result = db.prepare(`UPDATE ${table} SET synced = ? WHERE id = ?`).run(synced ? 1 : 0, id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }
    res.json({ success: true, table, id, synced });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
