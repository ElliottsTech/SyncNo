/**
 * PDF settings — company branding (logo, company details) + per-template HTML
 * for the four PDF types (invoice, estimate, purchase_order, ticket).
 *
 * Company fields are persisted the same way as before: settings table +
 * process.env + .env (for single-line values). Templates (multi-line HTML)
 * are stored in the settings table + process.env only — they can't go in .env.
 *
 * The logo image lives at backend/data/invoice-assets/logo.png (gitignored).
 */

import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import multer from 'multer';
import { isDemo, demoNoop } from '../demo.js';
import { getSetting, setSetting, updateEnvFile } from '../lib/settings.js';
import { getDb } from '../db/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

const ASSETS_DIR = path.join(__dirname, '..', '..', 'data', 'invoice-assets');
const LOGO_FILENAME = 'logo.png';
const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/svg+xml', 'image/webp']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ') && auth.slice(7) === process.env.SYNCNO_API_KEY) {
    return next();
  }
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ─── Setting keys ──────────────────────────────────────────────────────
const COMPANY_KEYS = {
  companyName:  'invoice_company_name',
  contactBlock: 'invoice_contact_block',
  abnLabel:     'invoice_abn_label',
  abn:          'invoice_abn',
  taxLabel:     'invoice_tax_label',
};

// Per-template message + disclaimer setting keys.
const TEMPLATE_TEXT_KEYS = {
  invoice:        { message: 'invoice_message',      disclaimer: 'invoice_disclaimer' },
  estimate:       { message: 'estimate_message',     disclaimer: 'estimate_disclaimer' },
  purchase_order: { message: 'purchase_order_message', disclaimer: 'purchase_order_disclaimer' },
  ticket:         { message: 'ticket_message',       disclaimer: 'ticket_disclaimer' },
};

// The HTML template for each type is stored under one key. The default is
// read from backend/templates/<type>.html on disk.
const TEMPLATE_HTML_KEYS = {
  invoice:        'pdf_template_invoice',
  estimate:       'pdf_template_estimate',
  purchase_order: 'pdf_template_purchase_order',
  ticket:         'pdf_template_ticket',
};

const TEMPLATE_FILES = {
  invoice:        'invoice.html',
  estimate:       'estimate.html',
  purchase_order: 'purchase_order.html',
  ticket:         'ticket.html',
};

function logoPath() {
  return path.join(ASSETS_DIR, LOGO_FILENAME);
}
function logoExists() {
  try { return fs.existsSync(logoPath()); } catch { return false; }
}

function defaultTemplate(type) {
  const file = TEMPLATE_FILES[type];
  if (!file) return '';
  try { return fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf8'); } catch { return ''; }
}

// ─── GET / — company fields + template metadata ────────────────────────
router.get('/', requireAdmin, (req, res) => {
  const company = {
    companyName:   getSetting(COMPANY_KEYS.companyName) || '',
    contactBlock:  getSetting(COMPANY_KEYS.contactBlock) || '',
    abnLabel:      getSetting(COMPANY_KEYS.abnLabel) || 'ABN',
    abn:           getSetting(COMPANY_KEYS.abn) || '',
    taxLabel:      getSetting(COMPANY_KEYS.taxLabel) || 'Tax',
  };

  const templates = {};
  for (const type of Object.keys(TEMPLATE_HTML_KEYS)) {
    const custom = getSetting(TEMPLATE_HTML_KEYS[type]);
    const tk = TEMPLATE_TEXT_KEYS[type];
    templates[type] = {
      custom: Boolean(custom),
      html: custom || defaultTemplate(type),
      message: getSetting(tk.message) || '',
      disclaimer: getSetting(tk.disclaimer) || '',
    };
  }

  res.json({ company, templates, logoPresent: logoExists() });
});

// ─── POST / — save company text fields ─────────────────────────────────
const ENV_SAFE = new Set([
  COMPANY_KEYS.companyName, COMPANY_KEYS.abnLabel, COMPANY_KEYS.abn, COMPANY_KEYS.taxLabel,
]);

router.post('/', requireAdmin, (req, res) => {
  if (isDemo()) return demoNoop(req, res);

  const envUpdates = {};
  for (const [bodyKey, settingKey] of Object.entries(COMPANY_KEYS)) {
    if (req.body[bodyKey] === undefined) continue;
    const val = String(req.body[bodyKey]);
    setSetting(settingKey, val);
    process.env[settingKey.toUpperCase()] = val;
    if (ENV_SAFE.has(settingKey)) envUpdates[settingKey.toUpperCase()] = val;
  }
  try {
    updateEnvFile(path.resolve(process.cwd(), '.env'), envUpdates);
  } catch (e) {
    console.error('[pdf-settings] failed to write .env:', e.message);
  }
  res.json({ ok: true });
});

// ─── POST /template/:type — save template HTML + message/disclaimer ────
router.post('/template/:type', requireAdmin, (req, res) => {
  if (isDemo()) return demoNoop(req, res);
  const type = req.params.type;
  if (!TEMPLATE_HTML_KEYS[type]) return res.status(400).json({ error: 'Unknown template type' });

  const htmlKey = TEMPLATE_HTML_KEYS[type];
  const tk = TEMPLATE_TEXT_KEYS[type];

  if (req.body.html !== undefined) {
    const html = String(req.body.html);
    // Storing an empty string means "use default"; otherwise persist custom.
    if (html.trim()) {
      setSetting(htmlKey, html);
    } else {
      // Clear → reverts to default
      getDb().prepare('DELETE FROM settings WHERE key = ?').run(htmlKey);
    }
  }
  if (req.body.message !== undefined) {
    setSetting(tk.message, String(req.body.message));
  }
  if (req.body.disclaimer !== undefined) {
    setSetting(tk.disclaimer, String(req.body.disclaimer));
  }
  res.json({ ok: true });
});

// ─── POST /template/:type/reset — revert template to default file ──────
router.post('/template/:type/reset', requireAdmin, (req, res) => {
  if (isDemo()) return demoNoop(req, res);
  const type = req.params.type;
  if (!TEMPLATE_HTML_KEYS[type]) return res.status(400).json({ error: 'Unknown template type' });
  try {
    getDb().prepare('DELETE FROM settings WHERE key = ?').run(TEMPLATE_HTML_KEYS[type]);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  res.json({ ok: true, html: defaultTemplate(type) });
});

// ─── Logo endpoints (unchanged from invoice_settings) ──────────────────
router.get('/logo', requireAdmin, (req, res) => {
  if (!logoExists()) return res.status(404).json({ error: 'No logo uploaded' });
  res.sendFile(logoPath());
});

router.post('/logo', requireAdmin, upload.single('logo'), (req, res) => {
  if (isDemo()) return demoNoop(req, res);
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name must be "logo")' });
  if (!ALLOWED_MIME.has(req.file.mimetype)) {
    return res.status(400).json({ error: `Unsupported file type: ${req.file.mimetype}. Allowed: PNG, JPEG, GIF, SVG, WebP.` });
  }
  try {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
    fs.writeFileSync(logoPath(), req.file.buffer);
  } catch (e) {
    return res.status(500).json({ error: `Failed to store logo: ${e.message}` });
  }
  res.json({ ok: true, logoPresent: true, size: req.file.size, mimetype: req.file.mimetype });
});

router.delete('/logo', requireAdmin, (req, res) => {
  if (isDemo()) return demoNoop(req, res);
  try { if (logoExists()) fs.unlinkSync(logoPath()); } catch (e) {
    return res.status(500).json({ error: `Failed to remove logo: ${e.message}` });
  }
  res.json({ ok: true, logoPresent: false });
});

// ─── Exported helpers reused by the PDF service ────────────────────────
export function getInvoiceLogoPath() {
  return logoExists() ? logoPath() : null;
}

/**
 * Return the HTML template for a given type: the custom one from the DB if
 * set, otherwise the default file from backend/templates/.
 */
export function getTemplateHtml(type) {
  const custom = getSetting(TEMPLATE_HTML_KEYS[type]);
  if (custom) return custom;
  return defaultTemplate(type);
}

export default router;
