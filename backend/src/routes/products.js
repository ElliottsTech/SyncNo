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
    SELECT id, serial_number, status, created_at, updated_at, raw_json
    FROM product_serials WHERE product_id = ? ORDER BY created_at ASC
  `).all(req.params.id);

  // SKUs (vendor-linked)
  const skus = db.prepare(`
    SELECT id, vendor_name, vendor_id, sku
    FROM product_skus WHERE product_id = ? ORDER BY vendor_name ASC, sku ASC
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

  // Usage stats + linked records: tickets via line_items table, others via
  // raw_json LIKE (no invoice/estimate/PO line_items tables exist — line items
  // live inside the parent's raw_json only).
  const pid = req.params.id;
  const likePat = `%"product_id":${pid}%`;

  const linkedTickets = db.prepare(`
    SELECT DISTINCT t.id, t.number, t.subject, t.status, t.customer_id, t.customer_business_then_name
    FROM ticket_line_items tli
    JOIN tickets t ON t.id = tli.ticket_id
    WHERE tli.product_id = ?
    ORDER BY t.created_at DESC
  `).all(pid);

  const linkedInvoices = db.prepare(`
    SELECT id, number, customer_id, customer_business_then_name, date, due_date, total, is_paid, verified_paid
    FROM invoices WHERE raw_json LIKE ?
    ORDER BY date DESC
  `).all(likePat);

  const linkedEstimates = db.prepare(`
    SELECT id, number, status, customer_id, customer_business_then_name, date, total
    FROM estimates WHERE raw_json LIKE ?
    ORDER BY date DESC
  `).all(likePat);

  const linkedPOs = db.prepare(`
    SELECT id, number, status, total, created_at, due_date, vendor_id, vendor
    FROM purchase_orders WHERE raw_json LIKE ?
    ORDER BY created_at DESC
  `).all(likePat);

  // Normalize PO vendor JSON → vendor_name
  const linkedPurchaseOrders = linkedPOs.map(po => {
    let vendor_name = null;
    if (po.vendor && typeof po.vendor === 'string') {
      try { vendor_name = JSON.parse(po.vendor).name || null; } catch (_) {}
    }
    delete po.vendor;
    return { ...po, vendor_name };
  });

  res.json({
    ...product,
    serials,
    skus,
    category,
    linked: {
      tickets: linkedTickets,
      invoices: linkedInvoices,
      estimates: linkedEstimates,
      purchase_orders: linkedPurchaseOrders,
    },
    usage: {
      tickets: linkedTickets.length,
      invoices: linkedInvoices.length,
      estimates: linkedEstimates.length,
      purchase_orders: linkedPurchaseOrders.length,
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
