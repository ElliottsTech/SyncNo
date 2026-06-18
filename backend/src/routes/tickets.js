import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// GET /api/tickets - all tickets
router.get('/', (req, res) => {
  const db = getDb();
  const { page = 1, limit = 100, status = '', search = '', sortCol = 'created_at', sortDir = 'desc',
          filter_number, filter_subject, filter_customer_business_then_name, filter_status, filter_priority } = req.query;
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (search) {
    conditions.push('(subject LIKE ? OR number LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  // Column-specific filters
  if (filter_number) {
    conditions.push('number LIKE ?');
    params.push(`%${filter_number}%`);
  }
  if (filter_subject) {
    conditions.push('subject LIKE ?');
    params.push(`%${filter_subject}%`);
  }
  if (filter_customer_business_then_name) {
    conditions.push('customer_business_then_name LIKE ?');
    params.push(`%${filter_customer_business_then_name}%`);
  }
  if (filter_status) {
    conditions.push('status LIKE ?');
    params.push(`%${filter_status}%`);
  }
  if (filter_priority) {
    conditions.push('priority LIKE ?');
    params.push(`%${filter_priority}%`);
  }

  const whereStr = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const validSorts = ['created_at', 'due_date', 'number', 'status', 'priority', 'subject'];
  const safeSort = validSorts.includes(sortCol) ? sortCol : 'created_at';
  const safeDir = sortDir === 'asc' ? 'ASC' : 'DESC';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM tickets ${whereStr}`).get(...params);
  const tickets = db.prepare(`
    SELECT id, number, subject, status, priority, created_at, customer_id, customer_business_then_name, synced
    FROM tickets ${whereStr}
    ORDER BY ${safeSort} ${safeDir}
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));

  res.json({
    data: tickets,
    pagination: { page: Number(page), limit: Number(limit), total: countRow.total },
  });
});

// GET /api/tickets/:id - ticket detail
router.get('/:id', (req, res) => {
  const db = getDb();
  const ticket = db.prepare('SELECT *, raw_json, synced FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  if (ticket.comments && typeof ticket.comments === 'string') {
    try {
      ticket.comments = JSON.parse(ticket.comments);
    } catch (e) {}
  }

  res.json(ticket);
});

// GET /api/tickets/:id/comments
router.get('/:id/comments', (req, res) => {
  const db = getDb();
  const comments = db.prepare(`
    SELECT *, raw_json FROM ticket_comments WHERE ticket_id = ? ORDER BY created_at ASC
  `).all(req.params.id);
  res.json(comments);
});

// GET /api/tickets/:id/time_entries
router.get('/:id/time_entries', (req, res) => {
  const db = getDb();
  const timeEntries = db.prepare(`
    SELECT *, raw_json FROM ticket_time_entries WHERE ticket_id = ? ORDER BY start_time ASC
  `).all(req.params.id);
  res.json(timeEntries);
});

// GET /api/tickets/:id/line_items
router.get('/:id/line_items', (req, res) => {
  const db = getDb();
  const lineItems = db.prepare(`
    SELECT tli.*, tli.raw_json, p.name as product_name
    FROM ticket_line_items tli
    LEFT JOIN products p ON tli.product_id = p.id
    WHERE tli.ticket_id = ?
    ORDER BY tli.created_at ASC
  `).all(req.params.id);
  res.json(lineItems);
});

// GET /api/tickets/:id/invoices - all invoices linked to this ticket
router.get('/:id/invoices', (req, res) => {
  const db = getDb();
  const invoices = db.prepare(`
    SELECT id, number, customer_business_then_name, date, due_date, total,
           is_paid, verified_paid, tech_marked_paid, synced
    FROM invoices
    WHERE ticket_id = ?
    ORDER BY date DESC
  `).all(req.params.id);
  res.json(invoices);
});

export default router;
