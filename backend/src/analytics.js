import { getDb } from './db/database.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ANALYTICS_URL = 'https://license.syncno.net/api/ping';
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1h

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion() {
  try {
    return readFileSync(join(__dirname, '..', '..', 'VERSION'), 'utf8').trim();
  } catch (_) {
    return null;
  }
}

function getSetting(key) {
  const envKey = key.toUpperCase();
  if (process.env[envKey]) return process.env[envKey];
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

function getOrCreateInstallId() {
  let id = getSetting('analytics_install_id');
  if (!id) {
    id = crypto.randomUUID();
    setSetting('analytics_install_id', id);
  }
  return id;
}

function today() {
  return new Date().toISOString().split('T')[0];
}

async function sendPing() {
  const installId = getOrCreateInstallId();
  const subdomain = getSetting('syncro_subdomain');
  const params = new URLSearchParams({
    install_id: installId,
    subdomain: subdomain || '',
    version: getVersion() || '',
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    source: 'backend',
  });
  try {
    await fetch(`${ANALYTICS_URL}?${params.toString()}`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'text/plain' },
    });
    setSetting('analytics_last_ping', new Date().toISOString());
  } catch (_) {}
}

function shouldPing() {
  const last = getSetting('analytics_last_ping_date');
  const now = today();
  if (last !== now) {
    setSetting('analytics_last_ping_date', now);
    return true;
  }
  return false;
}

function tick() {
  if (shouldPing()) sendPing();
}

export function startAnalytics() {
  // Fire shortly after boot so a fresh install reports immediately.
  setTimeout(tick, 30 * 1000);
  setInterval(tick, CHECK_INTERVAL_MS);
}
