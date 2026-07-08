// Demo mode is active when either DEMO=yes (runtime, checked by the backend's
// demo.js) or NEXT_PUBLIC_DEMO_MODE=1 (build-time, set in the compose env).
export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO === 'yes' ||
  process.env.NEXT_PUBLIC_DEMO_MODE === '1' ||
  process.env.DEMO === 'yes';

export const DEMO_USER = {
  id: 'demo-user',
  email: 'demo@syncno.local',
  name: 'Demo Admin',
  role: 'admin' as const,
};
