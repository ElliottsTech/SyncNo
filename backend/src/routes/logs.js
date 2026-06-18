import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// Parse user agent for browser info
function parseBrowser(ua) {
  if (!ua) return null;
  if (ua.includes(' Edg/')) return 'Edge';
  if (ua.includes(' Chrome/') && !ua.includes(' Chromium')) return 'Chrome';
  if (ua.includes(' Firefox/')) return 'Firefox';
  if (ua.includes(' Safari/') && !ua.includes(' Chrome')) return 'Safari';
  if (ua.includes(' MSIE') || ua.includes(' Trident/')) return 'Internet Explorer';
  return 'Other';
}

function parseOS(ua) {
  if (!ua) return null;
  if (ua.includes(' Mac OS')) return 'macOS';
  if (ua.includes(' Windows')) return 'Windows';
  if (ua.includes(' Linux')) return 'Linux';
  if (ua.includes(' Android')) return 'Android';
  if (ua.includes(' iOS') || ua.includes(' iPhone') || ua.includes(' iPad')) return 'iOS';
  return 'Other';
}

function parseDeviceType(ua) {
  if (!ua) return 'Desktop';
  if (ua.includes('Mobile') || ua.includes('Android')) return 'Mobile';
  if (ua.includes('Tablet') || ua.includes('iPad')) return 'Tablet';
  return 'Desktop';
}

// GET /api/logs - list logs (admin only)
router.get('/', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const db = getDb();
  const { page = 1, limit = 100, user_id, action } = req.query;
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];
  if (user_id) {
    conditions.push('l.user_id = ?');
    params.push(user_id);
  }
  if (action) {
    conditions.push('l.action LIKE ?');
    params.push(action + '%');
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM logs l ${where}`).get(...params);
  const logs = db.prepare(`
    SELECT l.*, u.name as user_name, u.email as user_email
    FROM logs l
    LEFT JOIN users u ON l.user_id = u.id
    ${where}
    ORDER BY l.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));

  const parsedLogs = logs.map(log => ({
    ...log,
    browser: log.browser || (log.user_agent ? parseBrowser(log.user_agent) : null),
    os: log.os || (log.user_agent ? parseOS(log.user_agent) : null),
    device_type: log.device_type || (log.user_agent ? parseDeviceType(log.user_agent) : 'Desktop'),
  }));

  res.json({
    data: parsedLogs,
    pagination: { page: Number(page), limit: Number(limit), total: countRow.total },
  });
});

// POST /api/logs - create log entry
router.post('/', (req, res) => {
  const db = getDb();
  const { user_id, action, details, ip_address, user_agent, browser, os, device_type, country } = req.body;
  if (!action) return res.status(400).json({ error: 'action required' });

  const result = db.prepare(`
    INSERT INTO logs (user_id, action, details, ip_address, user_agent, browser, os, device_type, country)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(user_id || null, action, details || null, ip_address || null, user_agent || null, browser || null, os || null, device_type || null, country || null);

  res.json({ id: result.lastInsertRowid });
});

export default router;
