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
  const assets = db.prepare('SELECT id, name, asset_type, asset_serial, created_at, policy_folder_id FROM assets WHERE customer_id = ? ORDER BY name').all(req.params.id);
  res.json(assets);
});

// GET /api/customers/:id/policies
// Returns policy folder tree for a customer:
//   - folders:  policy_folders with parent_id hierarchy, each with children + linked assets
//   - derived:  when no policy_folders exist, group the customer's assets by policy_folder_id
//   - assets:   all customer assets (for the tree to attach as leaves when needed)
router.get('/:id/policies', (req, res) => {
  const db = getDb();
  const customerId = req.params.id;

  const folderRows = db.prepare(`
    SELECT id, name, description, customer_id, asset_id, parent_id,
           partial_policy_id, effective_policy_id, created_at, updated_at
    FROM policy_folders
    WHERE customer_id = ?
    ORDER BY COALESCE(name, '')
  `).all(customerId);

  const assetRows = db.prepare(`
    SELECT id, name, asset_type, asset_serial, created_at, policy_folder_id
    FROM assets
    WHERE customer_id = ?
    ORDER BY name
  `).all(customerId);

  const assetsByFolder = {};
  for (const a of assetRows) {
    const key = a.policy_folder_id;
    if (key == null) continue;
    if (!assetsByFolder[key]) assetsByFolder[key] = [];
    assetsByFolder[key].push(a);
  }

  // Real folders exist — build hierarchy.
  if (folderRows.length > 0) {
    const byId = {};
    for (const f of folderRows) {
      byId[f.id] = { ...f, children: [], assets: assetsByFolder[f.id] || [] };
    }
    const roots = [];
    for (const f of folderRows) {
      const node = byId[f.id];
      if (f.parent_id && byId[f.parent_id]) {
        byId[f.parent_id].children.push(node);
      } else {
        roots.push(node);
      }
    }
    return res.json({ folders: roots, derived: [], totalFolders: folderRows.length, totalAssets: assetRows.length });
  }

  // Fallback: derive groups from asset.policy_folder_id (policy_folders sync pending).
  const derived = Object.keys(assetsByFolder).map(folderId => ({
    id: Number(folderId),
    name: null,
    description: null,
    parent_id: null,
    effective_policy_id: null,
    partial_policy_id: null,
    derived: true,
    assets: assetsByFolder[folderId],
  })).sort((a, b) => b.assets.length - a.assets.length);

  return res.json({ folders: [], derived, totalFolders: 0, totalAssets: assetRows.length });
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

// GET /api/customers/:id/schedules
router.get('/:id/schedules', (req, res) => {
  const db = getDb();
  const schedules = db.prepare(`
    SELECT id, invoice_id, name, status, amount, next_date, start_date, end_date, frequency, synced
    FROM schedules WHERE customer_id = ?
    ORDER BY next_date DESC
  `).all(req.params.id);
  res.json(schedules);
});

export default router;
