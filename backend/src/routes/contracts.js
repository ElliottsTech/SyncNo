import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const {
    page = 1,
    limit = 50,
    sortCol = 'name',
    sortDir = 'asc',
    filter_name,
    filter_status,
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
  if (filter_customer_id) {
    conditions.push('customer_id = ?');
    params.push(Number(filter_customer_id));
  }
  const whereStr = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  // contract_amount is stored as TEXT — CAST to REAL for numeric ordering.
  // likelihood is TEXT (often a percentage string like "50%") — keep as text sort
  // so values like "10%" / "50%" / "90%" compare as written.
  const sortExprs = {
    name: 'name',
    status: 'status',
    contract_amount: 'CAST(contract_amount AS REAL)',
    likelihood: 'COALESCE(likelihood, \'\')',
    start_date: 'start_date',
    end_date: 'end_date',
    created_at: 'created_at',
    updated_at: 'updated_at',
  };
  const validSorts = Object.keys(sortExprs);
  const safeSort = validSorts.includes(sortCol) ? sortCol : 'name';
  const safeDir = sortDir === 'desc' ? 'DESC' : 'ASC';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM contracts ${whereStr}`).get(...params);
  const rows = db.prepare(`
    SELECT id, name, customer_id, contract_amount, start_date, end_date,
           status, likelihood, created_at, updated_at, synced
    FROM contracts ${whereStr}
    ORDER BY ${sortExprs[safeSort]} ${safeDir}, id ASC
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));

  res.json({
    data: rows,
    pagination: { page: Number(page), limit: Number(limit), total: countRow.total },
  });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const contract = db.prepare(`
    SELECT *, raw_json, synced FROM contracts WHERE id = ?
  `).get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Not found' });

  let customer = null;
  if (contract.customer_id) {
    customer = db.prepare(`
      SELECT id, business_name, fullname,
             COALESCE(NULLIF(business_name,''), fullname) as display_name
      FROM customers WHERE id = ?
    `).get(contract.customer_id) || null;
  }
  contract.customer = customer;
  res.json(contract);
});

export default router;
