'use client';

import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';

export default function LayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuth = pathname?.startsWith('/login') || pathname?.startsWith('/api/auth');

  if (isAuth) {
    return <>{children}</>;
  }

  return (
    <div className="flex">
      <Sidebar />
      <main className="flex-1 p-6 bg-gray-50 min-h-screen">
        {children}
      </main>
    </div>
  );
}
