import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const {
    page = 1,
    limit = 50,
    sortCol = 'email',
    sortDir = 'asc',
    filter_email,
    filter_customer_id,
    filter_disabled,
  } = req.query;
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];
  if (filter_email) {
    conditions.push('email LIKE ?');
    params.push(`%${filter_email}%`);
  }
  if (filter_customer_id) {
    conditions.push('customer_id = ?');
    params.push(Number(filter_customer_id));
  }
  if (filter_disabled !== undefined && filter_disabled !== '') {
    conditions.push('disabled = ?');
    params.push(Number(filter_disabled) ? 1 : 0);
  }
  const whereStr = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const validSorts = ['email', 'disabled', 'created_at', 'updated_at'];
  const safeSort = validSorts.includes(sortCol) ? sortCol : 'email';
  const safeDir = sortDir === 'desc' ? 'DESC' : 'ASC';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM portal_users ${whereStr}`).get(...params);
  const rows = db.prepare(`
    SELECT id, email, disabled, customer_id, contact_id, mobile, created_at, updated_at, synced
    FROM portal_users ${whereStr}
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
  const pu = db.prepare('SELECT *, raw_json, synced FROM portal_users WHERE id = ?').get(req.params.id);
  if (!pu) return res.status(404).json({ error: 'Not found' });

  let customer = null;
  let contact = null;
  if (pu.customer_id) {
    customer = db.prepare(`
      SELECT id, business_name, fullname,
             COALESCE(NULLIF(business_name,''), fullname) as display_name
      FROM customers WHERE id = ?
    `).get(pu.customer_id) || null;
  }
  if (pu.contact_id) {
    contact = db.prepare('SELECT id, name, email, phone FROM contacts WHERE id = ?').get(pu.contact_id) || null;
  }
  pu.customer = customer;
  pu.contact = contact;
  res.json(pu);
});

export default router;
