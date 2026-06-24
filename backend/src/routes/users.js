import { Router } from 'express';
import { getDb } from '../db/database.js';
import { isDemo, demoNoop } from '../demo.js';

const router = Router();

function isAdmin(req) {
  return req.user?.role === 'admin';
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  next();
}

// Restrict to internal service callers (NextAuth callbacks, future MCP server)
// presenting the shared SYNCNO_API_KEY bearer token. Browser cookie auth is
// intentionally rejected — these routes are not user-facing.
// Read process.env lazily — module load runs before index.js loads .env.
function requireService(req, res, next) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ') && auth.slice(7) === process.env.SYNCNO_API_KEY) {
    return next();
  }
  return res.status(403).json({ error: 'Service only' });
}

// POST /api/users/upsert - create or update user (called by auth flow).
// Role is never overwritten on update so admin changes persist across logins.
// First user ever to log in is auto-promoted to admin.
router.post('/upsert', requireService, (req, res) => {
  const db = getDb();
  const { id, email, name } = req.body;
  if (!id || !email) return res.status(400).json({ error: 'id and email required' });

  const assign = db.transaction(() => {
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (existing) {
      db.prepare(`
        UPDATE users SET email = ?, name = ?, last_login = datetime('now') WHERE id = ?
      `).run(email, name, id);
      return;
    }
    const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    const role = userCount === 0 ? 'admin' : 'user';
    db.prepare(`
      INSERT INTO users (id, email, name, last_login, role)
      VALUES (?, ?, ?, datetime('now'), ?)
    `).run(id, email, name, role);
  });
  assign();

  res.json({ ok: true });
});

// GET /api/users/:id/role - role lookup for JWT callback.
// Service-only: the auth flow calls this with the shared API key.
router.get('/:id/role', requireService, (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ role: row.role });
});

// GET /api/users - list users (admin only)
router.get('/', requireAdmin, (req, res) => {
  const db = getDb();
  const users = db.prepare(`
    SELECT id, email, name, last_login, created_at, role
    FROM users
    ORDER BY created_at DESC
  `).all();
  res.json(users);
});

// GET /api/users/:id - user detail (admin only)
router.get('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(user);
});

// PUT /api/users/:id/role - update role (admin only)
router.put('/:id/role', requireAdmin, (req, res) => {
  if (isDemo()) return demoNoop(req, res);
  const db = getDb();
  const { role } = req.body;
  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin or user' });
  }
  const result = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// PUT /api/users/:id/last-login - update last login (service only)
router.put('/:id/last-login', requireService, (req, res) => {
  const db = getDb();
  db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

export default router;
