import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// GET /api/vendors - all vendors
router.get('/', (req, res) => {
  const db = getDb();
  const vendors = db.prepare('SELECT *, synced FROM vendors ORDER BY name').all();
  res.json(vendors);
});

// GET /api/vendors/:id - vendor detail
router.get('/:id', (req, res) => {
  const db = getDb();
  const vendor = db.prepare('SELECT id, name, rep_first_name, rep_last_name, email, phone, account_number, created_at, updated_at, address, city, state, zip, website, notes, raw_json, synced FROM vendors WHERE id = ?').get(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Not found' });
  res.json(vendor);
});

// GET /api/vendors/:id/purchase_orders
router.get('/:id/purchase_orders', (req, res) => {
  const db = getDb();
  const pos = db.prepare(`
    SELECT id, number, status, total, created_at, due_date, paid_date
    FROM purchase_orders WHERE vendor_id = ?
    ORDER BY created_at DESC
  `).all(req.params.id);
  res.json(pos);
});

export default router;
