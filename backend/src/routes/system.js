import { Router } from 'express';
import { execFile as cbExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const execFile = promisify(cbExecFile);

const router = Router();

const __dirname = dirname(fileURLToPath(import.meta.url));
// backend/src/routes/system.js → repo root
const REPO_DIR = process.env.REPO_DIR || resolve(__dirname, '..', '..', '..');
const DEPLOY_SHA_FILE = join(REPO_DIR, '.deploy-sha');
const GIT_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 30_000;

let cache = null;

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

async function readCurrentSha() {
  try {
    const { stdout } = await execFile(
      'git',
      ['-C', REPO_DIR, 'rev-parse', '--short', 'HEAD'],
      { timeout: GIT_TIMEOUT_MS }
    );
    const sha = stdout.trim();
    if (sha) return sha;
  } catch (_) {
    // git unavailable or not a checkout — fall through
  }
  try {
    const contents = await readFile(DEPLOY_SHA_FILE, 'utf8');
    const sha = contents.trim();
    if (sha) return sha;
  } catch (_) {}
  return null;
}

async function readLatestSha() {
  try {
    const { stdout } = await execFile(
      'git',
      ['-C', REPO_DIR, 'ls-remote', 'origin', 'refs/heads/main'],
      { timeout: GIT_TIMEOUT_MS }
    );
    const firstLine = stdout.trim().split('\n')[0];
    const fullSha = firstLine.split(/\s+/)[0];
    return fullSha ? fullSha.slice(0, 7) : null;
  } catch (_) {
    return null;
  }
}

async function computeVersion() {
  const [current, latest] = await Promise.all([readCurrentSha(), readLatestSha()]);
  return {
    current,
    latest,
    updateAvailable: current && latest ? current !== latest : null,
  };
}

// GET /api/system/version - current vs latest SHA for sidebar display.
// Pass ?refresh=true to bypass cache (e.g. after running update.sh).
router.get('/version', requireAdmin, async (req, res) => {
  if (req.query.refresh !== 'true' && cache && (Date.now() - cache.fetchedAt) < CACHE_TTL_MS) {
    return res.json(cache.data);
  }
  try {
    const data = await computeVersion();
    cache = { data, fetchedAt: Date.now() };
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Version check failed', detail: String(err.message || err) });
  }
});

export default router;
