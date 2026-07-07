'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import Badge from '../../components/Badge';
import Pagination from '../../components/Pagination';
import { useListState } from '../../lib/useUrlState';
import { usePageTitle } from '../../lib/usePageTitle';
import { fetchJson, UnauthorizedError } from '../../lib/fetch';

const API = '/api';

function relTime(s?: string | null) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}mo ago`;
  return `${Math.floor(mon / 12)}y ago`;
}

function isOverdue(row: any) {
  if (!row.due_date) return false;
  if (row.status === 'Resolved' || row.status === 'Closed') return false;
  return new Date(row.due_date).getTime() < Date.now();
}

function priorityVariant(p: string): 'danger' | 'warning' | 'default' {
  if (!p) return 'default';
  if (/^1|critical/i.test(p)) return 'danger';
  if (/^2|high/i.test(p)) return 'warning';
  return 'default';
}

function priorityRank(p: string): number {
  if (!p) return 99;
  const m = p.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 99;
}

function statusVariant(s: string): 'info' | 'success' | 'warning' | 'danger' | 'default' {
  if (!s) return 'default';
  if (s === 'New') return 'info';
  if (s === 'Resolved' || s === 'Closed') return 'success';
  if (s === 'In Progress') return 'warning';
  if (/waiting|hold|pending/i.test(s)) return 'danger';
  return 'default';
}

export default function TicketsPage() {
  usePageTitle('Tickets — Syncno');
  const [tickets, setTickets] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 100, total: 0 });
  const [loading, setLoading] = useState(true);
  const [listState, { setPage, setSort, setFilters }] = useListState({
    page: 1,
    sortCol: 'created_at',
    sortDir: 'desc',
    columnFilters: {},
  });

  const fetchTickets = useCallback(() => {
    setLoading(true);
    const { page, sortCol, sortDir, columnFilters } = listState;
    const sort = sortCol && sortDir ? `&sortCol=${sortCol}&sortDir=${sortDir}` : '';
    const colFilters = Object.entries(columnFilters)
      .filter(([_, v]) => v)
      .map(([k, v]) => `&filter_${k}=${encodeURIComponent(v)}`)
      .join('');
    fetchJson(`${API}/tickets?page=${page}&limit=100${sort}${colFilters}`)
      .then(d => {
        setTickets(d.data || []);
        setPagination(d.pagination || { page: 1, limit: 100, total: 0 });
        setLoading(false);
      })
      .catch(e => { if (!(e instanceof UnauthorizedError)) { setTickets([]); setLoading(false); } });
  }, [listState]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const handleSortChange = (col: string, dir: 'asc' | 'desc' | null) => setSort(col, dir);
  const handleFilterChange = (filters: Record<string, string>) => setFilters(filters);

  // Stats from current page (visible tickets only — fast, no extra request)
  const stats = useMemo(() => {
    const open = tickets.filter((t: any) => !['Resolved', 'Closed'].includes(t.status)).length;
    const newCount = tickets.filter((t: any) => t.status === 'New').length;
    const overdue = tickets.filter(isOverdue).length;
    const high = tickets.filter((t: any) => priorityRank(t.priority) <= 2 && !['Resolved', 'Closed'].includes(t.status)).length;
    return { open, newCount, overdue, high };
  }, [tickets]);

  const columns = [
    {
      key: 'number',
      label: '#',
      render: (v: string, row: any) => (
        <span className="inline-flex items-center gap-1">
          <Link href={`/tickets/${row.id}`} className="text-blue-600 hover:underline font-medium">
            {v}
          </Link>
          {row.attachments_count > 0 && (
            <span title={`${row.attachments_count} attachment${row.attachments_count === 1 ? '' : 's'}`} className="text-gray-500" aria-label="has attachments">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M11.5 4.5L5 11a2 2 0 102.83 2.83L13.5 8.5a3.5 3.5 0 00-4.95-4.95L3.4 8.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'subject',
      label: 'Subject',
      render: (v: string, row: any) => (
        <div className="max-w-md">
          <Link href={`/tickets/${row.id}`} className="text-gray-900 hover:text-blue-600 hover:underline">
            {v}
          </Link>
          {row.ticket_type_name && (
            <div className="text-xs text-gray-500 mt-0.5">{row.ticket_type_name}</div>
          )}
          {row.tags && row.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {row.tags.slice(0, 3).map((tag: string, i: number) => (
                <span key={i} className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">{tag}</span>
              ))}
              {row.tags.length > 3 && (
                <span className="text-xs text-gray-400">+{row.tags.length - 3}</span>
              )}
            </div>
          )}
        </div>
      ),
    },
    { key: 'customer_business_then_name', label: 'Customer' },
    {
      key: 'status',
      label: 'Status',
      render: (v: string) => <Badge variant={statusVariant(v)}>{v || '—'}</Badge>,
    },
    {
      key: 'priority',
      label: 'Priority',
      render: (v: string) => v ? <Badge variant={priorityVariant(v)}>{v}</Badge> : <span className="text-gray-400">—</span>,
    },
    { key: 'problem_type', label: 'Type' },
    {
      key: 'updated_at',
      label: 'Updated',
      render: (v: string) => (
        <span title={v ? new Date(v).toLocaleString() : ''} className="text-gray-600">
          {relTime(v)}
        </span>
      ),
    },
    {
      key: 'due_date',
      label: 'Due',
      render: (v: string, row: any) => {
        if (!v) return <span className="text-gray-400">—</span>;
        const overdue = isOverdue(row);
        return (
          <span
            title={new Date(v).toLocaleString()}
            className={overdue ? 'text-red-600 font-medium' : 'text-gray-600'}
          >
            {overdue ? '⚠ ' : ''}{relTime(v)}
          </span>
        );
      },
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (v: string) => (
        <span title={v ? new Date(v).toLocaleString() : ''} className="text-gray-600">
          {v ? new Date(v).toLocaleDateString() : ''}
        </span>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Tickets</h1>
        <div className="text-sm text-gray-500">{pagination.total.toLocaleString()} total</div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Open (page)</div>
          <div className="text-2xl font-bold text-blue-600 mt-1">{stats.open}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">New</div>
          <div className="text-2xl font-bold text-indigo-600 mt-1">{stats.newCount}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">High priority</div>
          <div className="text-2xl font-bold text-amber-600 mt-1">{stats.high}</div>
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
        data={tickets}
        serverSide
        sortCol={listState.sortCol}
        sortDir={listState.sortDir}
        onSortChange={handleSortChange}
        onFilterChange={handleFilterChange}
        loading={loading}
        rowClassName={(row: any) => {
          if (!row.synced) return 'bg-red-50';
          if (isOverdue(row)) return 'bg-amber-50';
          return '';
        }}
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
