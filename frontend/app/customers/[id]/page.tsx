'use client';
import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import Badge from '../../../components/Badge';
import DataTable from '../../../components/DataTable';
import RawJsonView from '../../../components/RawJsonView';
import { usePageTitle } from '../../../lib/usePageTitle';

const API = '/api';

type Tab = 'overview' | 'tickets' | 'assets' | 'invoices' | 'estimates' | 'payments' | 'contacts' | 'schedules';

export default function CustomerDetail() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const VALID_TABS: Tab[] = ['overview', 'tickets', 'assets', 'invoices', 'estimates', 'payments', 'contacts', 'schedules'];
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
  const [loaded, setLoaded] = useState(false);

  // Load all data in parallel on mount
  useEffect(() => {
    Promise.all([
      fetch(`${API}/customers/${id}`).then(r => r.json()),
      fetch(`${API}/customers/${id}/tickets?limit=500`).then(r => r.json()),
      fetch(`${API}/customers/${id}/assets`).then(r => r.json()),
      fetch(`${API}/customers/${id}/invoices`).then(r => r.json()),
      fetch(`${API}/customers/${id}/estimates`).then(r => r.json()),
      fetch(`${API}/customers/${id}/payments`).then(r => r.json()),
      fetch(`${API}/customers/${id}/contacts`).then(r => r.json()),
      fetch(`${API}/customers/${id}/schedules`).then(r => r.json()),
    ]).then(([cust, tkt, ast, inv, est, pay, con, sch]) => {
      setCustomer(cust);
      setTickets(tkt.data || []);
      setAssets(ast);
      setInvoices(inv);
      setEstimates(est);
      setPayments(pay);
      setContacts(con);
      setSchedules(sch);
      setLoaded(true);
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
              await fetch(`${API}/sync/synced`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ table: 'customers', id: customer.id, synced: !customer.synced }),
              });
              const res = await fetch(`${API}/customers/${id}`).then(r => r.json());
              setCustomer(res);
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
            { key: 'created_at', label: 'Created', render: v => v ? new Date(v).toLocaleDateString() : '' },
          ]}
          data={assets}
          emptyMessage="No assets"
        />
      )}

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
