import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// GET /api/customers - list with pagination, search, and sort
router.get('/', (req, res) => {
  const db = getDb();
  const { page = 1, limit = 50, search = '', sortCol = 'business_name', sortDir = 'asc',
          filter_display_name, filter_fullname, filter_email, filter_city, filter_state } = req.query;
  const offset = (page - 1) * limit;

  // Build COALESCE for display_name (business_name || fullname as fallback)
  const displayName = "COALESCE(NULLIF(business_name,''), fullname)";

  const conditions = [];
  const params = [];

  // Global search across all text fields
  if (search) {
    conditions.push(`(${displayName} LIKE ? OR email LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`);
  }

  // Column-specific filters (only filter on that column)
  if (filter_display_name) {
    conditions.push(`(${displayName} LIKE ?)`);
    params.push(`%${filter_display_name}%`);
  }
  if (filter_fullname) {
    conditions.push(`(fullname LIKE ?)`);
    params.push(`%${filter_fullname}%`);
  }
  if (filter_email) {
    conditions.push(`(email LIKE ?)`);
    params.push(`%${filter_email}%`);
  }
  if (filter_city) {
    conditions.push(`(city LIKE ?)`);
    params.push(`%${filter_city}%`);
  }
  if (filter_state) {
    conditions.push(`(state LIKE ?)`);
    params.push(`%${filter_state}%`);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  // Validate sort column
  const validSorts = ['business_name', 'fullname', 'email', 'city', 'state', 'created_at', 'disabled'];
  const safeSort = validSorts.includes(sortCol) ? sortCol : 'business_name';
  const safeDir = sortDir === 'desc' ? 'DESC' : 'ASC';

  // Order by display_name or specific column
  let orderBy;
  if (['business_name', 'fullname'].includes(safeSort)) {
    orderBy = `${displayName} ${safeDir}`;
  } else {
    orderBy = `${safeSort} ${safeDir}`;
  }

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM customers ${where}`).get(...params);
  const customers = db.prepare(`
    SELECT id, business_name, fullname, email, phone, address, city, state, disabled,
           ${displayName} as display_name, synced
    FROM customers ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));

  res.json({
    data: customers,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total: countRow.total,
    },
  });
});

// GET /api/customers/:id - customer detail
router.get('/:id', (req, res) => {
  const db = getDb();
  const customer = db.prepare('SELECT *, raw_json, synced FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  res.json(customer);
});

// GET /api/customers/:id/contacts
router.get('/:id/contacts', (req, res) => {
  const db = getDb();
  const contacts = db.prepare('SELECT *, raw_json FROM contacts WHERE customer_id = ? ORDER BY name').all(req.params.id);
  res.json(contacts);
});

// GET /api/customers/:id/tickets
router.get('/:id/tickets', (req, res) => {
  const db = getDb();
  const { page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  const countRow = db.prepare('SELECT COUNT(*) as total FROM tickets WHERE customer_id = ?').get(req.params.id);
  const tickets = db.prepare(`
    SELECT id, number, subject, status, priority, created_at, due_date
    FROM tickets WHERE customer_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(req.params.id, Number(limit), Number(offset));

  res.json({
    data: tickets,
    pagination: { page: Number(page), limit: Number(limit), total: countRow.total },
  });
});

// GET /api/customers/:id/assets
router.get('/:id/assets', (req, res) => {
  const db = getDb();
  const assets = db.prepare('SELECT id, name, asset_type, asset_serial, created_at FROM assets WHERE customer_id = ? ORDER BY name').all(req.params.id);
  res.json(assets);
});

// GET /api/customers/:id/invoices
router.get('/:id/invoices', (req, res) => {
  const db = getDb();
  const invoices = db.prepare(`
    SELECT id, number, date, due_date, subtotal, total, tax, is_paid, verified_paid, tech_marked_paid
    FROM invoices WHERE customer_id = ?
    ORDER BY date DESC
  `).all(req.params.id);
  res.json(invoices);
});

// GET /api/customers/:id/estimates
router.get('/:id/estimates', (req, res) => {
  const db = getDb();
  const estimates = db.prepare(`
    SELECT id, number, status, date, subtotal, total, tax
    FROM estimates WHERE customer_id = ?
    ORDER BY date DESC
  `).all(req.params.id);
  res.json(estimates);
});

// GET /api/customers/:id/payments
router.get('/:id/payments', (req, res) => {
  const db = getDb();
  const payments = db.prepare(`
    SELECT id, ref_num, applied_at, payment_amount, payment_method, invoice_ids, success
    FROM payments WHERE customer_id = ?
    ORDER BY applied_at DESC
  `).all(req.params.id);
  res.json(payments.map(p => ({
    ...p,
    invoice_ids: p.invoice_ids ? (typeof p.invoice_ids === 'string' ? JSON.parse(p.invoice_ids) : p.invoice_ids) : [],
  })));
});

export default router;
