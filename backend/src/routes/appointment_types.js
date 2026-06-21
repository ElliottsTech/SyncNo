import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const {
    page = 1,
    limit = 50,
    sortCol = 'name',
    sortDir = 'asc',
    filter_name,
  } = req.query;
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];
  if (filter_name) {
    conditions.push('name LIKE ?');
    params.push(`%${filter_name}%`);
  }
  const whereStr = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const validSorts = ['name', 'created_at', 'updated_at'];
  const safeSort = validSorts.includes(sortCol) ? sortCol : 'name';
  const safeDir = sortDir === 'desc' ? 'DESC' : 'ASC';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM appointment_types ${whereStr}`).get(...params);
  const rows = db.prepare(`
    SELECT id, name, created_at, updated_at, synced
    FROM appointment_types ${whereStr}
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
  const row = db.prepare('SELECT *, raw_json, synced FROM appointment_types WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

export default router;
