import { Router } from 'express';
import { getDb } from '../db/database.js';
import { getSetting } from '../lib/settings.js';
import { resolveSerialPo } from '../lib/syncroSession.js';

const router = Router();

// GET /api/serials/:serial — serial record + every linked entity (product,
// ticket, invoice, estimate, asset, purchase order).
//
// PO linkage is NOT available via the public Syncro API. It's recovered by the
// serial_po_links batch job (which scrapes the web app's internal serial-history
// endpoint with a stored session cookie and persists po_id). See
// lib/syncroSession.js + handoff-serial-to-po.md.
//
// po_id semantics: NULL = not yet looked up (fall back to live scrape);
// 0 = looked up, no PO found; >0 = the PO id (fast path — fetch via public API).
router.get('/:serial', async (req, res) => {
  const db = getDb();
  const serial = db.prepare(`
    SELECT id, product_id, serial_number, account_id, status, line_item_id, po_id, created_at, updated_at, raw_json
    FROM product_serials WHERE serial_number = ? COLLATE NOCASE
    LIMIT 1
  `).get(req.params.serial);
  if (!serial) return res.status(404).json({ error: 'Serial not found' });

  const product = db.prepare('SELECT id, name, raw_json FROM products WHERE id = ?').get(serial.product_id) || null;

  let ticket = null;
  let invoice = null;
  let estimate = null;

  if (serial.line_item_id) {
    ticket = db.prepare(`
      SELECT tickets.id, tickets.number, tickets.subject, tickets.status, tickets.priority, tickets.customer_business_then_name, tickets.created_at, tickets.raw_json
      FROM ticket_line_items
      JOIN tickets ON ticket_line_items.ticket_id = tickets.id
      WHERE ticket_line_items.id = ?
    `).get(serial.line_item_id) || null;

    invoice = db.prepare(`
      SELECT invoices.id, invoices.number, invoices.total, invoices.is_paid, invoices.created_at, invoices.raw_json
      FROM invoices, json_each(invoices.raw_json, '$.line_items')
      WHERE json_extract(value, '$.id') = ?
      LIMIT 1
    `).get(serial.line_item_id) || null;

    estimate = db.prepare(`
      SELECT estimates.id, estimates.number, estimates.status, estimates.total, estimates.created_at, estimates.raw_json
      FROM estimates, json_each(estimates.raw_json, '$.line_items')
      WHERE json_extract(value, '$.id') = ?
      LIMIT 1
    `).get(serial.line_item_id) || null;
  }

  const asset = db.prepare(`
    SELECT id, name, asset_type, asset_serial, customer_id, created_at, updated_at, raw_json
    FROM assets WHERE asset_serial = ? COLLATE NOCASE
    LIMIT 1
  `).get(serial.serial_number) || null;

  // Resolve the purchase order the serial was received on.
  // Fast path: po_id already persisted by the batch job → fetch via public API.
  // Fallback: po_id is NULL → live scrape (on-demand, for serials not yet batch-linked).
  let po = null;
  let poReason = 'error';
  let poError = null;

  if (serial.po_id != null) {
    if (serial.po_id > 0) {
      // Persisted link — fetch rich PO data via the public API (the supported path).
      try {
        const apiKey = getSetting('syncro_api_key');
        const subdomain = getSetting('syncro_subdomain');
        if (apiKey && subdomain) {
          const resp = await fetch(`https://${subdomain}.syncromsp.com/api/v1/purchase_orders/${serial.po_id}`, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
          });
          if (resp.ok) {
            const data = await resp.json();
            po = data.purchase_order || data;
            poReason = 'ok';
          } else {
            // API fetch failed — still return the id so the UI can link to the PO page.
            po = { id: serial.po_id };
            poReason = 'ok';
            poError = `PO fetch HTTP ${resp.status}`;
          }
        } else {
          po = { id: serial.po_id };
          poReason = 'ok';
        }
      } catch (e) {
        po = { id: serial.po_id };
        poReason = 'ok';
        poError = e.message;
      }
    } else {
      // po_id === 0: already looked up, no PO found.
      po = null;
      poReason = 'no_po';
    }
  } else {
    // po_id is NULL: not yet batch-linked — fall back to live on-demand scrape.
    try {
      const poResult = await resolveSerialPo({ serial, product });
      po = poResult.po;
      poReason = poResult.reason;
      poError = poResult.error || null;
    } catch (e) {
      poError = e.message;
    }
  }

  res.json({
    serial,
    product,
    ticket,
    invoice,
    estimate,
    asset,
    po,
    poReason,
    poError,
  });
});

export default router;
