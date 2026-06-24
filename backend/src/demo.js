export function isDemo() {
  return process.env.DEMO === 'yes' || process.env.DEMO === 'true';
}

export const DEMO_USER = {
  id: 'demo-user',
  email: 'demo@syncno.local',
  name: 'Demo Admin',
  role: 'admin',
};

export function demoNoop(_req, res) {
  return res.json({ ok: true, demo: true });
}
