import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// Enrich line_items parsed from raw_json with product names from products table.
function enrichLineItems(lineItems) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return lineItems;
  const db = getDb();
  const ids = lineItems.map(li => li.product_id).filter(id => id != null && id !== '');
  if (ids.length === 0) return lineItems;
  const uniqIds = [...new Set(ids.map(String))];
  const placeholders = uniqIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, name FROM products WHERE id IN (${placeholders})`).all(...uniqIds);
  const map = new Map(rows.map(r => [String(r.id), r.name]));
  for (const li of lineItems) {
    if (li.product_id != null && li.product_id !== '') {
      li.product_name = map.get(String(li.product_id)) || li.product_name || null;
    }
  }
  return lineItems;
}

// GET /api/estimates - all estimates
router.get('/', (req, res) => {
  const db = getDb();
  const {
    page = 1, limit = 50, sortCol = 'date', sortDir = 'desc',
    filter_number, filter_customer_business_then_name, filter_status, filter_date, filter_total,
  } = req.query;
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];
  if (filter_number) { conditions.push('e.number LIKE ?'); params.push(`%${filter_number}%`); }
  if (filter_customer_business_then_name) { conditions.push('e.customer_business_then_name LIKE ?'); params.push(`%${filter_customer_business_then_name}%`); }
  if (filter_status) { conditions.push('e.status LIKE ?'); params.push(`%${filter_status}%`); }
  if (filter_date) { conditions.push('e.date LIKE ?'); params.push(`%${filter_date}%`); }
  if (filter_total) { conditions.push('CAST(e.total AS TEXT) LIKE ?'); params.push(`%${filter_total}%`); }

  const whereStr = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const validSorts = ['date', 'number', 'status', 'total', 'created_at'];
  const safeSort = validSorts.includes(sortCol) ? sortCol : 'date';
  const safeDir = sortDir === 'asc' ? 'ASC' : 'DESC';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM estimates e ${whereStr}`).get(...params);
  const estimates = db.prepare(`
    SELECT e.id, e.number, e.status, e.date, e.subtotal, e.total, e.tax,
           e.customer_id, e.customer_business_then_name, e.raw_json, e.synced
    FROM estimates e ${whereStr}
    ORDER BY e.${safeSort} ${safeDir}
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));

  const result = estimates.map(e => {
    if (e.raw_json && typeof e.raw_json === 'string') {
      try {
        const raw = JSON.parse(e.raw_json);
        if (raw.customer) {
          const name = raw.customer.business_then_name || raw.customer.business_name || raw.customer.fullname;
          if (name) e.customer_business_then_name = name;
          e.customer_name = name || e.customer_business_then_name;
          e.customer = raw.customer;
        }
      } catch (_) {}
    }
    return e;
  });

  res.json({
    data: result,
    pagination: { page: Number(page), limit: Number(limit), total: countRow.total },
  });
});

// GET /api/estimates/:id/pdf - generate a PDF for this estimate
router.get('/:id/pdf', async (req, res) => {
  try {
    const { generatePdf } = await import('../services/pdf.js');
    const result = await generatePdf('estimate', req.params.id);
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Estimate ${result.number}.pdf"`);
    res.send(result.buffer);
  } catch (e) {
    console.error('[estimates/pdf] generation failed:', e);
    res.status(500).json({ error: 'PDF generation failed', detail: e.message });
  }
});

// GET /api/estimates/:id - estimate detail
router.get('/:id', (req, res) => {
  const db = getDb();
  const est = db.prepare('SELECT *, raw_json, synced FROM estimates WHERE id = ?').get(req.params.id);
  if (!est) return res.status(404).json({ error: 'Not found' });

  // Resolve linked ticket + invoice numbers (raw record only stores IDs)
  if (est.ticket_id) {
    const t = db.prepare('SELECT number, subject, status FROM tickets WHERE id = ?').get(String(Number(est.ticket_id)));
    if (t) est.ticket = t;
  }
  if (est.invoice_id) {
    const inv = db.prepare('SELECT number FROM invoices WHERE id = ?').get(String(Number(est.invoice_id)));
    if (inv) est.invoice = inv;
  }

  // Parse + enrich line_items with product names from products table
  est.line_items = [];
  if (est.raw_json) {
    try {
      const raw = typeof est.raw_json === 'string' ? JSON.parse(est.raw_json) : est.raw_json;
      if (Array.isArray(raw.line_items)) {
        est.line_items = enrichLineItems(raw.line_items);
      }
    } catch (_) {}
  }

  res.json(est);
});

export default router;
