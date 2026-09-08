import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// Parse invoice_ids stored as JSON array text back to array of ints.
function parseInvoiceIds(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch (_) {
    return [];
  }
}

// GET /api/payments - all payments (paginated, filterable)
router.get('/', (req, res) => {
  const db = getDb();
  const {
    page = 1,
    limit = 50,
    sortCol = 'applied_at',
    sortDir = 'desc',
    filter_ref_num,
    filter_payment_method,
    filter_customer_id,
  } = req.query;
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  if (filter_ref_num) {
    conditions.push('ref_num LIKE ?');
    params.push(`%${filter_ref_num}%`);
  }
  if (filter_payment_method) {
    conditions.push('payment_method LIKE ?');
    params.push(`%${filter_payment_method}%`);
  }
  if (filter_customer_id) {
    conditions.push('customer_id = ?');
    params.push(Number(filter_customer_id));
  }

  const whereStr = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  // Map each whitelisted sort key to its SQL expression. payment_amount is
  // stored as TEXT — CAST it to REAL for numeric ordering. `customer` is a JSON
  // blob; pull the name out so the Customer column sorts alphabetically.
  const sortExprs = {
    applied_at: 'applied_at',
    payment_amount: 'CAST(payment_amount AS REAL)',
    payment_method: 'payment_method',
    created_at: 'created_at',
    updated_at: 'updated_at',
    ref_num: 'ref_num',
    success: 'success',
    customer: "COALESCE(json_extract(customer, '$.business_name'), json_extract(customer, '$.business_then_name'), json_extract(customer, '$.fullname'), '')",
  };
  const validSorts = Object.keys(sortExprs);
  const safeSort = validSorts.includes(sortCol) ? sortCol : 'applied_at';
  const safeDir = sortDir === 'asc' ? 'ASC' : 'DESC';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM payments ${whereStr}`).get(...params);
  const rows = db.prepare(`
    SELECT id, created_at, updated_at, success, payment_amount, invoice_ids, ref_num,
           applied_at, payment_method, customer_id, customer, synced
    FROM payments ${whereStr}
    ORDER BY ${sortExprs[safeSort]} ${safeDir}, id ASC
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));

  const data = rows.map(r => ({
    ...r,
    invoice_ids: parseInvoiceIds(r.invoice_ids),
  }));

  res.json({
    data,
    pagination: { page: Number(page), limit: Number(limit), total: countRow.total },
  });
});

// GET /api/payments/:id - payment detail with linked invoices resolved
router.get('/:id', (req, res) => {
  const db = getDb();
  const payment = db.prepare(`
    SELECT id, created_at, updated_at, success, payment_amount, invoice_ids, ref_num,
           applied_at, payment_method, customer, customer_id, raw_json, synced
    FROM payments WHERE id = ?
  `).get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Not found' });

  const invoiceIds = parseInvoiceIds(payment.invoice_ids);
  let invoices = [];
  if (invoiceIds.length > 0) {
    const placeholders = invoiceIds.map(() => '?').join(',');
    invoices = db.prepare(`
      SELECT id, number, date, total, is_paid
      FROM invoices WHERE id IN (${placeholders})
      ORDER BY date DESC
    `).all(...invoiceIds);
  }

  payment.invoice_ids = invoiceIds;
  payment.invoices = invoices;
  res.json(payment);
});

export default router;
