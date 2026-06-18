import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// GET /api/products - all products
router.get('/', (req, res) => {
  const db = getDb();
  const {
    page = 1,
    limit = 50,
    sortCol = 'name',
    sortDir = 'asc',
    filter_name,
    filter_product_category,
    filter_serialized,
    filter_disabled,
    filter_taxable,
  } = req.query;
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  // Exclude soft-deleted by default unless explicitly requested
  if (req.query.include_deleted !== 'true') {
    conditions.push('deleted_at IS NULL');
  }

  if (filter_name) {
    conditions.push('(name LIKE ? OR description LIKE ? OR upc_code LIKE ?)');
    params.push(`%${filter_name}%`, `%${filter_name}%`, `%${filter_name}%`);
  }
  if (filter_product_category) {
    conditions.push('product_category LIKE ?');
    params.push(`%${filter_product_category}%`);
  }
  if (filter_serialized === 'true' || filter_serialized === '1') {
    conditions.push('serialized = 1');
  }
  if (filter_disabled === 'true' || filter_disabled === '1') {
    conditions.push('disabled = 1');
  } else if (filter_disabled === 'false' || filter_disabled === '0') {
    conditions.push('disabled = 0');
  }
  if (filter_taxable === 'true' || filter_taxable === '1') {
    conditions.push('taxable = 1');
  }

  const whereStr = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const validSorts = ['name', 'price_retail', 'price_cost', 'quantity', 'product_category', 'updated_at'];
  const safeSort = validSorts.includes(sortCol) ? sortCol : 'name';
  const safeDir = sortDir === 'desc' ? 'DESC' : 'ASC';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM products ${whereStr}`).get(...params);
  const products = db.prepare(`
    SELECT id, name, description, price_retail, price_cost, price_wholesale, quantity,
           product_category, upc_code, serialized, disabled, taxable, since_updated_at,
           updated_at, synced, deleted_at
    FROM products ${whereStr}
    ORDER BY ${safeSort} ${safeDir}
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));

  res.json({
    data: products,
    pagination: { page: Number(page), limit: Number(limit), total: countRow.total },
  });
});

// GET /api/products/categories
router.get('/categories', (req, res) => {
  const db = getDb();
  const cats = db.prepare(`
    SELECT id, name, ancestry, names_depth_cache
    FROM product_categories
    ORDER BY names_depth_cache ASC
  `).all();
  res.json({ data: cats });
});

// GET /api/products/:id - product detail with serials + usage stats
router.get('/:id', (req, res) => {
  const db = getDb();
  const product = db.prepare('SELECT *, raw_json, synced FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Not found' });

  // Serials (for serialized products)
  const serials = db.prepare(`
    SELECT id, serial_number, created_at, updated_at, raw_json
    FROM product_serials WHERE product_id = ? ORDER BY created_at ASC
  `).all(req.params.id);

  // Resolve category record if product_category was a category path/name
  let category = null;
  if (product.product_category) {
    category = db.prepare(`
      SELECT id, name, ancestry, names_depth_cache, description
      FROM product_categories WHERE names_depth_cache = ? OR name = ?
      LIMIT 1
    `).get(product.product_category, product.product_category);
  }

  // Usage stats: how many tickets / invoices / estimates reference this product
  const ticketCount = db.prepare('SELECT COUNT(*) as cnt FROM ticket_line_items WHERE product_id = ?').get(req.params.id)?.cnt || 0;
  const invoiceCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM invoices
    WHERE raw_json LIKE ?
  `).get(`%"product_id":${req.params.id}%`)?.cnt || 0;
  const estimateCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM estimates
    WHERE raw_json LIKE ?
  `).get(`%"product_id":${req.params.id}%`)?.cnt || 0;
  const poCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM purchase_orders
    WHERE raw_json LIKE ?
  `).get(`%"product_id":${req.params.id}%`)?.cnt || 0;

  res.json({
    ...product,
    serials,
    category,
    usage: {
      tickets: ticketCount,
      invoices: invoiceCount,
      estimates: estimateCount,
      purchase_orders: poCount,
    },
  });
});

// GET /api/products/:id/tickets - tickets whose line_items reference this product
router.get('/:id/tickets', (req, res) => {
  const db = getDb();
  const tickets = db.prepare(`
    SELECT DISTINCT t.id, t.number, t.subject, t.status, t.priority, t.customer_business_then_name, t.created_at
    FROM ticket_line_items tli
    JOIN tickets t ON tli.ticket_id = t.id
    WHERE tli.product_id = ? AND t.deleted_at IS NULL
    ORDER BY t.created_at DESC
  `).all(req.params.id);
  res.json(tickets);
});

export default router;
