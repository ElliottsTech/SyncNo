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
function statusVariant(s?: string | null): 'success' | 'info' | 'warning' | 'danger' | 'default' {
  if (!s) return 'default';
  const l = s.toLowerCase();
  if (/(accepted|approved|won|converted)/.test(l)) return 'success';
  if (/(sent|pending|open|in progress)/.test(l)) return 'info';
  if (/(draft|pending review)/.test(l)) return 'warning';
  if (/(rejected|declined|lost|expired)/.test(l)) return 'danger';
  return 'default';
}

export default function EstimatesPage() {
  usePageTitle('Estimates — Syncno');
  const [estimates, setEstimates] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [listState, { setPage, setSort, setFilters }] = useListState({
    page: 1,
    sortCol: 'date',
    sortDir: 'desc',
    columnFilters: {},
  });

  const fetchEstimates = useCallback(() => {
    setLoading(true);
    const { page, sortCol, sortDir, columnFilters } = listState;
    const sort = sortCol && sortDir ? `&sortCol=${sortCol}&sortDir=${sortDir}` : '';
    const colFilters = Object.entries(columnFilters)
      .filter(([_, v]) => v)
      .map(([k, v]) => `&filter_${k}=${encodeURIComponent(v)}`)
      .join('');
    fetch(`${API}/estimates?page=${page}&limit=50${sort}${colFilters}`)
      .then(r => r.json())
      .then(d => {
        setEstimates(d.data);
        setPagination(d.pagination);
        setLoading(false);
      });
  }, [listState]);

  useEffect(() => { fetchEstimates(); }, [fetchEstimates]);

  const stats = useMemo(() => {
    const totalValue = estimates.reduce((s, e) => s + (parseFloat(e.total) || 0), 0);
    const accepted = estimates.filter(e => /accepted|approved|won/i.test(e.status || '')).length;
    const pending = estimates.filter(e => /sent|pending|open|in progress/i.test(e.status || '')).length;
    const invoiced = estimates.filter(e => e.invoice_id).length;
    return { totalValue, accepted, pending, invoiced };
  }, [estimates]);

  const columns = [
    {
      key: 'number', label: '#',
      render: (v: string, row: any) => (
        <Link href={`/estimates/${row.id}`} className="text-blue-600 hover:underline font-medium">{v}</Link>
      ),
    },
    { key: 'customer_business_then_name', label: 'Customer' },
    {
      key: 'status', label: 'Status',
      render: (v: string) => <Badge variant={statusVariant(v)}>{v || '—'}</Badge>,
    },
    {
      key: 'date', label: 'Date',
      render: (v: string) => <span className="text-gray-600">{fmtDate(v)}</span>,
    },
    {
      key: 'total', label: 'Total',
      render: (v: any) => <span className="font-medium">{fmtMoney(v)}</span>,
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Estimates</h1>
        <div className="text-sm text-gray-500">{pagination.total.toLocaleString()} total</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Page value</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{fmtMoney(stats.totalValue)}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Accepted</div>
          <div className="text-2xl font-bold text-green-600 mt-1">{stats.accepted}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Pending</div>
          <div className="text-2xl font-bold text-indigo-600 mt-1">{stats.pending}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Invoiced</div>
          <div className="text-2xl font-bold text-blue-600 mt-1">{stats.invoiced}</div>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={estimates}
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
