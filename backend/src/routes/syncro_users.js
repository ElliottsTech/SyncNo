import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const {
    page = 1,
    limit = 50,
    sortCol = 'email',
    sortDir = 'asc',
    filter_email,
    filter_name,
    filter_disabled,
  } = req.query;
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];
  if (filter_email) {
    conditions.push('email LIKE ?');
    params.push(`%${filter_email}%`);
  }
  if (filter_name) {
    conditions.push('name LIKE ?');
    params.push(`%${filter_name}%`);
  }
  if (filter_disabled !== undefined && filter_disabled !== '') {
    conditions.push('disabled = ?');
    params.push(Number(filter_disabled) ? 1 : 0);
  }
  const whereStr = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const validSorts = ['email', 'name', 'disabled', 'type', 'created_at', 'updated_at'];
  const safeSort = validSorts.includes(sortCol) ? sortCol : 'email';
  const safeDir = sortDir === 'desc' ? 'DESC' : 'ASC';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM syncro_users ${whereStr}`).get(...params);
  const rows = db.prepare(`
    SELECT id, email, name, first_name, last_name, disabled, type, created_at, updated_at, synced
    FROM syncro_users ${whereStr}
    ORDER BY ${safeSort} ${safeDir}
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));

  res.json({
    data: rows,
    pagination: { page: Number(page), limit: Number(limit), total: countRow.total },
  });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT *, raw_json, synced FROM syncro_users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(user);
});

export default router;
