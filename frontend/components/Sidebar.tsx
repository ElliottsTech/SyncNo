'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useMemo, useEffect, useState } from 'react';

const ADMIN_ONLY = ['/users', '/logs', '/syncro', '/settings'];

interface NavItem {
  href: string;
  label: string;
  entityKey?: string;
  /** Label for the "all" link inside an expandable parent. Defaults to `All {label}`. */
  allLabel?: string;
  children?: NavItem[];
}

const navItems: NavItem[] = [
  { href: '/customers', label: 'Customers', entityKey: 'customers' },
  { href: '/tickets', label: 'Tickets', entityKey: 'tickets' },
  {
    href: '/assets', label: 'Assets', entityKey: 'assets', children: [
      { href: '/policy_folders', label: 'Policies', entityKey: 'policy_folders' },
    ],
  },
  { href: '/appointments', label: 'Appointments', entityKey: 'appointments' },
  {
    href: '/invoices', label: 'Invoices', entityKey: 'invoices', children: [
      { href: '/payments', label: 'Payments', entityKey: 'payments' },
      { href: '/schedules', label: 'Schedules', entityKey: 'schedules' },
    ],
  },
  { href: '/estimates', label: 'Estimates', entityKey: 'estimates' },
  { href: '/contracts', label: 'Contracts', entityKey: 'contracts' },
  { href: '/leads', label: 'Leads', entityKey: 'leads' },
  { href: '/wiki_pages', label: 'Wiki', entityKey: 'wiki_pages' },
  { href: '/purchase-orders', label: 'Purchase Orders', entityKey: 'purchase_orders' },
  { href: '/products', label: 'Products', entityKey: 'products' },
  { href: '/vendors', label: 'Vendors', entityKey: 'vendors' },
  {
    href: '/users', label: 'Users', allLabel: 'SyncNo Users', children: [
      { href: '/syncro_users', label: 'Syncro Users', entityKey: 'syncro_users' },
      { href: '/portal_users', label: 'Portal Users', entityKey: 'portal_users' },
    ],
  },
  { href: '/logs', label: 'Logs' },
  {
    href: '/syncro', label: 'Settings', allLabel: 'Sync', children: [
      { href: '/settings/config', label: 'Config' },
      { href: '/settings/backup', label: 'Backup' },
      { href: '/settings/mcp', label: 'MCP' },
    ],
  },
];

// Entities hidden from sidebar (still syncable from Settings, just not in nav).
// appointment_types is accessed from Appointments page link.
// worksheet_results is shown as a section on ticket detail, not its own page.
const HIDDEN_ENTITIES = new Set(['appointment_types', 'worksheet_results']);

function filterItem(item: NavItem, enabled: Set<string>, isAdmin: boolean): NavItem | null {
  if (ADMIN_ONLY.includes(item.href) && !isAdmin) return null;
  if (item.entityKey && HIDDEN_ENTITIES.has(item.entityKey)) return null;
  if (item.entityKey && !enabled.has(item.entityKey)) return null;
  if (item.children) {
    const kids = item.children
      .map(c => filterItem(c, enabled, isAdmin))
      .filter((c): c is NavItem => c !== null);
    // Hide parent if no visible children AND parent itself is entity-disabled
    if (kids.length === 0 && item.entityKey && !enabled.has(item.entityKey)) return null;
    // Parent navigates to its own list page (e.g. /assets) — keep visible even with no children
    return { ...item, children: kids };
  }
  return item;
}

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const role = session?.user?.role;
  const isAdmin = role === 'admin';

  const [enabled, setEnabled] = useState<Set<string> | null>(null);
  const [version, setVersion] = useState<{
    current: string;
    latest: string | null;
    updateAvailable: boolean | null;
    installDir?: string;
    updateCommand?: string;
  } | null>(null);

  useEffect(() => {
    fetch('/api/sync/enabled')
      .then(r => r.json())
      .then(d => {
        if (d && Array.isArray(d.entities)) setEnabled(new Set(d.entities));
        else setEnabled(null);
      })
      .catch(() => setEnabled(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchVersion = () => {
      fetch('/api/system/version')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (!cancelled && d) setVersion(d); })
        .catch(() => {});
    };
    fetchVersion();
    const id = setInterval(fetchVersion, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const updateCommand = version?.updateCommand || 'sudo /opt/syncno/scripts/update.sh';

  const copyUpdateCommand = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(updateCommand).catch(() => {});
    } else {
      window.prompt('Run this via SSH:', updateCommand);
    }
  };

  const items = useMemo(() => {
    // While loading enablement: show all (matches existing behavior pre-feature).
    const enabledSet = enabled ?? new Set(navItems.flatMap(i => [i.entityKey, ...(i.children || []).map(c => c.entityKey)].filter(Boolean) as string[]));
    return navItems
      .map(i => filterItem(i, enabledSet, isAdmin))
      .filter((i): i is NavItem => i !== null);
  }, [enabled, isAdmin]);

  return (
    <aside className="w-56 bg-gray-900 text-white h-screen p-4 flex flex-col sticky top-0 overflow-y-auto">
      <img src="/SyncNo.png" alt="SyncNo" className="w-[75%] mx-auto mb-6 object-contain" />
      <Link
        href="/search"
        className={`flex items-center gap-2 px-3 py-2 rounded mb-2 text-sm ${
          pathname.startsWith('/search') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span>Search</span>
      </Link>
      <div className="border-b border-gray-700 mb-3" />
      <nav className="flex-1">
        {items.map(item => (
          <NavItemView key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>
      <div className="mt-4 pt-4 border-t border-gray-700">
        {version?.current && (
          <div className="px-3 py-2 mb-2">
            {isAdmin && version.updateAvailable ? (
              <>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-400">
                    v {version.current} → <span className="text-yellow-400 font-mono">{version.latest}</span>
                  </span>
                  <button
                    onClick={copyUpdateCommand}
                    title={`Click to copy: ${updateCommand}`}
                    className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-900/50 text-yellow-300 hover:bg-yellow-900 cursor-pointer"
                  >
                    Update
                  </button>
                </div>
                <p className="text-[10px] text-gray-500 mt-1 font-mono">SSH: {updateCommand}</p>
              </>
            ) : (
              <span className="text-gray-500 text-xs">v {version.current}</span>
            )}
          </div>
        )}
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

function NavItemView({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = pathname.startsWith(item.href);
  const childActive = item.children?.some(c => pathname.startsWith(c.href)) ?? false;
  const [open, setOpen] = useState(active || childActive);

  if (item.children && item.children.length > 0) {
    return (
      <div key={item.href} className="mb-1">
        <button
          onClick={() => setOpen(o => !o)}
          className={`w-full flex justify-between items-center px-3 py-2 rounded text-sm ${
            active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'
          }`}
        >
          <span>{item.label}</span>
          <span className="text-xs">{open ? '▼' : '▶'}</span>
        </button>
        {open && (
          <div className="ml-3 mt-1 border-l border-gray-700 pl-2">
            <Link
              href={item.href}
              className={`block px-3 py-1.5 rounded text-xs ${
                pathname === item.href ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800'
              }`}
            >
              {item.allLabel || `All ${item.label}`}
            </Link>
            {item.children.map(c => {
              const cActive = pathname.startsWith(c.href);
              return (
                <Link
                  key={c.href}
                  href={c.href}
                  className={`block px-3 py-1.5 rounded text-xs ${
                    cActive ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800'
                  }`}
                >
                  {c.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      className={`block px-3 py-2 rounded mb-1 text-sm ${
        active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'
      }`}
    >
      {item.label}
    </Link>
  );
}
