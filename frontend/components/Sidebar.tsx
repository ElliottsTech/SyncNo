'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';

const navItems = [
  { href: '/customers', label: 'Customers' },
  { href: '/tickets', label: 'Tickets' },
  { href: '/assets', label: 'Assets' },
  { href: '/invoices', label: 'Invoices' },
  { href: '/purchase-orders', label: 'Purchase Orders' },
  { href: '/vendors', label: 'Vendors' },
  { href: '/estimates', label: 'Estimates' },
  { href: '/search', label: 'Search' },
  { href: '/users', label: 'Users' },
  { href: '/logs', label: 'Logs' },
  { href: '/syncro', label: 'Settings' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session, status } = useSession();

  return (
    <aside className="w-56 bg-gray-900 text-white h-screen p-4 flex flex-col sticky top-0 overflow-y-auto">
      <img src="/SyncNo.png" alt="SyncNo" className="w-[75%] mx-auto mb-6 object-contain" />
      <nav className="flex-1">
        {navItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`block px-3 py-2 rounded mb-1 text-sm ${
              pathname.startsWith(item.href)
                ? 'bg-blue-600 text-white'
                : 'text-gray-300 hover:bg-gray-800'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="mt-4 pt-4 border-t border-gray-700">
        {status === 'loading' ? (
          <p className="text-xs text-gray-500 px-3 py-2">Loading...</p>
        ) : session ? (
          <>
            <p className="text-xs text-gray-400 px-3 mb-2 truncate">{session.user?.email}</p>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded"
            >
              Sign out
            </button>
          </>
        ) : (
          <Link
            href="/login"
            className="block px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded"
          >
            Sign in
          </Link>
        )}
      </div>
    </aside>
  );
}
