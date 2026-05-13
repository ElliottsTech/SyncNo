import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// GET /api/purchase-orders - all POs
router.get('/', (req, res) => {
  const db = getDb();
  const { page = 1, limit = 50, sortCol = 'created_at', sortDir = 'desc',
          filter_number, filter_status, filter_total, filter_created_at, filter_due_date } = req.query;
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  if (filter_number) {
    conditions.push('number LIKE ?');
    params.push(`%${filter_number}%`);
  }
  if (filter_status) {
    conditions.push('status LIKE ?');
    params.push(`%${filter_status}%`);
  }
  if (filter_total) {
    conditions.push('total LIKE ?');
    params.push(`%${filter_total}%`);
  }
  if (filter_created_at) {
    conditions.push('created_at LIKE ?');
    params.push(`%${filter_created_at}%`);
  }
  if (filter_due_date) {
    conditions.push('due_date LIKE ?');
    params.push(`%${filter_due_date}%`);
  }

  const whereStr = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const validSorts = ['created_at', 'due_date', 'number', 'total', 'status'];
  const safeSort = validSorts.includes(sortCol) ? sortCol : 'created_at';
  const safeDir = sortDir === 'asc' ? 'ASC' : 'DESC';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM purchase_orders ${whereStr}`).get(...params);
  const pos = db.prepare(`
    SELECT po.id, po.number, po.status, po.total, po.created_at, po.due_date, po.paid_date,
           po.vendor_id, po.vendor, po.synced
    FROM purchase_orders po ${whereStr}
    ORDER BY po.${safeSort} ${safeDir}
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));

  const result = pos.map(po => {
    if (po.vendor && typeof po.vendor === 'string') {
      try {
        const v = JSON.parse(po.vendor);
        po.vendor_name = v.name || po.vendor;
      } catch (e) {
        po.vendor_name = po.vendor;
      }
    }
    return po;
  });

  res.json({
    data: result,
    pagination: { page: Number(page), limit: Number(limit), total: countRow.total },
  });
});

// GET /api/purchase-orders/:id - PO detail
router.get('/:id', (req, res) => {
  const db = getDb();
  const po = db.prepare('SELECT *, raw_json, synced FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!po) return res.status(404).json({ error: 'Not found' });

  if (po.vendor && typeof po.vendor === 'string') {
    try {
      po.vendor = JSON.parse(po.vendor);
    } catch (e) {}
  }

  if (po.line_items && typeof po.line_items === 'string') {
    try {
      po.line_items = JSON.parse(po.line_items);
    } catch (e) {}
  }

  if (Array.isArray(po.line_items) && po.line_items.length > 0) {
    const productIds = po.line_items.map(li => li.product_id).filter(id => id);
    if (productIds.length > 0) {
      const placeholders = productIds.map(() => '?').join(',');
      const products = db.prepare(`SELECT id, name FROM products WHERE id IN (${placeholders})`).all(...productIds);
      const productMap = {};
      for (const p of products) {
        productMap[p.id] = p.name;
      }
      for (const li of po.line_items) {
        li.product_name = productMap[li.product_id] || null;
      }
    }
  }

  res.json(po);
});

export default router;
