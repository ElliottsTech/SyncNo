import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

function getPaymentStatus(invoice) {
  if (invoice.is_paid) return 'paid';
  if (invoice.verified_paid) return 'verified_paid';
  if (invoice.tech_marked_paid) return 'tech_marked_paid';
  if (invoice.due_date && new Date(invoice.due_date) < new Date()) return 'overdue';
  return 'unpaid';
}

// GET /api/invoices - all invoices
router.get('/', (req, res) => {
  const db = getDb();
  const { page = 1, limit = 50, sortCol = 'date', sortDir = 'desc',
          filter_number, filter_customer_business_then_name, filter_date, filter_due_date, filter_total, filter_payment_status } = req.query;
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  if (filter_number) {
    conditions.push('number LIKE ?');
    params.push(`%${filter_number}%`);
  }
  if (filter_customer_business_then_name) {
    conditions.push('customer_business_then_name LIKE ?');
    params.push(`%${filter_customer_business_then_name}%`);
  }
  if (filter_date) {
    conditions.push('date LIKE ?');
    params.push(`%${filter_date}%`);
  }
  if (filter_due_date) {
    conditions.push('due_date LIKE ?');
    params.push(`%${filter_due_date}%`);
  }
  if (filter_total) {
    conditions.push('total LIKE ?');
    params.push(`%${filter_total}%`);
  }

  const whereStr = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const validSorts = ['date', 'due_date', 'number', 'total', 'created_at'];
  const safeSort = validSorts.includes(sortCol) ? sortCol : 'date';
  const safeDir = sortDir === 'asc' ? 'ASC' : 'DESC';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM invoices ${whereStr}`).get(...params);
  const invoices = db.prepare(`
    SELECT id, number, customer_id, customer_business_then_name, date, due_date, total, is_paid, verified_paid, tech_marked_paid, raw_json, synced
    FROM invoices ${whereStr}
    ORDER BY ${safeSort} ${safeDir}
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));

  const result = invoices.map(inv => {
    let customerName = inv.customer_business_then_name;
    let customer = null;
    if (!customerName && inv.raw_json) {
      try {
        const raw = typeof inv.raw_json === 'string' ? JSON.parse(inv.raw_json) : inv.raw_json;
        if (raw.customer) {
          customer = raw.customer;
          customerName = raw.customer.business_name || raw.customer.business_then_name || raw.customer.fullname || '';
        }
      } catch (_) {}
    }
    return { ...inv, customer_name: customerName, customer, payment_status: getPaymentStatus(inv) };
  });

  res.json({
    data: result,
    pagination: { page: Number(page), limit: Number(limit), total: countRow.total },
  });
});

// GET /api/invoices/:id - invoice detail
router.get('/:id', (req, res) => {
  const db = getDb();
  const invoice = db.prepare('SELECT id, customer_id, customer_business_then_name, number, created_at, updated_at, date, due_date, subtotal, total, tax, verified_paid, tech_marked_paid, ticket_id, pdf_url, is_paid, location_id, po_number, contact_id, note, hardwarecost, user_id, raw_json, synced FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Not found' });

  invoice.payment_status = getPaymentStatus(invoice);
  res.json(invoice);
});

// GET /api/invoices/:id/payments - payments for this invoice
router.get('/:id/payments', (req, res) => {
  const db = getDb();
  const invoiceId = req.params.id;

  const payments = db.prepare(`
    SELECT * FROM payments
    WHERE invoice_ids LIKE ? OR invoice_ids LIKE ? OR invoice_ids LIKE ?
  `).all(`%"${invoiceId}"%`, `"${invoiceId}"%`, `%${invoiceId}%`);

  res.json(payments);
});

export default router;
