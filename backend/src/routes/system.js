import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const router = Router();

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = process.env.REPO_DIR || resolve(__dirname, '..', '..', '..');
const VERSION_FILE = join(REPO_DIR, 'VERSION');
const GITHUB_REPO = process.env.GITHUB_REPO || 'ElliottsTech/SyncNo';
const CACHE_TTL_MS = 30_000;

let cache = null;

function parseSemver(tag) {
  if (!tag) return null;
  const m = String(tag).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

async function readCurrentVersion() {
  try {
    const v = (await readFile(VERSION_FILE, 'utf8')).trim();
    return v || null;
  } catch (_) {
    return null;
  }
}

async function readLatestVersion() {
  try {
    const r = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/tags`,
      { headers: { 'User-Agent': 'syncno-version-check' }, signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return null;
    const tags = await r.json();
    if (!Array.isArray(tags) || tags.length === 0) return null;
    // Tags may be ordered by commit date, not semver. Pick highest semver.
    let best = null;
    for (const t of tags) {
      const name = t?.name;
      if (!name || !parseSemver(name)) continue;
      if (best === null || compareSemver(name, best) > 0) best = name.replace(/^v/, '');
    }
    return best;
  } catch (_) {
    return null;
  }
}

async function computeVersion() {
  const [current, latest] = await Promise.all([readCurrentVersion(), readLatestVersion()]);
  let updateAvailable = null;
  if (current && latest) {
    const cmp = compareSemver(current, latest);
    updateAvailable = cmp === null ? null : cmp < 0;
  }
  const installDir = process.env.HOST_INSTALL_DIR || '/opt/syncno';
  return {
    current,
    latest,
    updateAvailable,
    installDir,
    updateCommand: `sudo ${installDir}/scripts/update.sh`,
  };
}

// GET /api/system/version - current vs latest tag for sidebar display.
// Pass ?refresh=true to bypass cache (e.g. after running update.sh).
// Any authenticated user may read; admin-gating happens client-side for the update button.
router.get('/version', async (req, res) => {
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
