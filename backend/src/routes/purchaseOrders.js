import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../db/database.js';
import { fetchPoAttachments, SyncroSessionExpired, getWebSessionCredentials } from '../lib/syncroSession.js';

const router = Router();

const ATTACHMENTS_DIR = path.resolve(process.cwd(), 'data/attachments');

// Sanitize a filename for safe local storage (mirrors sync.js's sanitizeFilename).
function sanitizeFilename(name) {
  if (!name) return 'unnamed';
  const base = String(name).replace(/[\\/]/g, '_').replace(/\.\.+/g, '.').trim();
  const cleaned = base.replace(/[^A-Za-z0-9._\-\s]/g, '_').slice(0, 200);
  return cleaned || 'unnamed';
}

// MIME map for cached attachment files (mirrors tickets.js).
const MIME_BY_EXT = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', txt: 'text/plain', csv: 'text/csv',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip', json: 'application/json', html: 'text/html',
};
function guessContentType(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

// GET /api/purchase-orders - all POs
router.get('/', (req, res) => {
  const db = getDb();
  const { page = 1, limit = 50, sortCol = 'created_at', sortDir = 'desc',
          filter_number, filter_status, filter_total, filter_created_at, filter_due_date } = req.query;
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  if (filter_number) {
    conditions.push('number LIKE ?');
    params.push(`%${filter_number}%`);
  }
  if (filter_status) {
    conditions.push('status LIKE ?');
    params.push(`%${filter_status}%`);
  }
  if (filter_total) {
    conditions.push('total LIKE ?');
    params.push(`%${filter_total}%`);
  }
  if (filter_created_at) {
    conditions.push('created_at LIKE ?');
    params.push(`%${filter_created_at}%`);
  }
  if (filter_due_date) {
    conditions.push('due_date LIKE ?');
    params.push(`%${filter_due_date}%`);
  }

  const whereStr = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  // Map each whitelisted sort key to its SQL expression. Keys are still validated
  // against validSorts below, so values are injection-safe. This lets us CAST TEXT
  // columns (total) to REAL for numeric ordering and pull vendor name out of the
  // JSON blob with json_extract instead of sorting on the raw JSON.
  const sortExprs = {
    created_at: 'po.created_at',
    due_date: 'po.due_date',
    number: 'po.number',
    total: 'CAST(po.total AS REAL)',
    status: 'po.status',
    vendor_name: "COALESCE(json_extract(po.vendor, '$.name'), '')",
  };
  const validSorts = Object.keys(sortExprs);
  const safeSort = validSorts.includes(sortCol) ? sortCol : 'created_at';
  const safeDir = sortDir === 'asc' ? 'ASC' : 'DESC';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM purchase_orders ${whereStr}`).get(...params);
  const pos = db.prepare(`
    SELECT po.id, po.number, po.status, po.total, po.created_at, po.due_date, po.paid_date,
           po.vendor_id, po.vendor, po.synced, po.attachments_count
    FROM purchase_orders po ${whereStr}
    ORDER BY ${sortExprs[safeSort]} ${safeDir}, po.id ASC
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));

  const result = pos.map(po => {
    if (po.vendor && typeof po.vendor === 'string') {
      try {
        const v = JSON.parse(po.vendor);
        po.vendor_name = v.name || po.vendor;
      } catch (e) {
        po.vendor_name = po.vendor;
      }
    }
    return po;
  });

  res.json({
    data: result,
    pagination: { page: Number(page), limit: Number(limit), total: countRow.total },
  });
});

// GET /api/purchase-orders/:id/pdf - generate a PDF for this purchase order
router.get('/:id/pdf', async (req, res) => {
  try {
    const { generatePdf } = await import('../services/pdf.js');
    const result = await generatePdf('purchase_order', req.params.id);
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Purchase Order ${result.number}.pdf"`);
    res.send(result.buffer);
  } catch (e) {
    console.error('[purchase-orders/pdf] generation failed:', e);
    res.status(500).json({ error: 'PDF generation failed', detail: e.message });
  }
});

// GET /api/purchase-orders/:id/attachments - list locally-cached QBO attachments
// Mirrors tickets.js GET /:id/attachments. Files live under po-<number> (prefixed
// to avoid collision with ticket attachment folders keyed by ticket number).
router.get('/:id/attachments', (req, res) => {
  const db = getDb();
  const po = db.prepare('SELECT id, number, attachments_count, attachments_synced_at FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!po) return res.status(404).json({ error: 'Not found' });

  const poNumber = String(po.number || po.id);
  const poDir = path.join(ATTACHMENTS_DIR, `po-${poNumber}`);
  let files = [];
  if (fs.existsSync(poDir) && fs.statSync(poDir).isDirectory()) {
    files = fs.readdirSync(poDir)
      .filter(name => !name.startsWith('.'))
      .map(name => {
        const full = path.join(poDir, name);
        const stat = fs.statSync(full);
        return {
          name,
          size: stat.size,
          url: `/api/attachments/po-${encodeURIComponent(poNumber)}/${encodeURIComponent(name)}`,
          content_type: guessContentType(name),
        };
      });
  }
  res.json({
    data: files,
    count: files.length,
    attachments_count: po.attachments_count || 0,
    attachments_synced_at: po.attachments_synced_at || null,
  });
});

// POST /api/purchase-orders/:id/sync-attachments - pull attachments for one PO
// ?source=syncro → scrape the Syncro web PO show page with the session cookie.
// ?source=qbo (default) → pull from QuickBooks Online (existing behavior).
router.post('/:id/sync-attachments', async (req, res) => {
  const db = getDb();
  const source = req.query.source || 'qbo';
  const po = db.prepare('SELECT id, number, qbo_id FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!po) return res.status(404).json({ error: 'Not found' });

  // ─── Syncro web (cookie-scrape) source ──────────────────────────────────
  if (source === 'syncro') {
    if (!getWebSessionCredentials()) {
      return res.status(400).json({ error: 'Syncro web session not configured — paste a cookie in Config → Syncro Web Session.' });
    }
    const poNumber = String(po.number || po.id);
    const poDir = path.join(ATTACHMENTS_DIR, `po-${poNumber}`);
    try {
      const attachments = await fetchPoAttachments(po);
      if (attachments.length === 0) {
        db.prepare('UPDATE purchase_orders SET attachments_count = 0, attachments_synced_at = datetime(\'now\') WHERE id = ?').run(po.id);
        return res.json({ downloaded: 0, skipped: 0, errors: [], source: 'syncro', message: 'No attachments on this PO in Syncro.' });
      }
      try { fs.mkdirSync(poDir, { recursive: true }); } catch (_) {}
      let downloaded = 0;
      let skipped = 0;
      const errors = [];
      for (const att of attachments) {
        const safeName = sanitizeFilename(att.fileName || `attachment_${att.id || 'unknown'}`);
        const dest = path.join(poDir, safeName);
        if (fs.existsSync(dest)) { skipped++; continue; }
        try {
          const dlResp = await fetch(att.downloadUrl);
          if (!dlResp.ok) throw new Error(`download HTTP ${dlResp.status}`);
          const buf = Buffer.from(await dlResp.arrayBuffer());
          fs.writeFileSync(dest, buf);
          downloaded++;
        } catch (e) {
          errors.push(`${att.fileName}: ${e.message}`);
        }
      }
      db.prepare('UPDATE purchase_orders SET attachments_count = ?, attachments_synced_at = datetime(\'now\') WHERE id = ?').run(downloaded + skipped, po.id);
      res.json({ downloaded, skipped, errors, source: 'syncro' });
    } catch (e) {
      if (e instanceof SyncroSessionExpired) {
        return res.status(400).json({ error: e.message });
      }
      console.error('[purchase-orders/sync-attachments:syncro] failed:', e);
      res.status(500).json({ error: 'Syncro attachment sync failed', detail: e.message });
    }
    return;
  }

  // ─── QBO source (default, existing behavior) ────────────────────────────
  try {
    const { syncPoAttachments, isQboConnected } = await import('../lib/qboClient.js');
    if (!isQboConnected()) {
      return res.status(400).json({ error: 'QuickBooks Online is not connected. Save app credentials and click Connect in Config → QuickBooks Online.' });
    }
    const result = await syncPoAttachments(po);
    res.json(result);
  } catch (e) {
    console.error('[purchase-orders/sync-attachments] failed:', e);
    res.status(500).json({ error: 'QBO attachment sync failed', detail: e.message });
  }
});

// GET /api/purchase-orders/:id - PO detail
router.get('/:id', (req, res) => {
  const db = getDb();
  const po = db.prepare('SELECT *, raw_json, synced FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!po) return res.status(404).json({ error: 'Not found' });

  if (po.vendor && typeof po.vendor === 'string') {
    try {
      po.vendor = JSON.parse(po.vendor);
    } catch (e) {}
  }

  if (po.line_items && typeof po.line_items === 'string') {
    try {
      po.line_items = JSON.parse(po.line_items);
    } catch (e) {}
  }

  if (Array.isArray(po.line_items) && po.line_items.length > 0) {
    const productIds = po.line_items.map(li => li.product_id).filter(id => id);
    if (productIds.length > 0) {
      const placeholders = productIds.map(() => '?').join(',');
      const products = db.prepare(`SELECT id, name FROM products WHERE id IN (${placeholders})`).all(...productIds);
      const productMap = {};
      for (const p of products) {
        productMap[p.id] = p.name;
      }
      for (const li of po.line_items) {
        li.product_name = productMap[li.product_id] || null;
      }
    }

    // Attach serials received on this PO, grouped by product_id. The po_id
    // link is populated by the serial_po_links sync job (web-cookie scrape).
    const serials = db.prepare(
      'SELECT id, product_id, serial_number, status, created_at FROM product_serials WHERE po_id = ? ORDER BY created_at ASC'
    ).all(po.id);
    const serialsByProduct = {};
    for (const s of serials) {
      const key = s.product_id;
      if (!serialsByProduct[key]) serialsByProduct[key] = [];
      serialsByProduct[key].push(s);
    }
    for (const li of po.line_items) {
      li.serials = li.product_id ? (serialsByProduct[li.product_id] || []) : [];
    }
  }

  res.json(po);
});

export default router;
