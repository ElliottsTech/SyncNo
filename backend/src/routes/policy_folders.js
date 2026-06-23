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
    conditions.push('p.name LIKE ?');
    params.push(`%${filter_name}%`);
  }
  if (filter_customer_id) {
    conditions.push('p.customer_id = ?');
    params.push(Number(filter_customer_id));
  }
  if (filter_asset_id) {
    conditions.push('p.asset_id = ?');
    params.push(Number(filter_asset_id));
  }
  const whereStr = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const validSorts = ['name', 'created_at', 'updated_at', 'asset_count'];
  const safeSort = validSorts.includes(sortCol) ? sortCol : 'name';
  const safeDir = sortDir === 'desc' ? 'DESC' : 'ASC';
  const orderExpr = safeSort === 'asset_count' ? 'asset_count' : `p.${safeSort}`;

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM policy_folders p ${whereStr}`).get(...params);
  const rows = db.prepare(`
    SELECT p.id, p.name, p.customer_id, p.asset_id, p.parent_id,
           p.partial_policy_id, p.effective_policy_id,
           p.description, p.created_at, p.updated_at, p.synced,
           (SELECT COUNT(*) FROM assets a WHERE a.policy_folder_id = p.id) AS asset_count,
           c.business_name, c.fullname,
           COALESCE(NULLIF(c.business_name,''), c.fullname) AS customer_name
    FROM policy_folders p
    LEFT JOIN customers c ON c.id = p.customer_id
    ${whereStr}
    ORDER BY ${orderExpr} ${safeDir}
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));

  res.json({
    data: rows,
    pagination: { page: Number(page), limit: Number(limit), total: countRow.total },
  });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const pf = db.prepare(`
    SELECT pf.*, c.business_name, c.fullname,
           COALESCE(NULLIF(c.business_name,''), c.fullname) AS customer_name
    FROM policy_folders pf
    LEFT JOIN customers c ON c.id = pf.customer_id
    WHERE pf.id = ?
  `).get(req.params.id);
  if (!pf) return res.status(404).json({ error: 'Not found' });

  // Linked assets — assets whose policy_folder_id points at this folder
  const assets = db.prepare(`
    SELECT a.id, a.name, a.asset_type, a.asset_serial, a.customer_id,
           COALESCE(NULLIF(c.business_name,''), c.fullname) AS customer_name
    FROM assets a
    LEFT JOIN customers c ON c.id = a.customer_id
    WHERE a.policy_folder_id = ?
    ORDER BY a.name ASC
  `).all(req.params.id);

  // Parent + children folders (if any)
  let parent = null;
  if (pf.parent_id) {
    parent = db.prepare('SELECT id, name FROM policy_folders WHERE id = ?').get(pf.parent_id) || null;
  }
  const children = db.prepare('SELECT id, name FROM policy_folders WHERE parent_id = ? ORDER BY name ASC').all(req.params.id);

  // Policy info — effective policy id is what actually applies
  let effectivePolicy = null;
  if (pf.effective_policy_id) {
    // We don't have a policies table; expose id so frontend can link out if desired
    effectivePolicy = { id: pf.effective_policy_id };
  }

  pf.assets = assets;
  pf.parent_folder = parent;
  pf.child_folders = children;
  pf.effective_policy = effectivePolicy;
  delete pf.raw_json;
  pf.raw_json = db.prepare('SELECT raw_json FROM policy_folders WHERE id = ?').get(req.params.id)?.raw_json || null;
  res.json(pf);
});

export default router;
