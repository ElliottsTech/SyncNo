'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import Badge from '../../components/Badge';
import Pagination from '../../components/Pagination';

const API = '/api';

export default function TicketsPage() {
  const [tickets, setTickets] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 100, total: 0 });
  const [loading, setLoading] = useState(true);
  const [sortCol, setSortCol] = useState<string | null>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>('desc');
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  const fetchTickets = useCallback(() => {
    setLoading(true);
    const sort = sortCol && sortDir ? `&sortCol=${sortCol}&sortDir=${sortDir}` : '';
    const colFilters = Object.entries(columnFilters)
      .filter(([_, v]) => v)
      .map(([k, v]) => `&filter_${k}=${encodeURIComponent(v)}`)
      .join('');
    fetch(`${API}/tickets?page=${page}&limit=100${sort}${colFilters}`)
      .then(r => r.json())
      .then(d => {
        setTickets(d.data);
        setPagination(d.pagination);
        setLoading(false);
      });
  }, [page, sortCol, sortDir, columnFilters]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const handleSortChange = (col: string, dir: 'asc' | 'desc' | null) => {
    setSortCol(col);
    setSortDir(dir);
    setPage(1);
  };

  const handleFilterChange = (filters: Record<string, string>) => {
    setColumnFilters(filters);
    setPage(1);
  };

  const statusVariant = (status: string) => {
    if (status === 'New') return 'info';
    if (status === 'Resolved' || status === 'Closed') return 'success';
    if (status === 'In Progress') return 'warning';
    return 'default';
  };

  const columns = [
    {
      key: 'synced',
      label: 'Synced',
      render: (v, row) => (
        <input
          type="checkbox"
          checked={!!v}
          onChange={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await fetch(`${API}/sync/synced`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ table: 'tickets', id: row.id, synced: !v }),
            });
            fetchTickets();
          }}
          className="w-4 h-4 cursor-pointer"
          title={v ? 'Synced — click to force re-sync' : 'Not synced'}
        />
      ),
    },
    {
      key: 'number',
      label: '#',
      render: (v, row) => (
        <Link href={`/tickets/${row.id}`} className="text-blue-600 hover:underline font-medium">
          {v}
        </Link>
      ),
    },
    { key: 'subject', label: 'Subject' },
    { key: 'customer_business_then_name', label: 'Customer' },
    { key: 'status', label: 'Status', render: v => <Badge variant={statusVariant(v)}>{v}</Badge> },
    { key: 'priority', label: 'Priority' },
    { key: 'created_at', label: 'Created', render: v => v ? new Date(v).toLocaleDateString() : '' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Tickets</h1>
      <DataTable
        columns={columns}
        data={tickets}
        serverSide
        sortCol={sortCol}
        sortDir={sortDir}
        onSortChange={handleSortChange}
        onFilterChange={handleFilterChange}
        loading={loading}
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
