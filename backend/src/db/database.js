import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_PATH = join(__dirname, '../../data/syncro.db');

let db = null;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  return db;
}

export function initDb() {
  const db = getDb();
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);

  // Add new columns to logs table if they don't exist
  const alterLogs = [
    'ALTER TABLE logs ADD COLUMN ip_address TEXT',
    'ALTER TABLE logs ADD COLUMN user_agent TEXT',
    'ALTER TABLE logs ADD COLUMN browser TEXT',
    'ALTER TABLE logs ADD COLUMN os TEXT',
    'ALTER TABLE logs ADD COLUMN device_type TEXT',
    'ALTER TABLE logs ADD COLUMN country TEXT',
  ];

  for (const alt of alterLogs) {
    try { db.exec(alt); } catch (e) { /* column may already exist */ }
  }

  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
