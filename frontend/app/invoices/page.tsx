'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import Badge from '../../components/Badge';
import Pagination from '../../components/Pagination';
import { useListState } from '../../lib/useUrlState';
import { usePageTitle } from '../../lib/usePageTitle';

const API = '/api';

function fmtMoney(n?: number | string | null) {
  if (n == null || n === '') return '—';
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(v)) return '—';
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(s?: string | null) {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}
function relTime(s?: string | null) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  let str: string;
  if (abs < 86400000) str = `${Math.floor(abs / 3600000)}h`;
  else if (abs < 2592000000) str = `${Math.floor(abs / 86400000)}d`;
  else str = fmtDate(s);
  return diff < 0 ? `in ${str}` : `${str} ago`;
}
function statusVariant(s: string): 'success' | 'danger' | 'info' | 'warning' | 'default' {
  if (s === 'paid') return 'success';
  if (s === 'overdue') return 'danger';
  if (s === 'verified_paid' || s === 'tech_marked_paid') return 'info';
  if (s === 'unpaid') return 'warning';
  return 'default';
}
function statusLabel(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function InvoicesPage() {
  usePageTitle('Invoices — Syncno');
  const [invoices, setInvoices] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [listState, { setPage, setSort, setFilters }] = useListState({
    page: 1,
    sortCol: 'date',
    sortDir: 'desc',
    columnFilters: {},
  });

  const fetchInvoices = useCallback(() => {
    setLoading(true);
    const { page, sortCol, sortDir, columnFilters } = listState;
    const sort = sortCol && sortDir ? `&sortCol=${sortCol}&sortDir=${sortDir}` : '';
    const colFilters = Object.entries(columnFilters)
      .filter(([_, v]) => v)
      .map(([k, v]) => `&filter_${k}=${encodeURIComponent(v)}`)
      .join('');
    fetch(`${API}/invoices?page=${page}&limit=50${sort}${colFilters}`)
      .then(r => r.json())
      .then(d => {
        setInvoices(d.data);
        setPagination(d.pagination);
        setLoading(false);
      });
  }, [listState]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  const stats = useMemo(() => {
    const total = invoices.reduce((s, i) => s + (parseFloat(i.total) || 0), 0);
    const outstanding = invoices
      .filter(i => !['paid'].includes(i.payment_status))
      .reduce((s, i) => s + (parseFloat(i.total) || 0), 0);
    const overdue = invoices.filter(i => i.payment_status === 'overdue').length;
    const paid = invoices.filter(i => i.payment_status === 'paid').length;
    return { total, outstanding, overdue, paid };
  }, [invoices]);

  const columns = [
    {
      key: 'number',
      label: '#',
      render: (v: string, row: any) => (
        <Link href={`/invoices/${row.id}`} className="text-blue-600 hover:underline font-medium">{v}</Link>
      ),
    },
    { key: 'customer_business_then_name', label: 'Customer' },
    {
      key: 'date',
      label: 'Date',
      render: (v: string) => <span title={fmtDate(v)} className="text-gray-600">{fmtDate(v)}</span>,
    },
    {
      key: 'due_date',
      label: 'Due',
      render: (v: string, row: any) => {
        if (!v) return <span className="text-gray-400">—</span>;
        const overdue = row.payment_status === 'overdue';
        return (
          <span title={fmtDate(v)} className={overdue ? 'text-red-600 font-medium' : 'text-gray-600'}>
            {overdue ? '⚠ ' : ''}{fmtDate(v)}
          </span>
        );
      },
    },
    {
      key: 'total',
      label: 'Total',
      render: (v: any) => <span className="font-medium">{fmtMoney(v)}</span>,
    },
    {
      key: 'payment_status',
      label: 'Status',
      render: (v: string) => <Badge variant={statusVariant(v)}>{statusLabel(v)}</Badge>,
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Invoices</h1>
        <div className="text-sm text-gray-500">{pagination.total.toLocaleString()} total</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Page total</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{fmtMoney(stats.total)}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Outstanding</div>
          <div className="text-2xl font-bold text-amber-600 mt-1">{fmtMoney(stats.outstanding)}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Paid (page)</div>
          <div className="text-2xl font-bold text-green-600 mt-1">{stats.paid}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Overdue</div>
          <div className={`text-2xl font-bold mt-1 ${stats.overdue ? 'text-red-600' : 'text-gray-400'}`}>
            {stats.overdue || '—'}
          </div>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={invoices}
        serverSide
        sortCol={listState.sortCol}
        sortDir={listState.sortDir}
        onSortChange={(c, d) => setSort(c, d)}
        onFilterChange={f => setFilters(f)}
        loading={loading}
        rowClassName={(row: any) => !row.synced ? 'bg-red-50' : ''}
      />
      <Pagination
        page={pagination.page}
        limit={pagination.limit}
        total={pagination.total}
        onPageChange={setPage}
      />
    </div>
  );
}
