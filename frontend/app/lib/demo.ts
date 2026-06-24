export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO === 'yes';

export const DEMO_USER = {
  id: 'demo-user',
  email: 'demo@syncno.local',
  name: 'Demo Admin',
  role: 'admin' as const,
};
