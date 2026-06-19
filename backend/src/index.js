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
import syncRouter from './routes/sync.js';
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

const app = express();
const PORT = 3002;

app.use(cors());
app.use(express.json());

// Verify NextAuth JWT session (JWE-encrypted cookie)
app.use(async (req, res, next) => {
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/__Secure-next-auth\.session-token=([^;]+)/);
    if (match) {
      try {
        const decoded = await decodeJwt({
          token: match[1],
          secret: NEXTAUTH_SECRET,
        });
        if (decoded) req.user = decoded;
      } catch (e) {
        // Invalid token - allow request but no user
      }
    }
  }
  next();
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
app.use('/api/sync', syncRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Syncno API running on http://localhost:${PORT}`);
});
