import { Router } from 'express';
import { getDb } from '../db/database.js';
import fs from 'fs';
import path from 'path';

const router = Router();

const ATTACHMENTS_DIR = path.resolve(process.cwd(), 'data/attachments');

const MIME_BY_EXT = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', txt: 'text/plain', csv: 'text/csv',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip', json: 'application/json', html: 'text/html',
};
function guessContentType(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

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

  const validSorts = ['created_at', 'updated_at', 'due_date', 'resolved_at', 'number', 'status', 'priority', 'subject', 'problem_type'];
  const safeSort = validSorts.includes(sortCol) ? sortCol : 'created_at';
  const safeDir = sortDir === 'asc' ? 'ASC' : 'DESC';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM tickets ${whereStr}`).get(...params);
  const tickets = db.prepare(`
    SELECT id, number, subject, status, priority, created_at, updated_at, due_date, resolved_at,
           problem_type, customer_id, customer_business_then_name, attachments_count, raw_json, synced
    FROM tickets ${whereStr}
    ORDER BY ${safeSort} ${safeDir}
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));

  // Surface a few fields that only live inside raw_json so the list page can
  // render them without a second round-trip per row.
  const data = tickets.map(t => {
    let ticket_type_name = null;
    let tags = null;
    if (t.raw_json) {
      try {
        const j = JSON.parse(t.raw_json);
        if (j.ticket_type && j.ticket_type.name) ticket_type_name = j.ticket_type.name;
        if (Array.isArray(j.tag_list) && j.tag_list.length) tags = j.tag_list;
      } catch (_) {}
    }
    delete t.raw_json;
    return { ...t, ticket_type_name, tags };
  });

  res.json({
    data,
    pagination: { page: Number(page), limit: Number(limit), total: countRow.total },
  });
});

// GET /api/tickets/:id/pdf - generate a PDF for this ticket
router.get('/:id/pdf', async (req, res) => {
  try {
    const { generatePdf } = await import('../services/pdf.js');
    const result = await generatePdf('ticket', req.params.id);
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Ticket ${result.number}.pdf"`);
    res.send(result.buffer);
  } catch (e) {
    console.error('[tickets/pdf] generation failed:', e);
    res.status(500).json({ error: 'PDF generation failed', detail: e.message });
  }
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

  if (ticket.user && typeof ticket.user === 'string') {
    try {
      ticket.user = JSON.parse(ticket.user);
    } catch (e) {}
  }

  res.json(ticket);
});

// GET /api/tickets/:id/attachments - list locally-cached attachment files
router.get('/:id/attachments', (req, res) => {
  const db = getDb();
  const ticket = db.prepare('SELECT id, number, attachments_count, attachments_synced_at FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  const ticketNumber = String(ticket.number || ticket.id);
  const ticketDir = path.join(ATTACHMENTS_DIR, ticketNumber);
  let files = [];
  if (fs.existsSync(ticketDir) && fs.statSync(ticketDir).isDirectory()) {
    files = fs.readdirSync(ticketDir)
      .filter(name => !name.startsWith('.'))
      .map(name => {
        const full = path.join(ticketDir, name);
        const stat = fs.statSync(full);
        return {
          name,
          size: stat.size,
          url: `/api/attachments/${encodeURIComponent(ticketNumber)}/${encodeURIComponent(name)}`,
          content_type: guessContentType(name),
        };
      });
  }
  res.json({
    data: files,
    count: files.length,
    attachments_count: ticket.attachments_count || 0,
    attachments_synced_at: ticket.attachments_synced_at || null,
  });
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
    SELECT tli.*, tli.raw_json, p.name as product_name, ps.serial_number
    FROM ticket_line_items tli
    LEFT JOIN products p ON tli.product_id = p.id
    LEFT JOIN product_serials ps ON ps.line_item_id = tli.id
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

// GET /api/tickets/:id/estimates - all estimates linked to this ticket
router.get('/:id/estimates', (req, res) => {
  const db = getDb();
  const estimates = db.prepare(`
    SELECT id, number, status, date, subtotal, total, tax, invoice_id
    FROM estimates
    WHERE ticket_id = ?
    ORDER BY date DESC
  `).all(req.params.id);
  res.json(estimates);
});

// GET /api/tickets/:id/appointments - appointments linked to this ticket
router.get('/:id/appointments', (req, res) => {
  const db = getDb();
  const appts = db.prepare(`
    SELECT id, summary, customer_id, start_at, end_at, duration, location, all_day, synced
    FROM appointments
    WHERE ticket_id = ?
    ORDER BY start_at DESC
  `).all(req.params.id);
  res.json(appts);
});

// GET /api/tickets/:ticket_id/worksheet_results - worksheets for this ticket
router.get('/:ticket_id/worksheet_results', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, name, created_at, updated_at, synced
    FROM worksheet_results
    WHERE ticket_id = ?
    ORDER BY created_at DESC
  `).all(req.params.ticket_id);
  res.json(rows);
});

// GET /api/tickets/:ticket_id/worksheet_results/:id - worksheet detail
router.get('/:ticket_id/worksheet_results/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT *, raw_json, synced FROM worksheet_results
    WHERE id = ? AND ticket_id = ?
  `).get(req.params.id, req.params.ticket_id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

export default router;
