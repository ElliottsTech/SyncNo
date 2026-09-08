/**
 * QBO Purchase Order attachment bulk sync — Server-Sent Events endpoint.
 *
 * Streams progress as the backend walks every SyncNo purchase order, matches it
 * to its QuickBooks Online counterpart by PO number, and downloads file
 * attachments to data/attachments/po-<number>/. Decoupled from the Syncro sync
 * engine (sync.js) — this calls QuickBooks, not SyncroMSP, so it's a standalone
 * SSE stream with its own event shape.
 *
 * Events (JSON, one per `data:` line):
 *   { status:'started', total }
 *   { status:'progress', current, total, currentRecordName, result? }
 *   { status:'done', total, matched, downloaded, skipped, errors }
 *   { status:'error', error }
 */

import { Router } from 'express';
import { isQboConnected } from '../lib/qboClient.js';
import { syncAllPoAttachments } from '../lib/qboClient.js';

const router = Router();

// Service key (Bearer SYNCNO_API_KEY) is admin-equivalent — same rule as sync.js.
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ') && auth.slice(7) === process.env.SYNCNO_API_KEY) {
    return next();
  }
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

/**
 * POST /api/qbo-attachments/sync?force=1
 * Opens an SSE stream and runs the bulk attachment sync. `force=1` re-syncs POs
 * already stamped; otherwise only POs without attachments_synced_at are touched.
 */
router.post('/sync', requireAdmin, (req, res) => {
  if (!isQboConnected()) {
    return res.status(400).json({ error: 'QuickBooks Online is not connected. Save app credentials and click Connect in Config → QuickBooks Online.' });
  }
  const force = req.query.force === '1' || req.query.force === 'true';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering (nginx)
  });
  res.flushHeaders?.();

  const send = (obj) => {
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch (_) { /* client gone */ }
  };

  const ac = new AbortController();
  const onClose = () => { try { ac.abort(); } catch (_) {} };
  req.on('close', onClose);
  req.on('aborted', onClose);

  send({ status: 'accepted', force });

  (async () => {
    try {
      await syncAllPoAttachments({
        force,
        signal: ac.signal,
        onProgress: (ev) => send(ev),
      });
      // syncAllPoAttachments emits its own 'done' via onProgress, but send a
      // terminal marker the frontend can key on for "stream ended cleanly".
      send({ status: 'complete' });
    } catch (e) {
      send({ status: 'error', error: e.message || String(e) });
    } finally {
      try { res.end(); } catch (_) {}
    }
  })();
});

export default router;
