import express from 'express';
import cors from 'cors';
import { decode as decodeJwt } from 'next-auth/jwt';
import { initDb } from './db/database.js';
import customersRouter from './routes/customers.js';
import ticketsRouter from './routes/tickets.js';
import invoicesRouter from './routes/invoices.js';
import vendorsRouter from './routes/vendors.js';
import searchRouter from './routes/search.js';
import estimatesRouter from './routes/estimates.js';
import purchaseOrdersRouter from './routes/purchaseOrders.js';
import assetsRouter from './routes/assets.js';
import productsRouter from './routes/products.js';
import serialsRouter from './routes/serials.js';
import paymentsRouter from './routes/payments.js';
import usersRouter from './routes/users.js';
import logsRouter from './routes/logs.js';
import appointmentTypesRouter from './routes/appointment_types.js';
import appointmentsRouter from './routes/appointments.js';
import contractsRouter from './routes/contracts.js';
import leadsRouter from './routes/leads.js';
import policyFoldersRouter from './routes/policy_folders.js';
import portalUsersRouter from './routes/portal_users.js';
import schedulesRouter from './routes/schedules.js';
import syncroUsersRouter from './routes/syncro_users.js';
import wikiPagesRouter from './routes/wiki_pages.js';
import syncRouter from './routes/sync.js';
import systemRouter from './routes/system.js';
import backupSettingsRouter from './routes/backup_settings.js';
import { startAnalytics } from './analytics.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').trim().split('\n').map(l => {
    const i = l.indexOf('=');
    return i === -1 ? [l] : [l.slice(0, i), l.slice(i + 1)];
  })
);
for (const [key, value] of Object.entries(env)) {
  if (process.env[key] === undefined) process.env[key] = value;
}
const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET;
const SYNCNO_API_KEY = process.env.SYNCNO_API_KEY;

const app = express();
const PORT = 3002;

// Same-origin via Next.js rewrite in prod, but allow configured origin for direct dev.
const corsOrigin = process.env.CORS_ORIGIN || false;
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json());

// Public paths that skip auth entirely.
const PUBLIC_PATHS = ['/api/health', '/api/auth/'];

// Authenticate every request via either:
//   (a) NextAuth session cookie (browser, forwarded through the Next.js rewrite), or
//   (b) Authorization: Bearer <SYNCNO_API_KEY> (service key — MCP, NextAuth callbacks).
// Unauthenticated requests are rejected with 401.
app.use(async (req, res, next) => {
  if (PUBLIC_PATHS.some(p => req.path === p || req.path.startsWith(p))) return next();

  // (a) Cookie path
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/(__Secure-)?next-auth\.session-token=([^;]+)/);
    if (match) {
      try {
        const decoded = await decodeJwt({ token: match[2], secret: NEXTAUTH_SECRET });
        if (decoded) {
          req.user = decoded;
          return next();
        }
      } catch (e) {
        // Fall through to bearer check
      }
    }
  }

  // (b) Service key path
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ') && authHeader.slice(7) === SYNCNO_API_KEY) {
    req.user = { role: 'service' };
    return next();
  }

  return res.status(401).json({ error: 'Authentication required' });
});

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

// Initialize DB on startup
initDb();

// Routes
app.use('/api/customers', customersRouter);
app.use('/api/tickets', ticketsRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/vendors', vendorsRouter);
app.use('/api/search', searchRouter);
app.use('/api/estimates', estimatesRouter);
app.use('/api/purchase-orders', purchaseOrdersRouter);
app.use('/api/assets', assetsRouter);
app.use('/api/products', productsRouter);
app.use('/api/serials', serialsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/users', usersRouter);
app.use('/api/logs', logsRouter);
app.use('/api/appointment_types', appointmentTypesRouter);
app.use('/api/appointments', appointmentsRouter);
app.use('/api/contracts', contractsRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/policy_folders', policyFoldersRouter);
app.use('/api/portal_users', portalUsersRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/syncro_users', syncroUsersRouter);
app.use('/api/wiki_pages', wikiPagesRouter);
app.use('/api/sync', syncRouter);
app.use('/api/system', systemRouter);
app.use('/api/backup-settings', backupSettingsRouter);

// Serve locally-cached ticket attachment files.
// Auth middleware above already gates all /api/* — session required.
const attachmentsDir = join(__dirname, '..', 'data', 'attachments');
app.use('/api/attachments', express.static(attachmentsDir, {
  dotfiles: 'ignore',
  index: false,
  fallthrough: true,
}));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Syncno API running on http://localhost:${PORT}`);
  startAnalytics();
});
