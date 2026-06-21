import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const {
    page = 1,
    limit = 50,
    sortCol = 'next_date',
    sortDir = 'desc',
    filter_name,
    filter_status,
    filter_invoice_id,
    filter_customer_id,
  } = req.query;
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];
  if (filter_name) {
    conditions.push('name LIKE ?');
    params.push(`%${filter_name}%`);
  }
  if (filter_status) {
    conditions.push('status LIKE ?');
    params.push(`%${filter_status}%`);
  }
  if (filter_invoice_id) {
    conditions.push('invoice_id = ?');
    params.push(Number(filter_invoice_id));
  }
  if (filter_customer_id) {
    conditions.push('customer_id = ?');
    params.push(Number(filter_customer_id));
  }
  const whereStr = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const validSorts = ['name', 'status', 'next_date', 'start_date', 'end_date', 'created_at', 'updated_at'];
  const safeSort = validSorts.includes(sortCol) ? sortCol : 'next_date';
  const safeDir = sortDir === 'asc' ? 'ASC' : 'DESC';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM schedules ${whereStr}`).get(...params);
  const rows = db.prepare(`
    SELECT id, invoice_id, customer_id, name, status, amount, next_date,
           start_date, end_date, frequency, created_at, updated_at, synced
    FROM schedules ${whereStr}
    ORDER BY ${safeSort} ${safeDir}
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));

  res.json({
    data: rows,
    pagination: { page: Number(page), limit: Number(limit), total: countRow.total },
  });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const sched = db.prepare('SELECT *, raw_json, synced FROM schedules WHERE id = ?').get(req.params.id);
  if (!sched) return res.status(404).json({ error: 'Not found' });

  let invoice = null;
  let customer = null;
  if (sched.invoice_id) {
    invoice = db.prepare('SELECT id, number, date, total, is_paid FROM invoices WHERE id = ?').get(sched.invoice_id) || null;
  }
  if (sched.customer_id) {
    customer = db.prepare(`
      SELECT id, business_name, fullname,
             COALESCE(NULLIF(business_name,''), fullname) as display_name
      FROM customers WHERE id = ?
    `).get(sched.customer_id) || null;
  }
  sched.invoice = invoice;
  sched.customer = customer;

  // Schema columns (status, amount, next_date, start_date, end_date, created_at,
  // updated_at) were never populated by the importer — the real values live in
  // raw_json. Parse it here so the detail page has actual data.
  sched.parsed = parseRawJson(sched.raw_json);

  res.json(sched);
});

// Pull structured fields out of the Syncro raw_json payload. Cents are
// converted to dollars; booleans stay booleans; lines are normalized for the UI.
function parseRawJson(rawJson) {
  if (!rawJson) return null;
  let j;
  try { j = JSON.parse(rawJson); } catch { return null; }

  const toUsd = (cents) => (typeof cents === 'number' ? (cents / 100).toFixed(2) : null);

  const lines = Array.isArray(j.lines) ? j.lines.map(l => ({
    id: l.id,
    name: l.name || null,
    description: l.description || null,
    quantity: l.quantity != null ? String(l.quantity) : null,
    product_id: l.product_id || null,
    product_category: l.product_category || null,
    recurring_type_id: l.recurring_type_id ?? null,
    cost: toUsd(l.cost_cents),
    retail: toUsd(l.retail_cents),
    price_cost: typeof l.price_cost === 'number' ? l.price_cost.toFixed(2) : null,
    price_retail: typeof l.price_retail === 'number' ? l.price_retail.toFixed(2) : null,
    taxable: !!l.taxable,
    one_time_charge: !!l.one_time_charge,
    position: l.position ?? null,
  })).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) : [];

  const subtotalCost = lines.reduce((s, l) => {
    if (l.cost == null || l.quantity == null) return s;
    return s + parseFloat(l.cost) * parseFloat(l.quantity);
  }, 0);
  const subtotalRetail = lines.reduce((s, l) => {
    if (l.retail == null || l.quantity == null) return s;
    return s + parseFloat(l.retail) * parseFloat(l.quantity);
  }, 0);

  return {
    account_id: j.account_id ?? null,
    email_customer: !!j.email_customer,
    snail_mail: !!j.snail_mail,
    charge_mop: !!j.charge_mop,
    paused: !!j.paused,
    last_invoice_paid: !!j.last_invoice_paid,
    invoice_unbilled_ticket_charges: !!j.invoice_unbilled_ticket_charges,
    next_run: j.next_run || null,
    subtotal_cents: typeof j.subtotal === 'number' ? j.subtotal : null,
    subtotal_cost: lines.length ? subtotalCost.toFixed(2) : null,
    subtotal_retail: lines.length ? subtotalRetail.toFixed(2) : null,
    lines,
    line_count: lines.length,
  };
}

export default router;
