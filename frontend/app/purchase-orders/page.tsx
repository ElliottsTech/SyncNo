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
function statusVariant(s?: string | null): 'success' | 'info' | 'warning' | 'danger' | 'default' {
  if (!s) return 'default';
  const l = s.toLowerCase();
  if (/(received|complete|closed|delivered)/.test(l)) return 'success';
  if (/(ordered|submitted|sent|open)/.test(l)) return 'info';
  if (/(draft|pending|waiting)/.test(l)) return 'warning';
  if (/(cancelled|rejected|overdue)/.test(l)) return 'danger';
  return 'default';
}

export default function PurchaseOrdersPage() {
  usePageTitle('Purchase Orders — Syncno');
  const [pos, setPos] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [listState, { setPage, setSort, setFilters }] = useListState({
    page: 1,
    sortCol: 'created_at',
    sortDir: 'desc',
    columnFilters: {},
  });

  const fetchPOs = useCallback(() => {
    setLoading(true);
    const { page, sortCol, sortDir, columnFilters } = listState;
    const sort = sortCol && sortDir ? `&sortCol=${sortCol}&sortDir=${sortDir}` : '';
    const colFilters = Object.entries(columnFilters)
      .filter(([_, v]) => v)
      .map(([k, v]) => `&filter_${k}=${encodeURIComponent(v)}`)
      .join('');
    fetch(`${API}/purchase-orders?page=${page}&limit=50${sort}${colFilters}`)
      .then(r => r.json())
      .then(d => {
        setPos(d.data);
        setPagination(d.pagination);
        setLoading(false);
      });
  }, [listState]);

  useEffect(() => { fetchPOs(); }, [fetchPOs]);

  const stats = useMemo(() => {
    const totalValue = pos.reduce((s, p) => s + (parseFloat(p.total) || 0), 0);
    const open = pos.filter(p => !/received|complete|closed|delivered|cancelled/i.test(p.status || '')).length;
    const overdue = pos.filter(p => {
      if (!p.due_date || /received|complete|closed|delivered|cancelled/i.test(p.status || '')) return false;
      return new Date(p.due_date).getTime() < Date.now();
    }).length;
    const received = pos.filter(p => /received|complete|closed|delivered/i.test(p.status || '')).length;
    return { totalValue, open, overdue, received };
  }, [pos]);

  const columns = [
    {
      key: 'number', label: 'PO #',
      render: (v: string, row: any) => (
        <Link href={`/purchase-orders/${row.id}`} className="text-blue-600 hover:underline font-medium">{v}</Link>
      ),
    },
    {
      key: 'vendor_name', label: 'Vendor',
      render: (v: string, row: any) => row.vendor_id ? (
        <Link href={`/vendors/${row.vendor_id}`} className="text-blue-600 hover:underline">{v || '—'}</Link>
      ) : (v || <span className="text-gray-400">—</span>),
    },
    {
      key: 'status', label: 'Status',
      render: (v: string) => <Badge variant={statusVariant(v)}>{v || '—'}</Badge>,
    },
    {
      key: 'total', label: 'Total',
      render: (v: any) => <span className="font-medium">{fmtMoney(v)}</span>,
    },
    {
      key: 'created_at', label: 'Created',
      render: (v: string) => <span title={fmtDate(v)} className="text-gray-600">{relTime(v)}</span>,
    },
    {
      key: 'due_date', label: 'Due',
      render: (v: string, row: any) => {
        if (!v) return <span className="text-gray-400">—</span>;
        const isOverdue = !/received|complete|closed|delivered|cancelled/i.test(row.status || '')
          && new Date(v).getTime() < Date.now();
        return (
          <span title={fmtDate(v)} className={isOverdue ? 'text-red-600 font-medium' : 'text-gray-600'}>
            {isOverdue ? '⚠ ' : ''}{fmtDate(v)}
          </span>
        );
      },
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Purchase Orders</h1>
        <div className="text-sm text-gray-500">{pagination.total.toLocaleString()} total</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Page value</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{fmtMoney(stats.totalValue)}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Open</div>
          <div className="text-2xl font-bold text-indigo-600 mt-1">{stats.open}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Received</div>
          <div className="text-2xl font-bold text-green-600 mt-1">{stats.received}</div>
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
        data={pos}
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
