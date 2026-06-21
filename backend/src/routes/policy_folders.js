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
    filter_customer_id,
    filter_asset_id,
  } = req.query;
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];
  if (filter_name) {
    conditions.push('name LIKE ?');
    params.push(`%${filter_name}%`);
  }
  if (filter_customer_id) {
    conditions.push('customer_id = ?');
    params.push(Number(filter_customer_id));
  }
  if (filter_asset_id) {
    conditions.push('asset_id = ?');
    params.push(Number(filter_asset_id));
  }
  const whereStr = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const validSorts = ['name', 'created_at', 'updated_at'];
  const safeSort = validSorts.includes(sortCol) ? sortCol : 'name';
  const safeDir = sortDir === 'desc' ? 'DESC' : 'ASC';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM policy_folders ${whereStr}`).get(...params);
  const rows = db.prepare(`
    SELECT id, name, customer_id, asset_id, description, created_at, updated_at, synced
    FROM policy_folders ${whereStr}
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
  const pf = db.prepare('SELECT *, raw_json, synced FROM policy_folders WHERE id = ?').get(req.params.id);
  if (!pf) return res.status(404).json({ error: 'Not found' });

  let customer = null;
  let asset = null;
  if (pf.customer_id) {
    customer = db.prepare(`
      SELECT id, business_name, fullname,
             COALESCE(NULLIF(business_name,''), fullname) as display_name
      FROM customers WHERE id = ?
    `).get(pf.customer_id) || null;
  }
  if (pf.asset_id) {
    asset = db.prepare('SELECT id, name, asset_type, asset_serial FROM assets WHERE id = ?').get(pf.asset_id) || null;
  }
  pf.customer = customer;
  pf.asset = asset;
  res.json(pf);
});

export default router;
