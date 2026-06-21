import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const {
    page = 1,
    limit = 50,
    sortCol = 'start_at',
    sortDir = 'desc',
    filter_summary,
    filter_location,
    filter_customer_id,
    filter_ticket_id,
  } = req.query;
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];
  if (filter_summary) {
    conditions.push('summary LIKE ?');
    params.push(`%${filter_summary}%`);
  }
  if (filter_location) {
    conditions.push('location LIKE ?');
    params.push(`%${filter_location}%`);
  }
  if (filter_customer_id) {
    conditions.push('customer_id = ?');
    params.push(Number(filter_customer_id));
  }
  if (filter_ticket_id) {
    conditions.push('ticket_id = ?');
    params.push(Number(filter_ticket_id));
  }
  const whereStr = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const validSorts = ['start_at', 'end_at', 'summary', 'created_at', 'updated_at'];
  const safeSort = validSorts.includes(sortCol) ? sortCol : 'start_at';
  const safeDir = sortDir === 'asc' ? 'ASC' : 'DESC';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM appointments ${whereStr}`).get(...params);
  const rows = db.prepare(`
    SELECT id, summary, customer_id, ticket_id, start_at, end_at, duration,
           location, appointment_location_type, all_day, created_at, updated_at, synced
    FROM appointments ${whereStr}
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
  const appt = db.prepare(`
    SELECT id, summary, description, customer_id, ticket_id, start_at, end_at,
           duration, location, appointment_location_type, start_at_label, all_day,
           do_not_email, created_at, updated_at, raw_json, synced
    FROM appointments WHERE id = ?
  `).get(req.params.id);
  if (!appt) return res.status(404).json({ error: 'Not found' });

  let ticket = null;
  let customer = null;
  if (appt.ticket_id) {
    ticket = db.prepare(`SELECT id, number, subject, status, priority FROM tickets WHERE id = ?`).get(appt.ticket_id) || null;
  }
  if (appt.customer_id) {
    customer = db.prepare(`
      SELECT id, business_name, fullname,
             COALESCE(NULLIF(business_name,''), fullname) as display_name
      FROM customers WHERE id = ?
    `).get(appt.customer_id) || null;
  }
  appt.ticket = ticket;
  appt.customer = customer;
  res.json(appt);
});

export default router;
