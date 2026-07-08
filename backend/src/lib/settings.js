/**
 * Shared settings helpers — read/write the `settings` table, mask secrets, and
 * rewrite the `.env` file in place.
 *
 * Extracted verbatim from `routes/sync.js` so other admin routes (notably
 * `mcp_settings.js`) can persist credentials the same way the Syncro/Azure
 * save handlers do: write the settings DB row, hot-patch `process.env`, and
 * update `.env` so the value survives a restart / is picked up by docker
 * compose on the next deploy.
 */

import fs from 'fs';
import { getDb } from '../db/database.js';

/**
 * Read a setting: env var (KEY uppercased) wins over the `settings` table row.
 * @param {string} key
 * @returns {string | null}
 */
export function getSetting(key) {
  const envKey = key.toUpperCase();
  const envVal = process.env[envKey];
  if (envVal) return envVal;
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

/**
 * Write a setting to the `settings` table (INSERT OR REPLACE).
 * Does NOT touch process.env or .env — callers do that explicitly when needed.
 * @param {string} key
 * @param {string} value
 */
export function setSetting(key, value) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

/**
 * Mask a secret for display: first 4 + bullets + last 4 (or all bullets if short).
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function mask(value) {
  if (!value) return null;
  const len = value.length;
  if (len <= 8) return '•'.repeat(len);
  return value.slice(0, 4) + '•'.repeat(Math.min(len - 8, 20)) + value.slice(-4);
}

/**
 * Rewrite `envPath` so each key in `updates` reflects its new value, appending
 * any keys that weren't already present. `null` values leave the existing line
 * untouched (so callers can pass masked placeholders through unchanged).
 *
 * @param {string} envPath absolute path to an env file
 * @param {Record<string, string | null>} updates
 */
export function updateEnvFile(envPath, updates) {
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }
  const lines = content.split('\n');
  const seen = new Set();
  const updated = lines.map(line => {
    for (const [key, val] of Object.entries(updates)) {
      const prefix = `${key}=`;
      if (line.startsWith(prefix)) {
        seen.add(key);
        return val == null ? line : `${prefix}${val}`;
      }
    }
    return line;
  });
  for (const [key, val] of Object.entries(updates)) {
    if (!seen.has(key) && val != null) updated.push(`${key}=${val}`);
  }
  fs.writeFileSync(envPath, updated.join('\n').replace(/\n+$/, '\n') + '\n');
}
