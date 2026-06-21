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
function customerName(c: any): string {
  if (!c) return '';
  if (typeof c === 'string') {
    try { c = JSON.parse(c); } catch { return c; }
  }
  if (typeof c !== 'object') return '';
  return c.business_name || c.business_then_name || c.fullname || '';
}
function parseInvoiceIds(raw: any): number[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

export default function PaymentsPage() {
  usePageTitle('Payments — Syncno');
  const [payments, setPayments] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [listState, { setPage, setSort, setFilters }] = useListState({
    page: 1,
    sortCol: 'applied_at',
    sortDir: 'desc',
    columnFilters: {},
  });

  const fetchPayments = useCallback(() => {
    setLoading(true);
    const { page, sortCol, sortDir, columnFilters } = listState;
    const sort = sortCol && sortDir ? `&sortCol=${sortCol}&sortDir=${sortDir}` : '';
    const colFilters = Object.entries(columnFilters)
      .filter(([_, v]) => v)
      .map(([k, v]) => `&filter_${k}=${encodeURIComponent(v)}`)
      .join('');
    fetch(`${API}/payments?page=${page}&limit=50${sort}${colFilters}`)
      .then(r => r.json())
      .then(d => {
        setPayments(d.data);
        setPagination(d.pagination);
        setLoading(false);
      });
  }, [listState]);

  useEffect(() => { fetchPayments(); }, [fetchPayments]);

  const stats = useMemo(() => {
    const total = payments.reduce((s, p) => s + (parseFloat(p.payment_amount) || 0), 0);
    const successful = payments.filter(p => p.success);
    const successTotal = successful.reduce((s, p) => s + (parseFloat(p.payment_amount) || 0), 0);
    const failed = payments.filter(p => !p.success).length;
    const methods = new Set(payments.map(p => p.payment_method).filter(Boolean));
    return { total, successTotal, failed, methodCount: methods.size };
  }, [payments]);

  const columns = [
    {
      key: 'ref_num', label: 'Ref #',
      render: (v: string, row: any) => (
        <Link href={`/payments/${row.id}`} className="text-blue-600 hover:underline font-mono font-medium">
          {v || `#${row.id}`}
        </Link>
      ),
    },
    { key: 'customer', label: 'Customer', render: (v: any) => customerName(v) || '—' },
    {
      key: 'payment_amount', label: 'Amount',
      render: (v: any) => <span className="font-medium">{fmtMoney(v)}</span>,
    },
    {
      key: 'payment_method', label: 'Method',
      render: (v: string) => v ? <Badge variant="info">{v}</Badge> : <span className="text-gray-400">—</span>,
    },
    {
      key: 'applied_at', label: 'Applied',
      render: (v: string) => <span className="text-gray-600">{fmtDate(v)}</span>,
    },
    {
      key: 'success', label: 'Status',
      render: (v: any) => v ? <Badge variant="success">Success</Badge> : <Badge variant="danger">Failed</Badge>,
    },
    {
      key: 'invoice_ids', label: 'Invoices',
      render: (v: any) => {
        const ids = parseInvoiceIds(v);
        if (!ids.length) return <span className="text-gray-400">—</span>;
        return (
          <span className="flex flex-wrap gap-1">
            {ids.slice(0, 3).map(id => (
              <Link key={id} href={`/invoices/${id}`} className="text-blue-600 hover:underline font-mono text-xs">
                #{id}
              </Link>
            ))}
            {ids.length > 3 && <span className="text-xs text-gray-400">+{ids.length - 3}</span>}
          </span>
        );
      },
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Payments</h1>
        <div className="text-sm text-gray-500">{pagination.total.toLocaleString()} total</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Page total</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{fmtMoney(stats.total)}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Successful</div>
          <div className="text-2xl font-bold text-green-600 mt-1">{fmtMoney(stats.successTotal)}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Failed (page)</div>
          <div className={`text-2xl font-bold mt-1 ${stats.failed ? 'text-red-600' : 'text-gray-400'}`}>
            {stats.failed || '—'}
          </div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Methods</div>
          <div className="text-2xl font-bold text-indigo-600 mt-1">{stats.methodCount}</div>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={payments}
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
