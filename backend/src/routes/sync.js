import { Router } from 'express';
import { getDb } from '../db/database.js';
import fs from 'fs';
import path from 'path';

const router = Router();

// Env var fallbacks for credentials (DB settings take precedence if set)
function getSetting(key) {
  // Check env first (key is like "syncro_api_key" → "SYNCRO_API_KEY")
  const envKey = key.toUpperCase();
  const envVal = process.env[envKey];
  if (envVal) return envVal;
  // Fall back to DB
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

function emit(sse, data) {
  sse.write(`data: ${JSON.stringify(data)}\n\n`);
}

function logSync(db, action, details) {
  try {
    db.prepare(`INSERT INTO logs (action, details, ip_address) VALUES (?, ?, ?)`)
      .run(action, details, null);
  } catch (e) {
    // Ignore logging errors
  }
}

// GET /api/sync/status
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

// POST /api/sync/save - save credentials
router.post('/save', (req, res) => {
  const { apiKey, subdomain } = req.body;
  if (!apiKey || !subdomain) {
    return res.status(400).json({ error: 'apiKey and subdomain required' });
  }
  setSetting('syncro_api_key', apiKey);
  setSetting('syncro_subdomain', subdomain);

  // Also persist to backend/.env
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

// POST /api/sync/preview - count records newer than local max updated_at
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

  // Fetch page 1 and count records newer than lastSync
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

// POST /api/sync/trigger - streaming sync with progress
// Optional ?phase= query param to sync a single entity only
router.post('/trigger', async (req, res) => {
  const reqId = Math.random().toString(36).slice(2, 10);

  const apiKey = getSetting('syncro_api_key');
  const subdomain = getSetting('syncro_subdomain');
  const singlePhase = req.query.phase || null;
  const limit = singlePhase ? (parseInt(req.query.limit) || null) : null;
  const forceAll = req.query.forceAll === 'true';
  const localMax = forceAll ? null : (getSetting('last_sync') || null);

  if (!apiKey || !subdomain) {
    return res.status(400).json({ error: 'Syncro not configured' });
  }

  // Streaming SSE response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Abort flag — set via DELETE /api/sync/trigger
  res.aborted = false;
  res.on('close', () => { res.aborted = true; });

  const db = getDb();
  const results = { customers: 0, contacts: 0, tickets: 0, invoices: 0, assets: 0, estimates: 0, purchase_orders: 0, vendors: 0, ticket_comments: 0, ticket_time_entries: 0, ticket_line_items: 0, errors: [] };
  const startTime = Date.now();

  const ALL_PHASES = ['customers', 'contacts', 'tickets', 'invoices', 'assets', 'estimates', 'purchase_orders', 'vendors'];
  const phasesToRun = singlePhase ? [singlePhase] : ALL_PHASES;

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const baseUrl = `https://${subdomain}.syncromsp.com/api/v1`;

  const log = (action, details) => {
    try {
      db.prepare(`INSERT INTO logs (action, details, ip_address) VALUES (?, ?, ?)`)
        .run(action, details, null);
    } catch (_) {}
  };

  log('SYNC_REQ', `New sync request ${reqId} — phase: ${req.query.phase || 'all'}`);

  log('SYNC_START', `Sync started — forceAll: ${forceAll}, last_sync: ${localMax}`);

  // Fetch paginated list, filtering by updated_at > localMax
  class ApiError extends Error {
    constructor(endpoint, pageOrId, status, body) {
      super(`${endpoint} ${pageOrId} failed ${status}`);
      this.endpoint = endpoint;
      this.pageOrId = pageOrId;
      this.status = status;
      this.body = body;
    }
  }

  async function fetchList(endpoint, localMax, maxRecords, phase, forceAll) {
    const all = [];
    let page = 1;
    let totalPages = 1;
    let latestUpdatedAt = localMax;
    let fetchSeq = 0; // per-sync unique fetch counter

    while (page <= totalPages) {
      const url = new URL(`${baseUrl}/${endpoint}`);
      url.searchParams.set('page', page);
      url.searchParams.set('per_page', 100);
      if (maxRecords) url.searchParams.set('per_page', Math.min(maxRecords, 100));

      const reqUrl = url.toString();
      const seq = ++fetchSeq;
      const start = Date.now();
      log('FETCH', `${reqId} #${seq} → GET ${reqUrl}`);
      const resp = await fetch(reqUrl, { headers, signal: AbortSignal.timeout(30000) });
      const ms = Date.now() - start;
      let data;
      let respBody = '';
      if (resp.status === 429) {
        rateLimitHits++;
        log('SYNC_RATE_LIMIT', `429 hit on ${endpoint} page ${page} — total hits: ${rateLimitHits}`);
        emit(res, {
          type: 'http_log',
          direction: 'response',
          method: 'GET',
          url: reqUrl,
          status: 429,
          phase,
          duration_ms: ms,
          body_preview: '',
        });
        await new Promise(r => setTimeout(r, 65000));
        const retryStart = Date.now();
        const retry = await fetch(reqUrl, { headers, signal: AbortSignal.timeout(30000) });
        const retryMs = Date.now() - retryStart;
        try { respBody = await retry.clone().text(); } catch (_) {}
        emit(res, {
          type: 'http_log',
          direction: 'response',
          method: 'GET',
          url: reqUrl,
          status: retry.status,
          phase,
          duration_ms: retryMs,
          body_preview: respBody.slice(0, 300),
        });
        if (!retry.ok) {
          try { respBody = await retry.clone().text(); } catch (_) {}
          throw new ApiError(endpoint, `page ${page}`, retry.status, respBody);
        }
        data = await retry.json();
      } else if (!resp.ok) {
        try { respBody = await resp.clone().text(); } catch (_) {}
        emit(res, {
          type: 'http_log',
          direction: 'response',
          method: 'GET',
          url: reqUrl,
          status: resp.status,
          phase,
          duration_ms: ms,
          body_preview: respBody.slice(0, 300),
        });
        throw new ApiError(endpoint, `page ${page}`, resp.status, respBody);
      } else {
        try { respBody = await resp.clone().text(); } catch (_) {}
        emit(res, {
          type: 'http_log',
          direction: 'response',
          method: 'GET',
          url: reqUrl,
          status: resp.status,
          phase,
          duration_ms: ms,
          body_preview: respBody.slice(0, 300),
        });
        data = await resp.json();
      }
      const items = data.customers || data.contacts || data.tickets || data.invoices || data.assets || data.estimates || data.purchase_orders || [];
      const meta = data.meta || {};
      totalPages = meta.total_pages || 1;

      const filtered = items.filter(item => {
        if (forceAll) return true;
        if (!item.updated_at) return true;
        if (!localMax) return true;
        return item.updated_at > localMax;
      });

      for (const item of filtered) {
        if (item.updated_at && item.updated_at > latestUpdatedAt) {
          latestUpdatedAt = item.updated_at;
        }
      }

      all.push(...filtered);
      if (maxRecords && all.length >= maxRecords) {
        all.splice(maxRecords);
        emit(res, { phase: null, type: 'progress', endpoint, page, totalPages, fetched: filtered.length, limited: true });
        break; // break while loop — maxRecords reached
      }

      emit(res, { phase: null, type: 'progress', endpoint, page, totalPages, fetched: filtered.length });
      if (items.length === 0) break;
      if (res.aborted) { emit(res, { type: 'cancelled' }); return { records: all, latestUpdatedAt }; }
      page++;
      await new Promise(r => setTimeout(r, 600));
    }

    return { records: all, latestUpdatedAt };
  }

  // Fetch single item detail — unwrap {ticket:{...}} → {...}
  // Track rate limit hits for logging
  let rateLimitHits = 0;

  async function fetchDetail(endpoint, id, phase) {
    const reqUrl = `${baseUrl}/${endpoint}/${id}`;
    const start = Date.now();
    const resp = await fetch(reqUrl, { headers, signal: AbortSignal.timeout(30000) });
    const ms = Date.now() - start;
    let body = '';
    try { body = await resp.clone().text(); } catch (_) {}
    // Emit raw HTTP log
    emit(res, {
      type: 'http_log',
      direction: 'response',
      method: 'GET',
      url: reqUrl,
      status: resp.status,
      phase,
      duration_ms: ms,
      body_preview: body.slice(0, 300),
    });
    // Detect rate limit (429) — back off and log
    if (resp.status === 429) {
      rateLimitHits++;
      log('SYNC_RATE_LIMIT', `429 hit on ${endpoint}/${id} — total hits: ${rateLimitHits}`);
      // Wait 65s then retry once
      await new Promise(r => setTimeout(r, 65000));
      const retryStart = Date.now();
      const retry = await fetch(reqUrl, { headers, signal: AbortSignal.timeout(30000) });
      const retryMs = Date.now() - retryStart;
      let retryBody = '';
      try { retryBody = await retry.clone().text(); } catch (_) {}
      emit(res, {
        type: 'http_log',
        direction: 'response',
        method: 'GET',
        url: reqUrl,
        status: retry.status,
        phase,
        duration_ms: retryMs,
        body_preview: retryBody.slice(0, 300),
      });
      if (!retry.ok) throw new ApiError(endpoint, String(id), retry.status, retryBody);
      const data = await retry.json();
      return data.ticket || data.customer || data.contact || data.invoice || data.asset || data.estimate || data.purchase_order || data.vendor || data;
    }
    if (!resp.ok) throw new ApiError(endpoint, String(id), resp.status, body);
    const data = await resp.json();
    // Syncro wraps single-entity detail in a key: {ticket:{...}}, {customer:{...}}, etc.
    return data.ticket || data.customer || data.contact || data.invoice || data.asset || data.estimate || data.purchase_order || data.vendor || data;
  }

  try {
    if (singlePhase && !ALL_PHASES.includes(singlePhase)) {
      emit(res, { phase: 'error', error: `Unknown phase: ${singlePhase}` });
      res.end();
      return;
    }

    let globalLatest = localMax;

    function updateGlobalLatest(ts) {
      if (ts && ts > (globalLatest || '')) globalLatest = ts;
    }

    // ── CUSTOMERS ──────────────────────────────────────────────────────────────
    if (phasesToRun.includes('customers')) {
      emit(res, { phase: 'customers', status: 'started', message: 'Syncing customers...' });
      try {
        const { records: customers, latestUpdatedAt } = await fetchList('customers', localMax, limit, 'customers', forceAll);
        updateGlobalLatest(latestUpdatedAt);
        let synced = 0;

        for (const c of customers) {
          // Skip already-synced records with no change
          const existing = db.prepare('SELECT synced, updated_at FROM customers WHERE id = ?').get(c.id);
          if (existing && existing.synced === 1 && existing.updated_at === c.updated_at) {
            // Already fully synced and unchanged — just update the list-level fields
            db.prepare('UPDATE customers SET business_name=?, fullname=?, updated_at=? WHERE id=?').run(
              c.business_name || '', c.fullname || '', c.updated_at || '', c.id
            );
          } else {
            const detail = await fetchDetail('customers', c.id, 'customers');
            db.prepare(`
              INSERT OR REPLACE INTO customers (
                id, business_name, fullname, email, phone, mobile, address, address_2, city, state, zip,
                notes, created_at, updated_at, disabled, location_name, location_id, pdf_url,
                tax_rate_id, invoice_term_id, referred_by, ref_customer_id, business_and_full_name,
                business_then_name, contacts, properties, notification_email, invoice_cc_emails,
                get_sms, opt_out, no_email, latitude, longitude, online_profile_url, raw_json, synced
              ) VALUES (
                @id, @business_name, @fullname, @email, @phone, @mobile, @address, @address_2, @city, @state, @zip,
                @notes, @created_at, @updated_at, @disabled, @location_name, @location_id, @pdf_url,
                @tax_rate_id, @invoice_term_id, @referred_by, @ref_customer_id, @business_and_full_name,
                @business_then_name, @contacts, @properties, @notification_email, @invoice_cc_emails,
                @get_sms, @opt_out, @no_email, @latitude, @longitude, @online_profile_url, @raw_json, @synced
              )
            `).run({
              id: detail.id, business_name: detail.business_name || '', fullname: detail.fullname || '',
              email: detail.email || '', phone: detail.phone || '', mobile: detail.mobile || '',
              address: detail.address || '', address_2: detail.address_2 || '', city: detail.city || '',
              state: detail.state || '', zip: detail.zip || '', notes: detail.notes || '',
              created_at: detail.created_at || '', updated_at: detail.updated_at || '',
              disabled: detail.disabled ? 1 : 0, location_name: detail.location_name || '',
              location_id: detail.location_id || '', pdf_url: detail.pdf_url || '',
              tax_rate_id: detail.tax_rate_id || '', invoice_term_id: detail.invoice_term_id || '',
              referred_by: detail.referred_by || '', ref_customer_id: detail.ref_customer_id || '',
              business_and_full_name: detail.business_and_full_name || '',
              business_then_name: detail.business_then_name || '',
              contacts: JSON.stringify(detail.contacts || []),
              properties: JSON.stringify(detail.properties || {}),
              notification_email: detail.notification_email || '',
              invoice_cc_emails: detail.invoice_cc_emails || '',
              get_sms: detail.get_sms ? 1 : 0, opt_out: detail.opt_out ? 1 : 0,
              no_email: detail.no_email ? 1 : 0, latitude: detail.latitude || '',
              longitude: detail.longitude || '', online_profile_url: detail.online_profile_url || '',
              raw_json: JSON.stringify(detail), synced: 1,
            });
          }
          synced++;
          emit(res, { phase: 'customers', status: 'progress', current: synced, total: customers.length });
          if (res.aborted) { emit(res, { phase: 'customers', status: 'cancelled' }); results.duration = Date.now() - startTime; emit(res, { phase: 'done', results }); res.end(); return; }
          await new Promise(r => setTimeout(r, 350));
        }

        results.customers = synced;
        log('SYNC_ENTITY', `Customers: +${synced}`);
        emit(res, { phase: 'customers', status: 'done', count: synced });
      } catch (e) {
        const detail = e instanceof ApiError
          ? { phase: 'customers', url: `${baseUrl}/${e.endpoint}`, pageOrId: e.pageOrId, status: e.status, response: e.body }
          : { phase: 'customers', error: e.message };
        results.errors.push(`customers: ${e.message}`);
        log('SYNC_ERROR', JSON.stringify(detail));
        emit(res, { phase: 'customers', status: 'error', error: e.message });
      }
      if (singlePhase) { results.duration = Date.now() - startTime; emit(res, { phase: 'done', results }); res.end(); return; }
    }

    // ── CONTACTS ───────────────────────────────────────────────────────────────
    if (phasesToRun.includes('contacts')) {
      emit(res, { phase: 'contacts', status: 'started', message: 'Syncing contacts...' });
      try {
        const { records: contacts, latestUpdatedAt } = await fetchList('contacts', localMax, limit, 'contacts', forceAll);
        updateGlobalLatest(latestUpdatedAt);
        let synced = 0;

        for (const c of contacts) {
          const existing = db.prepare('SELECT synced, updated_at FROM contacts WHERE id = ?').get(c.id);
          if (existing && existing.synced === 1 && existing.updated_at === c.updated_at) {
            db.prepare('UPDATE contacts SET name=?, updated_at=? WHERE id=?').run(
              c.name || '', c.updated_at || '', c.id
            );
          } else {
            const detail = await fetchDetail('contacts', c.id, 'contacts');
            db.prepare(`
              INSERT OR REPLACE INTO contacts (
                id, customer_id, name, address1, address2, city, state, zip,
                email, phone, mobile, latitude, longitude, notes, created_at, updated_at,
                vendor_id, opt_out, extension, processed_phone, processed_mobile,
                ticket_matching_emails, properties, account_id, raw_json, synced
              ) VALUES (
                @id, @customer_id, @name, @address1, @address2, @city, @state, @zip,
                @email, @phone, @mobile, @latitude, @longitude, @notes, @created_at, @updated_at,
                @vendor_id, @opt_out, @extension, @processed_phone, @processed_mobile,
                @ticket_matching_emails, @properties, @account_id, @raw_json, @synced
              )
            `).run({
              id: detail.id, customer_id: detail.customer_id, name: detail.name || '',
              address1: detail.address1 || '', address2: detail.address2 || '', city: detail.city || '',
              state: detail.state || '', zip: detail.zip || '', email: detail.email || '',
              phone: detail.phone || '', mobile: detail.mobile || '', latitude: detail.latitude || '',
              longitude: detail.longitude || '', notes: detail.notes || '',
              created_at: detail.created_at || '', updated_at: detail.updated_at || '',
              vendor_id: detail.vendor_id || '', opt_out: detail.opt_out ? 1 : 0,
              extension: detail.extension || '', processed_phone: detail.processed_phone || '',
              processed_mobile: detail.processed_mobile || '',
              ticket_matching_emails: JSON.stringify(detail.ticket_matching_emails || []),
              properties: JSON.stringify(detail.properties || {}),
              account_id: detail.account_id || '',
              raw_json: JSON.stringify(detail), synced: 1,
            });
          }
          synced++;
          emit(res, { phase: 'contacts', status: 'progress', current: synced, total: contacts.length });
          if (res.aborted) { emit(res, { phase: 'contacts', status: 'cancelled' }); results.duration = Date.now() - startTime; emit(res, { phase: 'done', results }); res.end(); return; }
          await new Promise(r => setTimeout(r, 350));
        }

        results.contacts = synced;
        log('SYNC_ENTITY', `Contacts: +${synced}`);
        emit(res, { phase: 'contacts', status: 'done', count: synced });
      } catch (e) {
        const detail = e instanceof ApiError
          ? { phase: 'contacts', url: `${baseUrl}/${e.endpoint}`, pageOrId: e.pageOrId, status: e.status, response: e.body }
          : { phase: 'contacts', error: e.message };
        results.errors.push(`contacts: ${e.message}`);
        log('SYNC_ERROR', JSON.stringify(detail));
        emit(res, { phase: 'contacts', status: 'error', error: e.message });
      }
      if (singlePhase) { results.duration = Date.now() - startTime; emit(res, { phase: 'done', results }); res.end(); return; }
    }

    // ── TICKETS ────────────────────────────────────────────────────────────────
    if (phasesToRun.includes('tickets')) {
      emit(res, { phase: 'tickets', status: 'started', message: 'Syncing tickets...' });
      try {
        const { records: tickets, latestUpdatedAt } = await fetchList('tickets', localMax, limit, 'tickets', forceAll);
        updateGlobalLatest(latestUpdatedAt);
        let synced = 0;

        for (const t of tickets) {
          // Skip already-synced resolved tickets with no change; non-resolved always refetch
          const existingTicket = db.prepare('SELECT synced, updated_at FROM tickets WHERE id = ?').get(t.id);
          if (existingTicket && existingTicket.synced === 1 && existingTicket.updated_at === t.updated_at && t.status === 'resolved') {
            // Already fully synced and unchanged — skip detail fetch
          } else {
            const detail = await fetchDetail('tickets', t.id, 'tickets');

            // Upsert ticket with raw_json
            db.prepare(`
              INSERT OR REPLACE INTO tickets (
                id, number, subject, created_at, customer_id, customer_business_then_name,
                due_date, resolved_at, start_at, end_at, location_id, problem_type, status,
                ticket_type_id, user_id, updated_at, pdf_url, priority, comments, user, raw_json, synced
              ) VALUES (
                @id, @number, @subject, @created_at, @customer_id, @customer_business_then_name,
                @due_date, @resolved_at, @start_at, @end_at, @location_id, @problem_type, @status,
                @ticket_type_id, @user_id, @updated_at, @pdf_url, @priority, @comments, @user, @raw_json, @synced
              )
            `).run({
              id: detail.id, number: String(detail.number || ''), subject: detail.subject || '',
              created_at: detail.created_at || '', customer_id: detail.customer_id,
              customer_business_then_name: detail.customer_business_then_name || '',
              due_date: detail.due_date || '', resolved_at: detail.resolved_at || '',
              start_at: detail.start_at || '', end_at: detail.end_at || '',
              location_id: detail.location_id || '', problem_type: detail.problem_type || '',
              status: detail.status || '', ticket_type_id: detail.ticket_type_id || '',
              user_id: detail.user_id || '', updated_at: detail.updated_at || '',
              pdf_url: detail.pdf_url || '', priority: detail.priority || '',
              comments: JSON.stringify(detail.comments || []),
              user: detail.user ? JSON.stringify(detail.user) : '',
              raw_json: JSON.stringify(detail), synced: 1,
            });

            // Upsert comments from detail response
            const comments = detail.comments || [];
            for (const c of comments) {
              db.prepare(`
                INSERT OR REPLACE INTO ticket_comments (
                  id, ticket_id, body, tech, user_id, created_at, updated_at, raw_json
                ) VALUES (
                  @id, @ticket_id, @body, @tech, @user_id, @created_at, @updated_at, @raw_json
                )
              `).run({
                id: c.id, ticket_id: detail.id,
                body: c.body || '', tech: c.tech || c.user || c.author || '',
                user_id: c.user_id || '', created_at: c.created_at || '',
                updated_at: c.updated_at || '',
                raw_json: JSON.stringify(c),
              });
            }
            results.ticket_comments += comments.length;

            // Upsert time entries (ticket_timers in API response)
            const timers = detail.ticket_timers || [];
            for (const te of timers) {
              db.prepare(`
                INSERT OR REPLACE INTO ticket_time_entries (
                  id, ticket_id, user_id, start_time, end_time, recorded, billable,
                  notes, active_duration, product_id, created_at, updated_at, raw_json
                ) VALUES (
                  @id, @ticket_id, @user_id, @start_time, @end_time, @recorded, @billable,
                  @notes, @active_duration, @product_id, @created_at, @updated_at, @raw_json
                )
              `).run({
                id: te.id, ticket_id: detail.id,
                user_id: te.user_id || '', start_time: te.start_time || '',
                end_time: te.end_time || '', recorded: te.recorded ? 1 : 0,
                billable: te.billable ? 1 : 0, notes: te.notes || '',
                active_duration: te.active_duration || 0, product_id: te.product_id || '',
                created_at: te.created_at || '', updated_at: te.updated_at || '',
                raw_json: JSON.stringify(te),
              });
            }
            results.ticket_time_entries += timers.length;

            // Upsert line items
            const lineItems = detail.line_items || [];
            for (const li of lineItems) {
              db.prepare(`
                INSERT OR REPLACE INTO ticket_line_items (
                  id, ticket_id, product_id, quantity, price, description, created_at, updated_at, raw_json
                ) VALUES (
                  @id, @ticket_id, @product_id, @quantity, @price, @description, @created_at, @updated_at, @raw_json
                )
              `).run({
                id: li.id, ticket_id: detail.id,
                product_id: li.product_id || '',
                quantity: parseFloat(li.quantity) || 0,
                price: parseFloat(li.retail_cents) / 100 || parseFloat(li.price) || 0,
                description: li.description || li.name || '',
                created_at: li.created_at || '', updated_at: li.updated_at || '',
                raw_json: JSON.stringify(li),
              });
            }
            results.ticket_line_items += lineItems.length;
          }

          synced++;
          emit(res, { phase: 'tickets', status: 'progress', current: synced, total: tickets.length });
          if (res.aborted) { emit(res, { phase: 'tickets', status: 'cancelled' }); results.duration = Date.now() - startTime; emit(res, { phase: 'done', results }); res.end(); return; }
          await new Promise(r => setTimeout(r, 350));
        }

        results.tickets = synced;
        log('SYNC_ENTITY', `Tickets: +${synced} (comments:+${results.ticket_comments} timers:+${results.ticket_time_entries} line_items:+${results.ticket_line_items})`);
        emit(res, { phase: 'tickets', status: 'done', count: synced });
      } catch (e) {
        const detail = e instanceof ApiError
          ? { phase: 'tickets', url: `${baseUrl}/${e.endpoint}`, pageOrId: e.pageOrId, status: e.status, response: e.body }
          : { phase: 'tickets', error: e.message };
        results.errors.push(`tickets: ${e.message}`);
        log('SYNC_ERROR', JSON.stringify(detail));
        emit(res, { phase: 'tickets', status: 'error', error: e.message });
      }
      if (singlePhase) { results.duration = Date.now() - startTime; emit(res, { phase: 'done', results }); res.end(); return; }
    }

    // ── INVOICES ───────────────────────────────────────────────────────────────
    if (phasesToRun.includes('invoices')) {
      emit(res, { phase: 'invoices', status: 'started', message: 'Syncing invoices...' });
      try {
        const { records: invoices, latestUpdatedAt } = await fetchList('invoices', localMax, limit, 'invoices', forceAll);
        updateGlobalLatest(latestUpdatedAt);
        let synced = 0;

        for (const inv of invoices) {
          const existing = db.prepare('SELECT synced, updated_at FROM invoices WHERE id = ?').get(inv.id);
          if (existing && existing.synced === 1 && existing.updated_at === inv.updated_at) {
            db.prepare('UPDATE invoices SET customer_business_then_name=?, updated_at=? WHERE id=?').run(
              inv.customer_business_then_name || '', inv.updated_at || '', inv.id
            );
          } else {
            const detail = await fetchDetail('invoices', inv.id, 'invoices');
            db.prepare(`
              INSERT OR REPLACE INTO invoices (
                id, customer_id, customer_business_then_name, number, created_at, updated_at,
                date, due_date, subtotal, total, tax, verified_paid, tech_marked_paid,
                ticket_id, pdf_url, is_paid, location_id, po_number, contact_id, note,
                hardwarecost, user_id, raw_json, synced
              ) VALUES (
                @id, @customer_id, @customer_business_then_name, @number, @created_at, @updated_at,
                @date, @due_date, @subtotal, @total, @tax, @verified_paid, @tech_marked_paid,
                @ticket_id, @pdf_url, @is_paid, @location_id, @po_number, @contact_id, @note,
                @hardwarecost, @user_id, @raw_json, @synced
              )
            `).run({
              id: detail.id, customer_id: detail.customer_id,
              customer_business_then_name: detail.customer_business_then_name || detail.customer?.business_name || detail.customer?.fullname || '',
              number: String(detail.number || ''), created_at: detail.created_at || '',
              updated_at: detail.updated_at || '', date: detail.date || '',
              due_date: detail.due_date || '', subtotal: detail.subtotal || '',
              total: detail.total || '', tax: detail.tax || '',
              verified_paid: detail.verified_paid ? 1 : 0,
              tech_marked_paid: detail.tech_marked_paid ? 1 : 0,
              ticket_id: detail.ticket_id || '', pdf_url: detail.pdf_url || '',
              is_paid: detail.is_paid ? 1 : 0, location_id: detail.location_id || '',
              po_number: detail.po_number || '', contact_id: detail.contact_id || '',
              note: detail.note || '', hardwarecost: detail.hardwarecost || '',
              user_id: detail.user_id || '',
              raw_json: JSON.stringify(detail), synced: 1,
            });
          }
          synced++;
          emit(res, { phase: 'invoices', status: 'progress', current: synced, total: invoices.length });
          if (res.aborted) { emit(res, { phase: 'invoices', status: 'cancelled' }); results.duration = Date.now() - startTime; emit(res, { phase: 'done', results }); res.end(); return; }
          await new Promise(r => setTimeout(r, 350));
        }

        results.invoices = synced;
        log('SYNC_ENTITY', `Invoices: +${synced}`);
        emit(res, { phase: 'invoices', status: 'done', count: synced });
      } catch (e) {
        const detail = e instanceof ApiError
          ? { phase: 'invoices', url: `${baseUrl}/${e.endpoint}`, pageOrId: e.pageOrId, status: e.status, response: e.body }
          : { phase: 'invoices', error: e.message };
        results.errors.push(`invoices: ${e.message}`);
        log('SYNC_ERROR', JSON.stringify(detail));
        emit(res, { phase: 'invoices', status: 'error', error: e.message });
      }
      if (singlePhase) { results.duration = Date.now() - startTime; emit(res, { phase: 'done', results }); res.end(); return; }
    }

    // ── ASSETS ────────────────────────────────────────────────────────────────
    if (phasesToRun.includes('assets')) {
      emit(res, { phase: 'assets', status: 'started', message: 'Syncing assets...' });
      try {
        const { records: assets, latestUpdatedAt } = await fetchList('customer_assets', localMax, limit, 'assets', forceAll);
        updateGlobalLatest(latestUpdatedAt);
        let synced = 0;

        for (const a of assets) {
          const existing = db.prepare('SELECT synced, updated_at FROM assets WHERE id = ?').get(a.id);
          if (existing && existing.synced === 1 && existing.updated_at === a.updated_at) {
            db.prepare('UPDATE assets SET name=?, updated_at=? WHERE id=?').run(
              a.name || '', a.updated_at || '', a.id
            );
          } else {
            const detail = await fetchDetail('customer_assets', a.id, 'assets');
            db.prepare(`
              INSERT OR REPLACE INTO assets (
                id, name, customer_id, contact_id, created_at, updated_at,
                properties, asset_type, asset_serial, external_rmm_link, rmm_links,
                has_live_chat, snmp_enabled, device_info, rmm_store, address, customer, raw_json, synced
              ) VALUES (
                @id, @name, @customer_id, @contact_id, @created_at, @updated_at,
                @properties, @asset_type, @asset_serial, @external_rmm_link, @rmm_links,
                @has_live_chat, @snmp_enabled, @device_info, @rmm_store, @address, @customer, @raw_json, @synced
              )
            `).run({
              id: detail.id, name: detail.name || '',
              customer_id: detail.customer_id || null, contact_id: detail.contact_id || null,
              created_at: detail.created_at || '', updated_at: detail.updated_at || '',
              properties: JSON.stringify(detail.properties || {}),
              asset_type: detail.asset_type || '', asset_serial: detail.asset_serial || '',
              external_rmm_link: detail.external_rmm_link || '',
              rmm_links: JSON.stringify(detail.rmm_links || []),
              has_live_chat: detail.has_live_chat ? 1 : 0,
              snmp_enabled: detail.snmp_enabled ? 1 : 0,
              device_info: JSON.stringify(detail.device_info || {}),
              rmm_store: JSON.stringify(detail.rmm_store || {}),
              address: JSON.stringify(detail.address || {}),
              customer: JSON.stringify(detail.customer || {}),
              raw_json: JSON.stringify(detail), synced: 1,
            });
          }
          synced++;
          emit(res, { phase: 'assets', status: 'progress', current: synced, total: assets.length });
          if (res.aborted) { emit(res, { phase: 'assets', status: 'cancelled' }); results.duration = Date.now() - startTime; emit(res, { phase: 'done', results }); res.end(); return; }
          await new Promise(r => setTimeout(r, 350));
        }

        results.assets = synced;
        log('SYNC_ENTITY', `Assets: +${synced}`);
        emit(res, { phase: 'assets', status: 'done', count: synced });
      } catch (e) {
        const detail = e instanceof ApiError
          ? { phase: 'assets', url: `${baseUrl}/${e.endpoint}`, pageOrId: e.pageOrId, status: e.status, response: e.body }
          : { phase: 'assets', error: e.message };
        results.errors.push(`assets: ${e.message}`);
        log('SYNC_ERROR', JSON.stringify(detail));
        emit(res, { phase: 'assets', status: 'error', error: e.message });
      }
      if (singlePhase) { results.duration = Date.now() - startTime; emit(res, { phase: 'done', results }); res.end(); return; }
    }

    // ── ESTIMATES ─────────────────────────────────────────────────────────────
    if (phasesToRun.includes('estimates')) {
      emit(res, { phase: 'estimates', status: 'started', message: 'Syncing estimates...' });
      try {
        const { records: estimates, latestUpdatedAt } = await fetchList('estimates', localMax, limit, 'estimates', forceAll);
        updateGlobalLatest(latestUpdatedAt);
        let synced = 0;

        for (const e of estimates) {
          const existing = db.prepare('SELECT synced, updated_at FROM estimates WHERE id = ?').get(e.id);
          if (existing && existing.synced === 1 && existing.updated_at === e.updated_at) {
            db.prepare('UPDATE estimates SET customer_business_then_name=?, updated_at=? WHERE id=?').run(
              e.customer_business_then_name || '', e.updated_at || '', e.id
            );
          } else {
            try {
              const detail = await fetchDetail('estimates', e.id, 'estimates');
              db.prepare(`
                INSERT OR REPLACE INTO estimates (
                  id, customer_business_then_name, number, status, created_at, updated_at,
                  customer_id, date, subtotal, total, tax, ticket_id, pdf_url,
                  location_id, invoice_id, employee, raw_json, synced
                ) VALUES (
                  @id, @customer_business_then_name, @number, @status, @created_at, @updated_at,
                  @customer_id, @date, @subtotal, @total, @tax, @ticket_id, @pdf_url,
                  @location_id, @invoice_id, @employee, @raw_json, @synced
                )
              `).run({
                id: detail.id,
                customer_business_then_name: detail.customer_business_then_name || '',
                number: String(detail.number || ''), status: detail.status || '',
                created_at: detail.created_at || '', updated_at: detail.updated_at || '',
                customer_id: detail.customer_id || null, date: detail.date || '',
                subtotal: detail.subtotal || '', total: detail.total || '', tax: detail.tax || '',
                ticket_id: detail.ticket_id || '', pdf_url: detail.pdf_url || '',
                location_id: detail.location_id || '', invoice_id: detail.invoice_id || '',
                employee: detail.employee || '',
                raw_json: JSON.stringify(detail), synced: 1,
              });
              synced++;
            } catch (detailErr) {
              const errDetail = detailErr instanceof ApiError
                ? { phase: 'estimates', item_id: e.id, url: `${baseUrl}/${detailErr.endpoint}/${e.id}`, method: 'GET', status: detailErr.status, response: detailErr.body }
                : { phase: 'estimates', item_id: e.id, error: detailErr.message };
              results.errors.push(`estimates/${e.id}: ${detailErr.message}`);
              log('SYNC_ERROR', JSON.stringify(errDetail));
            }
          }
          emit(res, { phase: 'estimates', status: 'progress', current: synced, total: estimates.length });
          if (res.aborted) { emit(res, { phase: 'estimates', status: 'cancelled' }); results.duration = Date.now() - startTime; emit(res, { phase: 'done', results }); res.end(); return; }
          await new Promise(r => setTimeout(r, 350));
        }

        results.estimates = synced;
        log('SYNC_ENTITY', `Estimates: +${synced}`);
        emit(res, { phase: 'estimates', status: 'done', count: synced });
      } catch (e) {
        const detail = e instanceof ApiError
          ? { phase: 'estimates', url: `${baseUrl}/${e.endpoint}`, pageOrId: e.pageOrId, status: e.status, response: e.body }
          : { phase: 'estimates', error: e.message };
        log('SYNC_ERROR', JSON.stringify(detail));
      }
      if (singlePhase) { results.duration = Date.now() - startTime; emit(res, { phase: 'done', results }); res.end(); return; }
    }

    // ── PURCHASE ORDERS ────────────────────────────────────────────────────────
    if (phasesToRun.includes('purchase_orders')) {
      emit(res, { phase: 'purchase_orders', status: 'started', message: 'Syncing purchase orders...' });
      try {
        const { records: pos, latestUpdatedAt } = await fetchList('purchase_orders', localMax, limit, 'purchase_orders', forceAll);
        updateGlobalLatest(latestUpdatedAt);
        let synced = 0;

        for (const p of pos) {
          const existing = db.prepare('SELECT synced, updated_at FROM purchase_orders WHERE id = ?').get(p.id);
          if (existing && existing.synced === 1 && existing.updated_at === p.updated_at) {
            db.prepare('UPDATE purchase_orders SET updated_at=? WHERE id=?').run(p.updated_at || '', p.id);
          } else {
            const detail = await fetchDetail('purchase_orders', p.id, 'purchase_orders');
            db.prepare(`
              INSERT OR REPLACE INTO purchase_orders (
                id, account_subdomain, created_at, updated_at, expected_date, number,
                other, shipping, shipping_notes, status, total, user_id, vendor_id,
                location_id, due_date, paid_date, delivery_tracking,
                vendor, location, line_items, raw_json, synced
              ) VALUES (
                @id, @account_subdomain, @created_at, @updated_at, @expected_date, @number,
                @other, @shipping, @shipping_notes, @status, @total, @user_id, @vendor_id,
                @location_id, @due_date, @paid_date, @delivery_tracking,
                @vendor, @location, @line_items, @raw_json, @synced
              )
            `).run({
              id: detail.id,
              account_subdomain: detail.account_subdomain || '',
              created_at: detail.created_at || '', updated_at: detail.updated_at || '',
              expected_date: detail.expected_date || '', number: detail.number || '',
              other: detail.other || '', shipping: detail.shipping || '',
              shipping_notes: detail.shipping_notes || '', status: detail.status || '',
              total: detail.total || '', user_id: detail.user_id || '',
              vendor_id: detail.vendor_id || null,
              location_id: detail.location_id || '',
              due_date: detail.due_date || '', paid_date: detail.paid_date || '',
              delivery_tracking: detail.delivery_tracking || '',
              vendor: JSON.stringify(detail.vendor || {}),
              location: JSON.stringify(detail.location || {}),
              line_items: JSON.stringify(detail.line_items || []),
              raw_json: JSON.stringify(detail), synced: 1,
            });
          }
          synced++;
          emit(res, { phase: 'purchase_orders', status: 'progress', current: synced, total: pos.length });
          if (res.aborted) { emit(res, { phase: 'purchase_orders', status: 'cancelled' }); results.duration = Date.now() - startTime; emit(res, { phase: 'done', results }); res.end(); return; }
          await new Promise(r => setTimeout(r, 350));
        }

        results.purchase_orders = synced;
        log('SYNC_ENTITY', `Purchase Orders: +${synced}`);
        emit(res, { phase: 'purchase_orders', status: 'done', count: synced });
      } catch (e) {
        const detail = e instanceof ApiError
          ? { phase: 'purchase_orders', url: `${baseUrl}/${e.endpoint}`, pageOrId: e.pageOrId, status: e.status, response: e.body }
          : { phase: 'purchase_orders', error: e.message };
        results.errors.push(`purchase_orders: ${e.message}`);
        log('SYNC_ERROR', JSON.stringify(detail));
        emit(res, { phase: 'purchase_orders', status: 'error', error: e.message });
      }
      if (singlePhase) { results.duration = Date.now() - startTime; emit(res, { phase: 'done', results }); res.end(); return; }
    }

    // ── VENDORS ────────────────────────────────────────────────────────────────
    if (phasesToRun.includes('vendors')) {
      emit(res, { phase: 'vendors', status: 'started', message: 'Syncing vendors...' });
      try {
        // Vendors list is a single page, no pagination
        const { records: vendors, latestUpdatedAt } = await fetchList('vendors', localMax, limit, 'vendors', forceAll);
        updateGlobalLatest(latestUpdatedAt);
        let synced = 0;

        for (const v of vendors) {
          const existing = db.prepare('SELECT synced, updated_at FROM vendors WHERE id = ?').get(v.id);
          if (existing && existing.synced === 1 && existing.updated_at === v.updated_at) {
            db.prepare('UPDATE vendors SET name=?, updated_at=? WHERE id=?').run(v.name || '', v.updated_at || '', v.id);
          } else {
            const detail = await fetchDetail('vendors', v.id, 'vendors');
            db.prepare(`
              INSERT OR REPLACE INTO vendors (
                id, name, rep_first_name, rep_last_name, email, phone,
                account_number, created_at, updated_at, address, city, state,
                zip, website, notes, raw_json, synced
              ) VALUES (
                @id, @name, @rep_first_name, @rep_last_name, @email, @phone,
                @account_number, @created_at, @updated_at, @address, @city, @state,
                @zip, @website, @notes, @raw_json, @synced
              )
            `).run({
              id: detail.id, name: detail.name || '',
              rep_first_name: detail.rep_first_name || '', rep_last_name: detail.rep_last_name || '',
              email: detail.email || '', phone: detail.phone || '',
              account_number: detail.account_number || '',
              created_at: detail.created_at || '', updated_at: detail.updated_at || '',
              address: detail.address || '', city: detail.city || '',
              state: detail.state || '', zip: detail.zip || '',
              website: detail.website || '', notes: detail.notes || '',
              raw_json: JSON.stringify(detail), synced: 1,
            });
          }
          synced++;
          emit(res, { phase: 'vendors', status: 'progress', current: synced, total: vendors.length });
          if (res.aborted) { emit(res, { phase: 'vendors', status: 'cancelled' }); results.duration = Date.now() - startTime; emit(res, { phase: 'done', results }); res.end(); return; }
          await new Promise(r => setTimeout(r, 350));
        }

        results.vendors = synced;
        log('SYNC_ENTITY', `Vendors: +${synced}`);
        emit(res, { phase: 'vendors', status: 'done', count: synced });
      } catch (e) {
        const detail = e instanceof ApiError
          ? { phase: 'vendors', url: `${baseUrl}/${e.endpoint}`, pageOrId: e.pageOrId, status: e.status, response: e.body }
          : { phase: 'vendors', error: e.message };
        results.errors.push(`vendors: ${e.message}`);
        log('SYNC_ERROR', JSON.stringify(detail));
        emit(res, { phase: 'vendors', status: 'error', error: e.message });
      }
      if (singlePhase) { results.duration = Date.now() - startTime; emit(res, { phase: 'done', results }); res.end(); return; }
    }

    setSetting('last_sync', globalLatest || new Date().toISOString());
    results.lastSync = globalLatest || new Date().toISOString();
    results.duration = Date.now() - startTime;

    log('SYNC_COMPLETE', `Sync complete — customers:+${results.customers} contacts:+${results.contacts} tickets:+${results.tickets} invoices:+${results.invoices} comments:+${results.ticket_comments} timers:+${results.ticket_time_entries} line_items:+${results.ticket_line_items} errors:${results.errors.length} duration:${results.duration}ms`);
    emit(res, { phase: 'done', results });

  } catch (e) {
    const detail = e instanceof ApiError
      ? { phase: 'sync', url: `${baseUrl}/${e.endpoint}`, pageOrId: e.pageOrId, status: e.status, response: e.body }
      : { phase: 'sync', error: e.message };
    log('SYNC_ERROR', JSON.stringify(detail));
    emit(res, { phase: 'error', error: e.message, results });
  }

  res.end();
});

// DELETE /api/sync/trigger - cancel an ongoing sync
router.delete('/trigger', (req, res) => {
  // The ongoing sync checks res.aborted flag and exits early
  // This endpoint just acknowledges the cancel request
  res.json({ cancelled: true });
});

// PATCH /api/sync/synced - toggle synced flag for a record
// Body: { table: string, id: number, synced: boolean }
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

// GET /api/sync/trigger?status=1 - check if a sync is currently running
router.get('/trigger', (req, res) => {
  if (req.query.status) {
    // Return whether sync is running — always returns false since we can't track
    // per-connection state persistently. The frontend reconnects via SSE.
    res.json({ running: false });
  }
});

export default router;
