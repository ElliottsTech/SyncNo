/**
 * PDF generation for invoices, estimates, purchase orders, and tickets.
 *
 * Each PDF is produced by:
 *   1. Loading the entity + related data (customer/vendor/line items/etc.) from the DB
 *   2. Building a {{tag}} → value replacement map (same tag names Syncro uses)
 *   3. Filling the HTML template (DB-stored custom, or the default file)
 *   4. Rendering to PDF with Puppeteer (one fresh browser per render, closed in finally)
 *
 * The template is whatever the admin pasted into Settings → PDF Templates, so
 * it can be a Syncro template pasted verbatim. Tags that have no value (or
 * aren't relevant to the entity) are replaced with empty strings so the PDF
 * renders cleanly rather than showing literal {{...}}.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import puppeteer from 'puppeteer';
import { getDb } from '../db/database.js';
import { getSetting } from '../lib/settings.js';
import { getInvoiceLogoPath, getTemplateHtml } from '../routes/pdf_settings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Shared formatting helpers ──────────────────────────────────────────

function toNum(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(v) {
  const n = toNum(v);
  const neg = n < 0;
  const abs = Math.abs(n);
  return `${neg ? '-' : ''}$${abs.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function esc(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Shared context: logo + account (company) fields ────────────────────

let _logoCache = null;
let _logoCacheMtime = null;

function getLogoDataUri() {
  const logoPath = getInvoiceLogoPath();
  if (!logoPath) return '';
  try {
    const mtime = fs.statSync(logoPath).mtimeMs;
    if (_logoCache && _logoCacheMtime === mtime) return _logoCache;
    const buf = fs.readFileSync(logoPath);
    const ext = path.extname(logoPath).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    _logoCache = `data:${mime};base64,${buf.toString('base64')}`;
    _logoCacheMtime = mtime;
    return _logoCache;
  } catch {
    return '';
  }
}

/**
 * Account-level fields derived from the company settings. These appear on
 * every template via {{account_*}}, {{tax_label}}, {{logo_url}}, etc.
 */
function accountReplacements() {
  const companyName = getSetting('invoice_company_name') || '';
  const contactBlock = getSetting('invoice_contact_block') || '';
  const abnLabel = getSetting('invoice_abn_label') || 'ABN';
  const abn = getSetting('invoice_abn') || '';
  const taxLabel = getSetting('invoice_tax_label') || 'Tax';
  const logoUri = getLogoDataUri();
  return {
    logo_url: logoUri,
    logo_100: logoUri,
    logo_data_uri: logoUri,
    account_name: esc(companyName),
    account_vat_reg_no: esc(abn),
    account_website: esc(companyName ? '' : ''),
    account_phone: '',
    account_street: '',
    account_city: '',
    account_state: '',
    account_zip: '',
    account_email: '',
    account_address: '',
    account_url: '',
    account_subdomain: '',
    account_tech: '',
    tax_label: esc(taxLabel),
    // Company-name/contact used by the invoice template's header block.
    invoice_contact_block: contactBlock,
    invoice_abn_label: esc(abnLabel),
    invoice_name: esc(companyName),
    // Parse the contact block into account_phone/email if it looks like the
    // standard "Phone: ...\nE-mail: ..." format, for the PO/ticket templates
    // that use {{account_phone}} etc. directly.
    _contactBlock: contactBlock,
  };
}

/**
 * Customer fields from a raw_json.customer object — shared by invoice,
 * estimate, and ticket.
 */
function customerReplacements(c) {
  const billName = c
    ? (c.business_name || c.business_then_name || c.fullname || '')
    : '';
  return {
    customer_business_name_and_full_name: esc(c?.business_and_full_name || billName),
    customer_business_name_or_customer_full_name: esc(c?.business_then_name || billName),
    customer_business_name: esc(c?.business_name || ''),
    customer_full_name: esc(c?.fullname || ''),
    customer_name_label: esc(billName),
    customer_address: esc(c?.address || ''),
    customer_address_2: esc(c?.address_2 || ''),
    customer_city: esc(c?.city || ''),
    customer_state: esc(c?.state || ''),
    customer_zip: esc(c?.zip || ''),
    customer_email: esc(c?.email || ''),
    customer_phone: esc(c?.phone || ''),
    customer_mobile: esc(c?.mobile || ''),
    customer_billing_name: esc(billName),
    customer_billing_address: esc(c?.address || ''),
    customer_billing_address2: esc(c?.address_2 || ''),
    customer_billing_city: esc(c?.city || ''),
    customer_billing_state: esc(c?.state || ''),
    customer_billing_zip: esc(c?.zip || ''),
    customer_full_address: esc([c?.address, c?.address_2, [c?.city, c?.state, c?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')),
    customer_credit: '',
    customer_open_balance: '',
    customer_unapplied_credits: esc(fmtMoney(0)),
    customer_prepay_hours: esc(fmtMoney(0)),
  };
}

// ─── Line-item row generators ───────────────────────────────────────────

/**
 * Invoice/estimate line items → <tr> rows with the 5-column structure
 * (item/description/quantity/unitcost/linetotal) used by invoice.html and
 * estimate.html. Tax is shown aggregated in the summary, not per-line.
 */
function invoiceLineItemsRows(lineItems) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return '';
  return lineItems
    .slice()
    .sort((a, b) => (toNum(a.position) - toNum(b.position)) || 0)
    .map(li => {
      const item = esc(li.item || li.product_category || '');
      const description = esc(li.name || li.description || '');
      const qty = toNum(li.quantity);
      const unit = toNum(li.price);
      const net = qty * unit;
      const qtyStr = Number.isInteger(qty) ? String(qty) : qty.toFixed(2);
      return `<tr>
				<td class="item">${item}</td>
				<td class="description">${description}</td>
				<td class="quantity">${esc(qtyStr)}</td>
				<td class="unitcost">${esc(fmtMoney(unit))}</td>
				<td class="linetotal">${esc(fmtMoney(net))}</td>
			</tr>`;
    })
    .join('\n');
}

/**
 * Purchase-order line items → <tr> rows with the 6-column structure
 * (item/description/upc/unitcost/quantity/linetotal) used by purchase_order.html.
 * PO line items lack a name; product_name is enriched from the products table.
 */
function purchaseOrderLineItemsRows(lineItems, db) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return '';
  // Enrich product names
  const productIds = lineItems.map(li => li.product_id).filter(id => id != null);
  const nameMap = new Map();
  if (productIds.length) {
    const uniq = [...new Set(productIds.map(String))];
    const ph = uniq.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id, name FROM products WHERE id IN (${ph})`).all(...uniq);
    for (const r of rows) nameMap.set(String(r.id), r.name);
  }
  return lineItems.map(li => {
    const name = nameMap.get(String(li.product_id)) || li.name || '';
    const qty = toNum(li.quantity);
    const unit = toNum(li.cost);
    const lineTotal = toNum(li.total) || qty * unit;
    const qtyStr = Number.isInteger(qty) ? String(qty) : qty.toFixed(2);
    return `<tr>
				<td class="item">${esc(name)}</td>
				<td class="description">${esc(name)}</td>
				<td class="quantity">${esc(li.sku || '')}</td>
				<td class="unitcost">${esc(fmtMoney(unit))}</td>
				<td class="quantity">${esc(qtyStr)}</td>
				<td class="linetotal">${esc(fmtMoney(lineTotal))}</td>
			</tr>`;
  }).join('\n');
}

/**
 * Ticket public comments → <tr> rows (date + comment body).
 */
function ticketCommentRows(comments) {
  if (!Array.isArray(comments) || comments.length === 0) return '';
  return comments
    .filter(c => !c.hidden)
    .map(c => `<tr>
				<td>${esc(fmtDate(c.created_at))}</td>
				<td>${esc(c.subject || '')} ${esc(c.body || '')}</td>
			</tr>`)
    .join('\n');
}

/**
 * Ticket assets → <tr> rows (name / serial / type / properties).
 */
function ticketAssetRows(assets) {
  if (!Array.isArray(assets) || assets.length === 0) return '';
  return assets.map(a => {
    const props = a.properties || {};
    const propStr = typeof props === 'object'
      ? Object.entries(props).map(([k, v]) => `${k}: ${v}`).join(', ')
      : String(props || '');
    return `<tr>
				<td class="item">${esc(a.name || '')}</td>
				<td class="description">${esc(a.asset_serial || '')}</td>
				<td class="quantity">${esc(a.asset_type || '')}</td>
				<td class="linetotal">${esc(propStr)}</td>
			</tr>`;
  }).join('\n');
}

/**
 * Ticket custom fields → <tr> rows (field name / answer value).
 */
function ticketCustomFieldRows(fields, answers) {
  const answerMap = new Map();
  if (Array.isArray(answers)) {
    for (const a of answers) {
      if (a.ticket_field_id != null) answerMap.set(String(a.ticket_field_id), a.value ?? '');
    }
  }
  if (!Array.isArray(fields) || fields.length === 0) return '';
  return fields
    .filter(f => !f.hidden)
    .map(f => {
      const val = answerMap.get(String(f.id)) ?? '';
      return `<tr>
				<td class="item">${esc(f.name || '')}</td>
				<td class="description">${esc(val)}</td>
			</tr>`;
    })
    .join('\n');
}

// ─── Per-entity loaders + replacement builders ──────────────────────────

function loadInvoice(id) {
  return getDb().prepare(`
    SELECT id, customer_id, customer_business_then_name, number, date, due_date,
           subtotal, total, tax, verified_paid, tech_marked_paid, ticket_id,
           pdf_url, is_paid, location_id, po_number, note, raw_json
    FROM invoices WHERE id = ?
  `).get(id);
}

function buildInvoiceReplacements(inv) {
  let raw = null;
  if (inv.raw_json) {
    try { raw = typeof inv.raw_json === 'string' ? JSON.parse(inv.raw_json) : inv.raw_json; } catch { /* ignore */ }
  }
  const customer = raw?.customer || null;
  const lineItems = Array.isArray(raw?.line_items) ? raw.line_items : [];

  const paymentsTotal = sumInvoicePayments(inv.id);
  const balanceDue = raw?.balance_due != null ? toNum(raw.balance_due) : (toNum(inv.total) - paymentsTotal);
  const isPaid = inv.is_paid || inv.verified_paid;
  const paidStamp = isPaid
    ? '<span style="display:inline-block;transform:rotate(-12deg);border:4px solid #d40000;color:#d40000;font-size:34px;font-weight:bold;padding:4px 14px;letter-spacing:4px;opacity:0.85;">PAID</span>'
    : '';

  return {
    ...accountReplacements(),
    ...customerReplacements(customer),
    invoice_paid_stamp: paidStamp,
    invoice_date: esc(fmtDate(inv.date)),
    invoice_number: esc(inv.number || ''),
    invoice_due_date: esc(fmtDate(inv.due_date)),
    invoice_po_number: esc(inv.po_number || ''),
    invoice_line_items_table_no_tax: invoiceLineItemsRows(lineItems),
    invoice_line_items_table: invoiceLineItemsRows(lineItems),
    invoice_subtotal: esc(fmtMoney(inv.subtotal)),
    invoice_tax: esc(fmtMoney(inv.tax)),
    invoice_total: esc(fmtMoney(inv.total)),
    invoice_balance_due: esc(fmtMoney(balanceDue)),
    invoice_payments_amount: esc(fmtMoney(paymentsTotal)),
    invoice_misc_credits: esc(fmtMoney(0)),
    invoice_message: getSetting('invoice_message') || '',
    invoice_disclaimer: getSetting('invoice_disclaimer') || '',
  };
}

function sumInvoicePayments(invoiceId) {
  const rows = getDb().prepare(`
    SELECT payment_amount FROM payments
    WHERE invoice_ids LIKE ? OR invoice_ids LIKE ? OR invoice_ids LIKE ?
  `).all(`%"${invoiceId}"%`, `"${invoiceId}"%`, `%${invoiceId}%`);
  return rows.reduce((s, r) => s + toNum(r.payment_amount), 0);
}

function loadEstimate(id) {
  return getDb().prepare('SELECT *, raw_json FROM estimates WHERE id = ?').get(id);
}

function buildEstimateReplacements(est) {
  let raw = null;
  if (est.raw_json) {
    try { raw = typeof est.raw_json === 'string' ? JSON.parse(est.raw_json) : est.raw_json; } catch { /* ignore */ }
  }
  const customer = raw?.customer || null;
  const lineItems = Array.isArray(raw?.line_items) ? raw.line_items : [];

  return {
    ...accountReplacements(),
    ...customerReplacements(customer),
    estimate_date: esc(fmtDate(est.date)),
    estimate_number: esc(est.number || ''),
    estimate_name: esc(raw?.name || ''),
    estimate_subtotal: esc(fmtMoney(est.subtotal)),
    estimate_tax: esc(fmtMoney(est.tax)),
    estimate_total: esc(fmtMoney(est.total)),
    estimate_paid_stamp: '',
    // Estimates reuse the invoice line-items token name in their template.
    invoice_line_items_table_no_tax: invoiceLineItemsRows(lineItems),
    invoice_po_number: '',
    estimate_message: getSetting('estimate_message') || '',
    estimate_disclaimer: getSetting('estimate_disclaimer') || '',
  };
}

function loadPurchaseOrder(id) {
  return getDb().prepare('SELECT *, raw_json FROM purchase_orders WHERE id = ?').get(id);
}

function buildPurchaseOrderReplacements(po) {
  let raw = null;
  if (po.raw_json) {
    try { raw = typeof po.raw_json === 'string' ? JSON.parse(po.raw_json) : po.raw_json; } catch { /* ignore */ }
  }
  const vendor = raw?.vendor || null;
  let lineItems = raw?.line_items;
  if (!Array.isArray(lineItems)) {
    // Fall back to the denormalized line_items column
    try { lineItems = typeof po.line_items === 'string' ? JSON.parse(po.line_items) : po.line_items; } catch { lineItems = []; }
  }
  const db = getDb();

  const companyName = getSetting('invoice_company_name') || '';

  return {
    ...accountReplacements(),
    purchase_order_number: esc(po.number || ''),
    purchase_order_date: esc(fmtDate(po.created_at)),
    purchase_order_amount: esc(fmtMoney(po.total)),
    purchase_order_expected_date: esc(fmtDate(raw?.expected_date || po.expected_date)),
    purchase_order_general_notes: esc(raw?.general_notes || po.other || ''),
    purchase_order_shipping_notes: esc(raw?.shipping_notes || po.shipping_notes || ''),
    purchase_order_shipping_price: esc(fmtMoney(raw?.shipping || po.shipping || 0)),
    purchase_order_status: esc(po.status || ''),
    purchase_order_line_items_table: purchaseOrderLineItemsRows(lineItems, db),
    purchase_order_line_item_rows: purchaseOrderLineItemsRows(lineItems, db),
    purchase_order_line_item_rows_no_price: purchaseOrderLineItemsRows(lineItems, db),
    // Vendor fields
    vendor_name: esc(vendor?.name || ''),
    vendor_address: esc(vendor?.address || ''),
    vendor_address_2: esc(vendor?.address_2 || ''),
    vendor_city: esc(vendor?.city || ''),
    vendor_state: esc(vendor?.state || ''),
    vendor_zip: esc(vendor?.zip || ''),
    vendor_phone: esc(vendor?.phone || ''),
    vendor_email: esc(vendor?.email || ''),
    vendor_website: esc(vendor?.website || ''),
    vendor_account_number: esc(vendor?.account_number || ''),
    vendor_rep_first_name: esc(vendor?.rep_first_name || ''),
    vendor_rep_last_name: esc(vendor?.rep_last_name || ''),
    // Account (company) fields for the PO header
    account_name: esc(companyName),
    tax_label: esc(getSetting('invoice_tax_label') || 'Tax'),
  };
}

function loadTicket(id) {
  return getDb().prepare('SELECT *, raw_json FROM tickets WHERE id = ?').get(id);
}

function buildTicketReplacements(t) {
  let raw = null;
  if (t.raw_json) {
    try { raw = typeof t.raw_json === 'string' ? JSON.parse(t.raw_json) : t.raw_json; } catch { /* ignore */ }
  }
  const customer = raw?.customer || null;
  const comments = raw?.comments || [];
  const assets = raw?.assets || [];
  const ticketFields = raw?.ticket_fields || raw?.ticket_type?.ticket_fields || [];
  const ticketAnswers = raw?.ticket_answers || [];

  return {
    ...accountReplacements(),
    ...customerReplacements(customer),
    ticket_number: esc(t.number || ''),
    ticket_date: esc(fmtDate(t.created_at)),
    ticket_due_date: esc(fmtDate(t.due_date)),
    ticket_subject: esc(t.subject || ''),
    ticket_status: esc(t.status || ''),
    ticket_problem: esc(raw?.problem_type || t.problem_type || ''),
    ticket_location: esc(raw?.location_name || ''),
    ticket_link: '',
    ticket_url: '',
    ticket_creator_name: esc(raw?.contact?.name || customer?.fullname || ''),
    ticket_meta_details: '',
    ticket_images_rendered: '',
    ticket_barcode_string: esc(t.number || ''),
    ticket_custom_fields: '',
    ticket_worksheet_tables: '',
    ticket_worksheet_tables_compressed: '',
    ticket_public_comments_table: ticketCommentRows(comments),
    ticket_public_comments: ticketCommentRows(comments),
    ticket_public_fulltext_comments_table: ticketCommentRows(comments),
    ticket_public_fulltext_comments: ticketCommentRows(comments),
    asset_table: ticketAssetRows(assets),
    ticket_custom_fields_table: ticketCustomFieldRows(ticketFields, ticketAnswers),
    tech_name: esc(raw?.user?.full_name || ''),
    tech_bio: '',
    tech_photo_url: '',
    ticket_message: getSetting('ticket_message') || '',
    ticket_disclaimer: getSetting('ticket_disclaimer') || '',
    ticket_disclaimer_template: getSetting('ticket_disclaimer') || '',
  };
}

// ─── Entity registry ────────────────────────────────────────────────────

const ENTITY_BUILDERS = {
  invoice:        { load: loadInvoice,        build: buildInvoiceReplacements },
  estimate:       { load: loadEstimate,       build: buildEstimateReplacements },
  purchase_order: { load: loadPurchaseOrder,  build: buildPurchaseOrderReplacements },
  ticket:         { load: loadTicket,         build: buildTicketReplacements },
};

// ─── Template fill + render ─────────────────────────────────────────────

/**
 * Replace all {{tag}} occurrences in templateHtml with values from the map.
 * Any tag not present in the map is replaced with '' (empty) so the rendered
 * PDF never shows literal {{...}} placeholders.
 */
function fillTemplate(templateHtml, map) {
  // Apply known replacements
  let out = templateHtml;
  for (const [key, value] of Object.entries(map)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  // Strip any remaining (unsupported) tags → empty string
  out = out.replace(/\{\{[^}]+\}\}/g, '');
  return out;
}

function launchBrowser() {
  const opts = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) opts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  return puppeteer.launch(opts);
}

/**
 * Generate a PDF for the given entity type + id.
 * @param {'invoice'|'estimate'|'purchase_order'|'ticket'} type
 * @param {string|number} id
 * @returns {Promise<{buffer: Buffer, number: string} | null>}
 */
export async function generatePdf(type, id) {
  const builder = ENTITY_BUILDERS[type];
  if (!builder) throw new Error(`Unknown PDF type: ${type}`);

  const entity = builder.load(id);
  if (!entity) return null;

  const templateHtml = getTemplateHtml(type);
  const replacements = builder.build(entity);
  const html = fillTemplate(templateHtml, replacements);

  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0.4in', bottom: '0.4in', left: '0.4in', right: '0.4in' },
      preferCSSPageSize: false,
    });
    return { buffer: Buffer.from(pdfBytes), number: entity.number || String(entity.id) };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
