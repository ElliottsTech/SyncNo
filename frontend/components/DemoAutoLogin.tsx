'use client';

import { useSession, signIn } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { IS_DEMO } from '../app/lib/demo';

// In demo mode, no real sign-on exists. If a visitor lands without a session
// cookie, fire the demo credentials provider once. The provider auto-authorizes
// (see auth.ts) and NextAuth sets a JWT cookie — subsequent pages see an
// authenticated admin session.
export default function DemoAutoLogin() {
  const { status } = useSession();
  const pathname = usePathname();

  useEffect(() => {
    if (!IS_DEMO) return;
    if (status !== 'unauthenticated') return;
    // Skip on auth routes — NextAuth owns them.
    if (pathname?.startsWith('/api/auth')) return;
    signIn('demo', { callbackUrl: pathname || '/' });
  }, [IS_DEMO, status, pathname]);

  return null;
}
