import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// All searchable entity types, in display order.
const ALL_TYPES = [
  'customer',
  'ticket',
  'ticket_comment',
  'invoice',
  'product',
  'vendor',
  'serial',
  'appointment',
  'contract',
  'lead',
  'portal_user',
  'syncro_user',
  'wiki_page',
  'schedule',
];

// Customer display name with business_name preferred over fullname.
const CUSTOMER_NAME_EXPR = `COALESCE(NULLIF(c.business_name,''), NULLIF(c.fullname,''))`;

// GET /api/search?q=term&type=type1,type2,...
// type omitted  → search all types
// type=a,b     → search only listed types
//
// Each result row is normalized to:
//   { id, type, title, subtitle, status, date, customer, ...rawFields }
// title    primary label
// subtitle secondary identifier (number / email / slug / location)
// status   entity status text (or null)
// date     relevant timestamp (or null)
// customer linked customer display name (or null)
router.get('/', (req, res) => {
  const db = getDb();
  const { q = '', type = '' } = req.query;

  if (!q || q.length < 2) {
    return res.json({ data: [], types: ALL_TYPES });
  }

  // type may be string ("a,b") or array (already). Normalize to Set.
  const rawTypes = Array.isArray(type) ? type : String(type || '').split(',');
  const wanted = new Set(rawTypes.map(t => t.trim()).filter(Boolean));
  const wants = (t) => wanted.size === 0 || wanted.has(t);

  const results = [];
  const searchTerm = `%${q}%`;

  // Search customers
  if (wants('customer')) {
    const customers = db.prepare(`
      SELECT id, business_name, fullname, email, city, state, 'customer' AS type
      FROM customers
      WHERE business_name LIKE ? OR fullname LIKE ? OR email LIKE ?
      LIMIT 25
    `).all(searchTerm, searchTerm, searchTerm);
    results.push(...customers.map(c => {
      const name = c.business_name || c.fullname;
      return {
        ...c,
        title: name,
        subtitle: [c.email, c.city, c.state].filter(Boolean).join(' · '),
        status: null,
        date: null,
        customer: name,
      };
    }));
  }

  // Search tickets
  if (wants('ticket')) {
    const tickets = db.prepare(`
      SELECT id, number, subject, customer_business_then_name, status, priority, created_at, 'ticket' AS type
      FROM tickets
      WHERE subject LIKE ? OR number LIKE ?
      LIMIT 25
    `).all(searchTerm, searchTerm);
    results.push(...tickets.map(t => ({
      ...t,
      title: t.subject,
      subtitle: t.number || '',
      status: t.status || null,
      date: t.created_at || null,
      customer: t.customer_business_then_name || null,
    })));
  }

  // Search ticket comments (body text). Link jumps to parent ticket.
  if (wants('ticket_comment')) {
    const comments = db.prepare(`
      SELECT tc.id AS comment_id, tc.ticket_id, tc.body, tc.tech, tc.created_at,
             t.number AS ticket_number, t.subject AS ticket_subject, t.status AS ticket_status,
             t.customer_business_then_name,
             'ticket_comment' AS type
      FROM ticket_comments tc
      LEFT JOIN tickets t ON t.id = tc.ticket_id
      WHERE tc.body LIKE ?
      LIMIT 50
    `).all(searchTerm);
    results.push(...comments.map(c => {
      const snippet = (c.body || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      return {
        ...c,
        // Use ticket_id as id so linkFor routes to the parent ticket.
        id: c.ticket_id,
        title: snippet || '(empty comment)',
        subtitle: `${c.ticket_number || '?'} · ${c.tech || 'unknown'}`,
        status: c.ticket_status || null,
        date: c.created_at || null,
        customer: c.customer_business_then_name || null,
      };
    }));
  }

  // Search invoices
  if (wants('invoice')) {
    const invoices = db.prepare(`
      SELECT id, number, customer_business_then_name, customer_id, total, date, due_date,
             is_paid, verified_paid, 'invoice' AS type
      FROM invoices
      WHERE number LIKE ? OR customer_business_then_name LIKE ?
      LIMIT 25
    `).all(searchTerm, searchTerm);
    results.push(...invoices.map(inv => ({
      ...inv,
      title: inv.number || `(invoice #${inv.id})`,
      subtitle: inv.total != null ? `$${inv.total}` : '',
      status: inv.is_paid ? 'paid' : (inv.verified_paid ? 'verified' : 'unpaid'),
      date: inv.date || null,
      customer: inv.customer_business_then_name || null,
    })));
  }

  // Search products
  if (wants('product')) {
    const products = db.prepare(`
      SELECT id, name, description, price_retail, product_category, upc_code, quantity, disabled, updated_at,
             'product' AS type
      FROM products
      WHERE name LIKE ? OR description LIKE ? OR upc_code LIKE ?
      LIMIT 25
    `).all(searchTerm, searchTerm, searchTerm);
    results.push(...products.map(p => ({
      ...p,
      title: p.name,
      subtitle: [p.product_category, p.price_retail != null ? `$${p.price_retail}` : null, p.upc_code]
        .filter(Boolean).join(' · '),
      status: p.disabled ? 'disabled' : 'active',
      date: p.updated_at || null,
      customer: null,
    })));
  }

  // Search vendors
  if (wants('vendor')) {
    const vendors = db.prepare(`
      SELECT id, name, email, phone, 'vendor' AS type
      FROM vendors
      WHERE name LIKE ? OR email LIKE ?
      LIMIT 10
    `).all(searchTerm, searchTerm);
    results.push(...vendors.map(v => ({
      ...v,
      title: v.name,
      subtitle: v.email,
      status: null,
      date: null,
      customer: null,
    })));
  }

  // Search product serials
  if (wants('serial')) {
    const serials = db.prepare(`
      SELECT serial_number, product_id, status, 'serial' AS type
      FROM product_serials
      WHERE serial_number LIKE ?
      LIMIT 25
    `).all(searchTerm);
    results.push(...serials.map(s => ({
      ...s,
      // Use serial_number as id for routing — /serials/[serial]
      id: s.serial_number,
      title: s.serial_number,
      subtitle: s.product_id ? `product ${s.product_id}` : '',
      status: s.status || null,
      date: null,
      customer: null,
    })));
  }

  // Search appointments
  if (wants('appointment')) {
    const appts = db.prepare(`
      SELECT a.id, a.summary, a.start_at, a.location, a.customer_id, 'appointment' AS type,
             ${CUSTOMER_NAME_EXPR} AS customer_name
      FROM appointments a
      LEFT JOIN customers c ON c.id = a.customer_id
      WHERE a.summary LIKE ? OR a.location LIKE ?
      LIMIT 15
    `).all(searchTerm, searchTerm);
    results.push(...appts.map(a => ({
      ...a,
      title: a.summary || '(untitled)',
      subtitle: a.location || '',
      status: null,
      date: a.start_at || null,
      customer: a.customer_name || null,
    })));
  }

  // Search contracts
  if (wants('contract')) {
    const contracts = db.prepare(`
      SELECT ct.id, ct.name, ct.status, ct.customer_id, 'contract' AS type,
             ${CUSTOMER_NAME_EXPR} AS customer_name
      FROM contracts ct
      LEFT JOIN customers c ON c.id = ct.customer_id
      WHERE ct.name LIKE ?
      LIMIT 15
    `).all(searchTerm);
    results.push(...contracts.map(c => ({
      ...c,
      title: c.name,
      subtitle: '',
      status: c.status || null,
      date: null,
      customer: c.customer_name || null,
    })));
  }

  // Search leads
  if (wants('lead')) {
    const leads = db.prepare(`
      SELECT l.id, l.name, l.email, l.status, l.customer_id, 'lead' AS type,
             ${CUSTOMER_NAME_EXPR} AS customer_name
      FROM leads l
      LEFT JOIN customers c ON c.id = l.customer_id
      WHERE l.name LIKE ? OR l.email LIKE ?
      LIMIT 15
    `).all(searchTerm, searchTerm);
    results.push(...leads.map(l => ({
      ...l,
      title: l.name,
      subtitle: l.email,
      status: l.status || null,
      date: null,
      customer: l.customer_name || null,
    })));
  }

  // Search portal users
  if (wants('portal_user')) {
    const pus = db.prepare(`
      SELECT p.id, p.email, p.disabled, p.customer_id, 'portal_user' AS type,
             ${CUSTOMER_NAME_EXPR} AS customer_name
      FROM portal_users p
      LEFT JOIN customers c ON c.id = p.customer_id
      WHERE p.email LIKE ?
      LIMIT 15
    `).all(searchTerm);
    results.push(...pus.map(p => ({
      ...p,
      title: p.email,
      subtitle: '',
      status: p.disabled ? 'disabled' : 'active',
      date: null,
      customer: p.customer_name || null,
    })));
  }

  // Search syncro users
  if (wants('syncro_user')) {
    const sus = db.prepare(`
      SELECT id, email, name, 'syncro_user' AS type
      FROM syncro_users
      WHERE email LIKE ? OR name LIKE ?
      LIMIT 15
    `).all(searchTerm, searchTerm);
    results.push(...sus.map(u => ({
      ...u,
      title: u.name || u.email,
      subtitle: u.email,
      status: null,
      date: null,
      customer: null,
    })));
  }

  // Search wiki pages
  if (wants('wiki_page')) {
    const pages = db.prepare(`
      SELECT id, name, slug, modified, 'wiki_page' AS type
      FROM wiki_pages
      WHERE name LIKE ? OR body LIKE ?
      LIMIT 15
    `).all(searchTerm, searchTerm);
    results.push(...pages.map(p => ({
      ...p,
      title: p.name,
      subtitle: p.slug || '',
      status: null,
      date: p.modified || null,
      customer: null,
    })));
  }

  // Search schedules
  if (wants('schedule')) {
    const schedules = db.prepare(`
      SELECT s.id, s.name, s.status, s.customer_id, 'schedule' AS type,
             ${CUSTOMER_NAME_EXPR} AS customer_name
      FROM schedules s
      LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.name LIKE ?
      LIMIT 15
    `).all(searchTerm);
    results.push(...schedules.map(s => ({
      ...s,
      title: s.name || '(untitled)',
      subtitle: '',
      status: s.status || null,
      date: null,
      customer: s.customer_name || null,
    })));
  }

  res.json({ data: results, types: ALL_TYPES });
});

export default router;
