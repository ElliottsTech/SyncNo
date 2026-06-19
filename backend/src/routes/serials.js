import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// GET /api/serials/:serial — serial record + every linked entity (product, ticket, invoice, estimate, asset)
// PO linkage is not available: Syncro API exposes no PO→serial field.
router.get('/:serial', (req, res) => {
  const db = getDb();
  const serial = db.prepare(`
    SELECT id, product_id, serial_number, account_id, status, line_item_id, created_at, updated_at, raw_json
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

  res.json({
    serial,
    product,
    ticket,
    invoice,
    estimate,
    asset,
  });
});

export default router;
