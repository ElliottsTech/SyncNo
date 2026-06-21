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
    filter_slug,
  } = req.query;
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];
  if (filter_name) {
    conditions.push('name LIKE ?');
    params.push(`%${filter_name}%`);
  }
  if (filter_slug) {
    conditions.push('slug LIKE ?');
    params.push(`%${filter_slug}%`);
  }
  const whereStr = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const validSorts = ['name', 'slug', 'modified', 'created_at', 'updated_at'];
  const safeSort = validSorts.includes(sortCol) ? sortCol : 'name';
  const safeDir = sortDir === 'desc' ? 'DESC' : 'ASC';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM wiki_pages ${whereStr}`).get(...params);
  const rows = db.prepare(`
    SELECT id, name, slug, modified, created_at, updated_at, synced
    FROM wiki_pages ${whereStr}
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
  const page = db.prepare('SELECT *, raw_json, synced FROM wiki_pages WHERE id = ?').get(req.params.id);
  if (!page) return res.status(404).json({ error: 'Not found' });
  res.json(page);
});

export default router;
