import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const {
    page = 1,
    limit = 50,
    sortCol = 'created_at',
    sortDir = 'desc',
    filter_name,
    filter_email,
    filter_status,
    filter_mailbox_name,
    filter_ticket_subject,
  } = req.query;
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];
  if (filter_name) {
    conditions.push('(name LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR business_then_name LIKE ?)');
    const term = `%${filter_name}%`;
    params.push(term, term, term, term);
  }
  if (filter_email) {
    conditions.push('email LIKE ?');
    params.push(`%${filter_email}%`);
  }
  if (filter_status) {
    conditions.push('status LIKE ?');
    params.push(`%${filter_status}%`);
  }
  if (filter_mailbox_name) {
    conditions.push('mailbox_name LIKE ?');
    params.push(`%${filter_mailbox_name}%`);
  }
  if (filter_ticket_subject) {
    conditions.push('ticket_subject LIKE ?');
    params.push(`%${filter_ticket_subject}%`);
  }
  const whereStr = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const validSorts = [
    'name', 'email', 'status', 'created_at', 'updated_at',
    'mailbox_name', 'ticket_subject', 'business_then_name',
  ];
  const safeSort = validSorts.includes(sortCol) ? sortCol : 'created_at';
  const safeDir = sortDir === 'asc' ? 'ASC' : 'DESC';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM leads ${whereStr}`).get(...params);
  const rows = db.prepare(`
    SELECT id, name, first_name, last_name, business_then_name,
           email, phone, mobile, city, state,
           status, customer_id, contact_id, ticket_id, ticket_subject, ticket_problem_type,
           mailbox_name, has_attachments, message_read,
           created_at, updated_at, synced
    FROM leads ${whereStr}
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
  const lead = db.prepare('SELECT *, raw_json, synced FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Not found' });

  let customer = null;
  if (lead.customer_id) {
    customer = db.prepare(`
      SELECT id, business_name, fullname, email, phone, city, state,
             COALESCE(NULLIF(business_name,''), fullname) as display_name
      FROM customers WHERE id = ?
    `).get(lead.customer_id) || null;
  }
  lead.customer = customer;

  let contact = null;
  if (lead.contact_id) {
    contact = db.prepare(`
      SELECT id, name, email, phone, mobile
      FROM contacts WHERE id = ?
    `).get(lead.contact_id) || null;
  }
  lead.contact = contact;

  let ticket = null;
  if (lead.ticket_id) {
    ticket = db.prepare(`
      SELECT id, number, subject, status, priority, created_at, customer_business_then_name
      FROM tickets WHERE id = ?
    `).get(lead.ticket_id) || null;
  }
  lead.ticket = ticket;

  res.json(lead);
});

export default router;
