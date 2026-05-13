import { createReadStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import csv from 'csv-parser';
import { initDb, getDb, closeDb } from './database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_DIR = '/root/SyncNo/SyncNo';

const FILES = {
  customers: '03072026_customers.csv',
  contacts: '03072026_contacts.csv',
  tickets: '03072026_tickets.csv',
  assets: '03072026_assets.csv',
  invoices: '03072026_invoices.csv',
  estimates: '03072026_estimates.csv',
  payments: '03072026_payments.csv',
  vendors: '03072026_vendors.csv',
  purchase_orders: '03072026_purchase_orders.csv',
  products: '03072026_products.csv',
};

function parseBool(val) {
  if (val === 'TRUE' || val === 'true' || val === '1') return 1;
  if (val === 'FALSE' || val === 'false' || val === '0') return 0;
  return val;
}

async function importTable(tableName, filename) {
  return new Promise((resolve, reject) => {
    const db = getDb();
    const filepath = join(CSV_DIR, filename);
    const results = [];
    let rowCount = 0;
    let batchCount = 0;

    const stream = createReadStream(filepath)
      .pipe(csv())
      .on('data', (row) => {
        const keys = Object.keys(row);
        const processed = {};
        for (const key of keys) {
          processed[key] = parseBool(row[key]);
        }
        results.push(processed);
        rowCount++;

        if (results.length >= 500) {
          stream.pause();
          insertBatch(db, tableName, results.splice(0, results.length))
            .then(() => {
              batchCount++;
              stream.resume();
            })
            .catch(reject);
        }
      })
      .on('end', () => {
        if (results.length > 0) {
          insertBatch(db, tableName, results).then(() => {
            console.log(`✓ ${tableName}: ${rowCount} rows`);
            resolve(rowCount);
          }).catch(reject);
        } else {
          console.log(`✓ ${tableName}: ${rowCount} rows`);
          resolve(rowCount);
        }
      })
      .on('error', reject);
  });
}

async function insertBatch(db, tableName, rows) {
  if (rows.length === 0) return;

  const cols = Object.keys(rows[0]);
  const placeholders = rows.map(() => '(' + cols.map(() => '?').join(',') + ')').join(',');
  const sql = `INSERT INTO ${tableName} (${cols.join(',')}) VALUES ${placeholders}`;

  const values = rows.flatMap(r => cols.map(c => {
    const val = r[c];
    if (val === undefined || val === null || val === '') return null;
    return typeof val === 'object' ? JSON.stringify(val) : String(val);
  }));

  const stmt = db.prepare(sql);
  stmt.run(...values);
}

async function main() {
  console.log('Initializing database...');
  initDb();
  const db = getDb();

  // Add any missing columns (for when schema evolves)
  try {
    db.exec(`ALTER TABLE customers ADD COLUMN firstname TEXT`);
    db.exec(`ALTER TABLE customers ADD COLUMN lastname TEXT`);
  } catch (e) {
    // columns may already exist
  }

  // Drop existing data
  const tables = ['payments', 'purchase_orders', 'products', 'vendors', 'estimates', 'invoices', 'assets', 'tickets', 'contacts', 'customers'];
  for (const t of tables) {
    db.exec(`DELETE FROM ${t}`);
  }
  console.log('Cleared existing data.\n');

  // Import each table
  for (const [tableName, filename] of Object.entries(FILES)) {
    try {
      await importTable(tableName, filename);
    } catch (err) {
      console.error(`✗ Error importing ${tableName}:`, err.message);
    }
  }

  console.log('\nDone!');
  closeDb();
}

main().catch(console.error);
