import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// GET /api/assets - all assets
router.get('/', (req, res) => {
  const db = getDb();
  const { page = 1, limit = 50, sortCol = 'created_at', sortDir = 'desc',
          filter_name, filter_asset_type, filter_asset_serial } = req.query;
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  if (filter_name) {
    conditions.push('name LIKE ?');
    params.push(`%${filter_name}%`);
  }
  if (filter_asset_type) {
    conditions.push('asset_type LIKE ?');
    params.push(`%${filter_asset_type}%`);
  }
  if (filter_asset_serial) {
    conditions.push('asset_serial LIKE ?');
    params.push(`%${filter_asset_serial}%`);
  }

  const whereStr = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const validSorts = ['created_at', 'name', 'asset_type', 'updated_at'];
  const safeSort = validSorts.includes(sortCol) ? sortCol : 'created_at';
  const safeDir = sortDir === 'asc' ? 'ASC' : 'DESC';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM assets ${whereStr}`).get(...params);
  const assets = db.prepare(`
    SELECT a.id, a.name, a.asset_type, a.asset_serial, a.customer_id,
           a.created_at, a.updated_at, a.asset_type, a.properties, a.synced,
           a.policy_folder_id
    FROM assets a ${whereStr}
    ORDER BY a.${safeSort} ${safeDir}
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));

  const result = assets.map(a => {
    if (a.properties && typeof a.properties === 'string') {
      try {
        a.properties = JSON.parse(a.properties);
      } catch (_) {}
    }
    // Extract customer name from nested customer object if present
    if (a.properties && typeof a.properties === 'object' && a.properties.customer_name) {
      a.customer_name = a.properties.customer_name;
    }
    return a;
  });

  res.json({
    data: result,
    pagination: { page: Number(page), limit: Number(limit), total: countRow.total },
  });
});

// GET /api/assets/:id - asset detail
router.get('/:id', (req, res) => {
  const db = getDb();
  const asset = db.prepare('SELECT id, name, customer_id, contact_id, created_at, updated_at, properties, asset_type, asset_serial, external_rmm_link, rmm_links, has_live_chat, snmp_enabled, device_info, rmm_store, address, customer, policy_folder_id, raw_json, synced FROM assets WHERE id = ?').get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Not found' });

  if (asset.properties && typeof asset.properties === 'string') {
    try {
      asset.properties = JSON.parse(asset.properties);
    } catch (_) {}
  }
  if (asset.customer && typeof asset.customer === 'string') {
    try {
      asset.customer = JSON.parse(asset.customer);
    } catch (_) {}
  }
  if (asset.device_info && typeof asset.device_info === 'string') {
    try {
      asset.device_info = JSON.parse(asset.device_info);
    } catch (_) {}
  }
  if (asset.rmm_links && typeof asset.rmm_links === 'string') {
    try {
      asset.rmm_links = JSON.parse(asset.rmm_links);
    } catch (_) {}
  }

  // Attach policy_folder info if linked
  if (asset.policy_folder_id) {
    asset.policy_folder = db.prepare(`
      SELECT id, name, customer_id, parent_id, partial_policy_id, effective_policy_id
      FROM policy_folders WHERE id = ?
    `).get(asset.policy_folder_id) || null;
  } else {
    asset.policy_folder = null;
  }

  res.json(asset);
});

export default router;
