import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// GET /api/search?q=term
router.get('/', (req, res) => {
  const db = getDb();
  const { q = '', type = '' } = req.query;

  if (!q || q.length < 2) {
    return res.json({ data: [] });
  }

  const results = [];
  const searchTerm = `%${q}%`;

  // Search customers
  if (!type || type === 'customer') {
    const customers = db.prepare(`
      SELECT id, business_name, fullname, email, city, state, 'customer' as type
      FROM customers
      WHERE business_name LIKE ? OR fullname LIKE ? OR email LIKE ?
      LIMIT 25
    `).all(searchTerm, searchTerm, searchTerm);
    results.push(...customers.map(c => ({
      ...c,
      title: c.business_name || c.fullname,
      subtitle: c.email,
    })));
  }

  // Search tickets
  if (!type || type === 'ticket') {
    const tickets = db.prepare(`
      SELECT id, number, subject, customer_business_then_name, status, priority, 'ticket' as type
      FROM tickets
      WHERE subject LIKE ? OR number LIKE ?
      LIMIT 25
    `).all(searchTerm, searchTerm);
    results.push(...tickets.map(t => ({
      ...t,
      title: t.subject,
      subtitle: `${t.number} - ${t.customer_business_then_name || ''}`,
    })));
  }

  // Search vendors
  if (!type || type === 'vendor') {
    const vendors = db.prepare(`
      SELECT id, name, email, phone, 'vendor' as type
      FROM vendors
      WHERE name LIKE ? OR email LIKE ?
      LIMIT 10
    `).all(searchTerm, searchTerm);
    results.push(...vendors.map(v => ({
      ...v,
      title: v.name,
      subtitle: v.email,
    })));
  }

  res.json({ data: results });
});

export default router;
