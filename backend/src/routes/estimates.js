import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// GET /api/estimates - all estimates
router.get('/', (req, res) => {
  const db = getDb();
  const { page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  const countRow = db.prepare('SELECT COUNT(*) as total FROM estimates').get();
  const estimates = db.prepare(`
    SELECT e.id, e.number, e.status, e.date, e.subtotal, e.total, e.tax,
           e.customer_id, e.customer_business_then_name, e.raw_json, e.synced
    FROM estimates e
    ORDER BY e.date DESC
    LIMIT ? OFFSET ?
  `).all(Number(limit), Number(offset));

  const result = estimates.map(e => {
    if (e.raw_json && typeof e.raw_json === 'string') {
      try {
        const raw = JSON.parse(e.raw_json);
        if (raw.customer) {
          e.customer_name = raw.customer.business_name || raw.customer.business_then_name || raw.customer.fullname || e.customer_business_then_name;
          e.customer = raw.customer;
        }
      } catch (_) {}
    }
    return e;
  });

  res.json({
    data: result,
    pagination: { page: Number(page), limit: Number(limit), total: countRow.total },
  });
});

// GET /api/estimates/:id - estimate detail
router.get('/:id', (req, res) => {
  const db = getDb();
  const est = db.prepare('SELECT *, raw_json, synced FROM estimates WHERE id = ?').get(req.params.id);
  if (!est) return res.status(404).json({ error: 'Not found' });
  res.json(est);
});

export default router;
