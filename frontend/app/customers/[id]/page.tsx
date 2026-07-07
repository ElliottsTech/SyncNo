'use client';
import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import Badge from '../../../components/Badge';
import DataTable from '../../../components/DataTable';
import RawJsonView from '../../../components/RawJsonView';
import { usePageTitle } from '../../../lib/usePageTitle';
import { fetchJson, UnauthorizedError } from '../../../lib/fetch';

const API = '/api';

type Tab = 'overview' | 'tickets' | 'assets' | 'policies' | 'invoices' | 'estimates' | 'payments' | 'contacts' | 'schedules';

export default function CustomerDetail() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const VALID_TABS: Tab[] = ['overview', 'tickets', 'assets', 'policies', 'invoices', 'estimates', 'payments', 'contacts', 'schedules'];
  const initialTab = searchParams.get('tab') as Tab;
  const [customer, setCustomer] = useState<any>(null);
  const [tab, setTab] = useState<Tab>(VALID_TABS.includes(initialTab) ? initialTab : 'overview');

  const changeTab = (next: Tab) => {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const [tickets, setTickets] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [estimates, setEstimates] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [policies, setPolicies] = useState<{ folders: any[]; derived: any[]; totalFolders: number; totalAssets: number } | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Load all data in parallel on mount
  useEffect(() => {
    Promise.all([
      fetchJson(`${API}/customers/${id}`),
      fetchJson(`${API}/customers/${id}/tickets?limit=500`),
      fetchJson(`${API}/customers/${id}/assets`),
      fetchJson(`${API}/customers/${id}/invoices`),
      fetchJson(`${API}/customers/${id}/estimates`),
      fetchJson(`${API}/customers/${id}/payments`),
      fetchJson(`${API}/customers/${id}/contacts`),
      fetchJson(`${API}/customers/${id}/schedules`),
      fetchJson(`${API}/customers/${id}/policies`),
    ]).then(([cust, tkt, ast, inv, est, pay, con, sch, pol]) => {
      setCustomer(cust);
      setTickets(tkt.data || []);
      setAssets(Array.isArray(ast) ? ast : []);
      setInvoices(Array.isArray(inv) ? inv : []);
      setEstimates(Array.isArray(est) ? est : []);
      setPayments(Array.isArray(pay) ? pay : []);
      setContacts(Array.isArray(con) ? con : []);
      setSchedules(Array.isArray(sch) ? sch : []);
      setPolicies(pol);
      setLoaded(true);
    }).catch(e => {
      // UnauthorizedError already triggered a redirect; otherwise keep empty.
      if (!(e instanceof UnauthorizedError)) setLoaded(true);
    });
  }, [id]);

  usePageTitle(customer ? `${customer.business_name || customer.fullname || 'Customer'} — Syncno` : null);

  if (!customer) return <p className="text-gray-500">Loading...</p>;

  const tabLabel = (key: Tab, label: string, count: number) => {
    return `${label} (${loaded ? count : '...'})`;
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'tickets', label: tabLabel('tickets', 'Tickets', tickets.length) },
    { key: 'assets', label: tabLabel('assets', 'Assets', assets.length) },
    { key: 'policies', label: tabLabel('policies', 'Policies', (policies?.folders.length || 0) + (policies?.derived.length || 0)) },
    { key: 'invoices', label: tabLabel('invoices', 'Invoices', invoices.length) },
    { key: 'estimates', label: tabLabel('estimates', 'Estimates', estimates.length) },
    { key: 'payments', label: tabLabel('payments', 'Payments', payments.length) },
    { key: 'schedules', label: tabLabel('schedules', 'Schedules', schedules.length) },
    { key: 'contacts', label: tabLabel('contacts', 'Contacts', contacts.length) },
  ];

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <Link href="/customers" className="text-blue-600 hover:underline text-sm">← Back to Customers</Link>
        <div className="flex items-center gap-3 mt-2">
          <input
            type="checkbox"
            checked={!!customer.synced}
            onChange={async (e) => {
              try {
                await fetchJson(`${API}/sync/synced`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ table: 'customers', id: customer.id, synced: !customer.synced }),
                });
                const res = await fetchJson(`${API}/customers/${id}`);
                setCustomer(res);
              } catch (err) { if (!(err instanceof UnauthorizedError)) { /* keep current state */ } }
            }}
            className="w-5 h-5 cursor-pointer"
            title={customer.synced ? 'Synced — click to mark for re-sync' : 'Not fully synced'}
          />
          <h1 className="text-2xl font-bold">{customer.business_name || customer.fullname}</h1>
        </div>
        <p className="text-gray-500">{customer.email}</p>
      </div>

      <div className="flex gap-1 border-b mb-4">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => changeTab(t.key)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === t.key ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white p-4 rounded border">
            <h3 className="font-semibold mb-2">Contact Info</h3>
            <p><span className="text-gray-500">Email:</span> {customer.email}</p>
            <p><span className="text-gray-500">Phone:</span> {customer.phone}</p>
            <p><span className="text-gray-500">Mobile:</span> {customer.mobile}</p>
          </div>
          <div className="bg-white p-4 rounded border">
            <h3 className="font-semibold mb-2">Address</h3>
            <p>{customer.address}</p>
            <p>{customer.city}, {customer.state} {customer.zip}</p>
          </div>
          {customer.notes && (
            <div className="bg-white p-4 rounded border col-span-2">
              <h3 className="font-semibold mb-2">Notes</h3>
              <p className="text-gray-700 whitespace-pre-wrap">{customer.notes}</p>
            </div>
          )}
        </div>
      )}

      {tab === 'tickets' && (
        <DataTable
          columns={[
            { key: 'number', label: '#', render: (v, r) => <Link href={`/tickets/${r.id}`} className="text-blue-600 hover:underline">{v}</Link> },
            { key: 'subject', label: 'Subject' },
            { key: 'status', label: 'Status', render: v => <Badge variant={v === 'New' ? 'info' : v === 'Resolved' ? 'success' : 'default'}>{v}</Badge> },
            { key: 'priority', label: 'Priority' },
            { key: 'created_at', label: 'Created', render: v => v ? new Date(v).toLocaleDateString() : '' },
          ]}
          data={tickets}
          emptyMessage="No tickets"
        />
      )}

      {tab === 'assets' && (
        <DataTable
          columns={[
            {
              key: 'name', label: 'Name',
              render: (v, r) => <Link href={`/assets/${r.id}`} className="text-blue-600 hover:underline">{v}</Link>,
            },
            { key: 'asset_type', label: 'Type' },
            { key: 'asset_serial', label: 'Serial' },
            {
              key: 'policy_folder_id', label: 'Policy',
              render: (v) => v
                ? <Link href={`/policy_folders/${v}`} className="text-blue-600 hover:underline font-mono text-xs">#{v}</Link>
                : <span className="text-gray-400">—</span>,
            },
            { key: 'created_at', label: 'Created', render: v => v ? new Date(v).toLocaleDateString() : '' },
          ]}
          data={assets}
          emptyMessage="No assets"
        />
      )}

      {tab === 'policies' && <PoliciesTab policies={policies} loaded={loaded} />}

      {tab === 'invoices' && (
        <DataTable
          columns={[
            { key: 'number', label: '#', render: (v, r) => <Link href={`/invoices/${r.id}`} className="text-blue-600 hover:underline">{v}</Link> },
            { key: 'date', label: 'Date', render: v => v ? new Date(v).toLocaleDateString() : '' },
            { key: 'due_date', label: 'Due', render: v => v ? new Date(v).toLocaleDateString() : '' },
            { key: 'total', label: 'Total' },
            { key: 'is_paid', label: 'Paid', render: v => v ? <Badge variant="success">Yes</Badge> : <Badge variant="warning">No</Badge> },
          ]}
          data={invoices}
          emptyMessage="No invoices"
        />
      )}

      {tab === 'estimates' && (
        <DataTable
          columns={[
            { key: 'number', label: '#', render: (v, r) => <Link href={`/estimates/${r.id}`} className="text-blue-600 hover:underline">{v}</Link> },
            { key: 'status', label: 'Status', render: v => <Badge>{v}</Badge> },
            { key: 'date', label: 'Date', render: v => v ? new Date(v).toLocaleDateString() : '' },
            { key: 'total', label: 'Total' },
          ]}
          data={estimates}
          emptyMessage="No estimates"
        />
      )}

      {tab === 'payments' && (
        <DataTable
          columns={[
            { key: 'ref_num', label: 'Ref', render: (v, r) => <Link href={`/payments/${r.id}`} className="text-blue-600 hover:underline font-mono">{v || r.id}</Link> },
            { key: 'applied_at', label: 'Applied', render: v => v ? new Date(v).toLocaleDateString() : '' },
            { key: 'payment_amount', label: 'Amount', render: v => v ? `$${parseFloat(v).toFixed(2)}` : '' },
            { key: 'payment_method', label: 'Method' },
            {
              key: 'invoice_ids', label: 'Invoices',
              render: (v) => Array.isArray(v) && v.length > 0
                ? <span className="flex flex-wrap gap-2">{v.map((id: any) => <Link key={id} href={`/invoices/${id}`} className="text-blue-600 hover:underline font-mono text-xs">#{id}</Link>)}</span>
                : <span className="text-gray-400">—</span>,
            },
          ]}
          data={payments}
          emptyMessage="No payments"
        />
      )}

      {tab === 'contacts' && (
        <DataTable
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'email', label: 'Email', render: (v) => v ? <a href={`mailto:${v}`} className="text-blue-600 hover:underline">{v}</a> : '' },
            { key: 'phone', label: 'Phone', render: (v) => v ? <a href={`tel:${v.replace(/[^+\d]/g, '')}`} className="text-blue-600 hover:underline">{v}</a> : '' },
            { key: 'mobile', label: 'Mobile', render: (v) => v ? <a href={`tel:${v.replace(/[^+\d]/g, '')}`} className="text-blue-600 hover:underline">{v}</a> : '' },
          ]}
          data={contacts}
          emptyMessage="No contacts"
        />
      )}

      {tab === 'schedules' && (
        <DataTable
          columns={[
            {
              key: 'name', label: 'Name',
              render: (v, r) => <Link href={`/schedules/${r.id}`} className="text-blue-600 hover:underline">{v || '(no name)'}</Link>,
            },
            { key: 'status', label: 'Status', render: v => v ? <Badge>{v}</Badge> : '' },
            { key: 'amount', label: 'Amount', render: v => v ? `$${parseFloat(v).toFixed(2)}` : '—' },
            { key: 'frequency', label: 'Frequency' },
            { key: 'next_date', label: 'Next', render: v => v ? new Date(v).toLocaleDateString() : '' },
            { key: 'end_date', label: 'Ends', render: v => v ? new Date(v).toLocaleDateString() : '' },
          ]}
          data={schedules}
          emptyMessage="No schedules"
        />
      )}

      <RawJsonView rawJson={customer.raw_json} label="Customer Raw JSON" />
    </div>
  );
}

// Recursive folder node — handles real policy_folders (with children, effective_policy)
// and derived groups (asset.policy_folder_id clusters with no folder metadata).
function FolderNode({ folder, depth = 0 }: { folder: any; depth?: number }) {
  const [open, setOpen] = useState(true);
  const [childOpen, setChildOpen] = useState<Record<number, boolean>>({});
  const name = folder.name?.trim() || (folder.derived ? `Policy Folder #${folder.id}` : `(unnamed #${folder.id})`);
  const hasChildren = folder.children && folder.children.length > 0;
  const assetCount = folder.assets?.length || 0;
  const toggleChild = (cid: number) => setChildOpen(prev => ({ ...prev, [cid]: !prev[cid] }));

  return (
    <div className={depth > 0 ? 'ml-4 border-l border-gray-200 pl-3' : ''} style={{ marginLeft: depth * 16 }}>
      <div className="flex items-center gap-2 py-1.5 group">
        {hasChildren ? (
          <button
            onClick={() => setOpen(o => !o)}
            className="text-xs text-gray-500 hover:text-gray-700 w-4"
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? '▼' : '▶'}
          </button>
        ) : (
          <span className="w-4 text-gray-300 text-xs">▾</span>
        )}
        <span className="text-gray-400" aria-hidden>📁</span>
        <Link
          href={`/policy_folders/${folder.id}`}
          className="text-sm font-medium text-gray-800 hover:text-blue-600 hover:underline"
        >
          {name}
        </Link>
        {folder.derived && (
          <span className="text-[10px] uppercase tracking-wide text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded" title="Folder metadata not yet synced — derived from asset links">
            derived
          </span>
        )}
        {folder.effective_policy_id && (
          <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-mono" title="Effective policy ID">
            effective #{folder.effective_policy_id}
          </span>
        )}
        {folder.partial_policy_id && (
          <span className="text-[10px] text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded font-mono" title="Partial policy ID">
            partial #{folder.partial_policy_id}
          </span>
        )}
        <span className="text-xs text-gray-400">
          {assetCount > 0 && `${assetCount} asset${assetCount === 1 ? '' : 's'}`}
          {hasChildren && folder.children.length > 0 && (assetCount > 0 ? ' · ' : '') + `${folder.children.length} sub`}
        </span>
        {folder.description && (
          <span className="text-xs text-gray-400 truncate hidden md:inline-block">— {folder.description}</span>
        )}
      </div>

      {open && (
        <div>
          {/* Linked assets under this folder */}
          {assetCount > 0 && (
            <div className="ml-8 mb-1">
              {folder.assets.map((a: any) => (
                <div key={a.id} className="flex items-center gap-2 py-1 text-sm">
                  <span className="text-gray-300" aria-hidden>⋅</span>
                  <span className="text-gray-400" aria-hidden>📦</span>
                  <Link href={`/assets/${a.id}`} className="text-blue-600 hover:underline">{a.name || '(unnamed)'}</Link>
                  {a.asset_type && <span className="text-xs text-gray-500">{a.asset_type}</span>}
                  {a.asset_serial && <span className="text-xs text-gray-400 font-mono">{a.asset_serial}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Recurse into children */}
          {hasChildren && folder.children.map((c: any) => (
            <FolderNode key={c.id} folder={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function PoliciesTab({ policies, loaded }: { policies: { folders: any[]; derived: any[]; totalFolders: number; totalAssets: number } | null; loaded: boolean }) {
  if (!loaded) return <p className="text-gray-500">Loading policies...</p>;
  if (!policies) return <p className="text-gray-500 text-sm">No policy data.</p>;

  const realFolders = policies.folders || [];
  const derived = policies.derived || [];
  const total = realFolders.length + derived.length;
  const derivedAssetCount = derived.reduce((sum, f) => sum + (f.assets?.length || 0), 0);

  if (total === 0) {
    return (
      <div className="bg-white border rounded p-8 text-center">
        <div className="text-4xl mb-2 opacity-40">🗂️</div>
        <p className="text-gray-700 font-medium">No policy folders</p>
        <p className="text-sm text-gray-500 mt-1">
          This customer has {policies.totalAssets || 0} assets, none linked to a policy folder.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-100 rounded p-3 text-sm text-blue-800">
        <span className="font-medium">{total}</span> policy folder{total === 1 ? '' : 's'}
        {realFolders.length > 0 && <span className="text-blue-600"> · {realFolders.length} synced</span>}
        {derived.length > 0 && (
          <span className="text-amber-700"> · {derived.length} derived from {derivedAssetCount} linked asset{derivedAssetCount === 1 ? '' : 's'}</span>
        )}
        {derived.length > 0 && (
          <span className="block text-xs text-amber-600 mt-1">
            Derived folders appear here until <code className="bg-amber-100 px-1 rounded">policy_folders</code> sync completes.
          </span>
        )}
      </div>

      <div className="bg-white border rounded p-4">
        {realFolders.map((f: any) => (
          <FolderNode key={f.id} folder={f} />
        ))}
        {derived.map((f: any) => (
          <FolderNode key={`d-${f.id}`} folder={f} />
        ))}
      </div>
    </div>
  );
}
