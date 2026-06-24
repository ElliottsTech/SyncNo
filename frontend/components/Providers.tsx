'use client';

import { SessionProvider } from 'next-auth/react';
import DemoAutoLogin from './DemoAutoLogin';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <DemoAutoLogin />
      {children}
    </SessionProvider>
  );
}
