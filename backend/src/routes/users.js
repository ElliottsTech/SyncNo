import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// POST /api/users/upsert - create or update user
router.post('/upsert', (req, res) => {
  const db = getDb();
  const { id, email, name } = req.body;
  if (!id || !email) return res.status(400).json({ error: 'id and email required' });

  db.prepare(`
    INSERT INTO users (id, email, name) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name
  `).run(id, email, name);

  res.json({ ok: true });
});

// GET /api/users - list users (admin only)
router.get('/', (req, res) => {
  const db = getDb();
  const users = db.prepare(`
    SELECT id, email, name, last_login, created_at, role
    FROM users
    ORDER BY created_at DESC
  `).all();
  res.json(users);
});

// GET /api/users/:id - user detail
router.get('/:id', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(user);
});

// PUT /api/users/:id/last-login - update last login
router.put('/:id/last-login', (req, res) => {
  const db = getDb();
  db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

export default router;
