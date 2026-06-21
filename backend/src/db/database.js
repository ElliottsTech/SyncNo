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

  // Migrate sync_events table: add missing columns if they don't exist
  const alterSyncEvents = [
    'ALTER TABLE sync_events ADD COLUMN current_record_id TEXT',
    'ALTER TABLE sync_events ADD COLUMN current_record_name TEXT',
  ];
  for (const alt of alterSyncEvents) {
    try { db.exec(alt); } catch (e) { /* column may already exist */ }
  }

  // Migrate leads table: expand to capture full API shape.
  const alterLeads = [
    'ALTER TABLE leads ADD COLUMN first_name TEXT',
    'ALTER TABLE leads ADD COLUMN last_name TEXT',
    'ALTER TABLE leads ADD COLUMN address TEXT',
    'ALTER TABLE leads ADD COLUMN city TEXT',
    'ALTER TABLE leads ADD COLUMN state TEXT',
    'ALTER TABLE leads ADD COLUMN zip TEXT',
    'ALTER TABLE leads ADD COLUMN contact_id INTEGER',
    'ALTER TABLE leads ADD COLUMN ticket_id INTEGER',
    'ALTER TABLE leads ADD COLUMN ticket_subject TEXT',
    'ALTER TABLE leads ADD COLUMN ticket_description TEXT',
    'ALTER TABLE leads ADD COLUMN ticket_problem_type TEXT',
    'ALTER TABLE leads ADD COLUMN mailbox_id INTEGER',
    'ALTER TABLE leads ADD COLUMN mailbox_name TEXT',
    'ALTER TABLE leads ADD COLUMN business_then_name TEXT',
    'ALTER TABLE leads ADD COLUMN has_attachments INTEGER DEFAULT 0',
    'ALTER TABLE leads ADD COLUMN message_read INTEGER DEFAULT 0',
    'ALTER TABLE leads ADD COLUMN user_id TEXT',
    'ALTER TABLE leads ADD COLUMN location_id TEXT',
  ];
  for (const alt of alterLeads) {
    try { db.exec(alt); } catch (e) { /* column may already exist */ }
  }

  // Migrate tickets table: attachment denormalization for fast list rendering.
  const alterTickets = [
    'ALTER TABLE tickets ADD COLUMN attachments_count INTEGER DEFAULT 0',
    'ALTER TABLE tickets ADD COLUMN attachments_synced_at TEXT',
  ];
  for (const alt of alterTickets) {
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
