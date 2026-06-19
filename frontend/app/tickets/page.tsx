'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import Badge from '../../components/Badge';
import Pagination from '../../components/Pagination';
import { useListState } from '../../lib/useUrlState';
import { usePageTitle } from '../../lib/usePageTitle';

const API = '/api';

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
    fetch(`${API}/tickets?page=${page}&limit=100${sort}${colFilters}`)
      .then(r => r.json())
      .then(d => {
        setTickets(d.data);
        setPagination(d.pagination);
        setLoading(false);
      });
  }, [listState]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const handleSortChange = (col: string, dir: 'asc' | 'desc' | null) => {
    setSort(col, dir);
  };

  const handleFilterChange = (filters: Record<string, string>) => {
    setFilters(filters);
  };

  const statusVariant = (status: string) => {
    if (status === 'New') return 'info';
    if (status === 'Resolved' || status === 'Closed') return 'success';
    if (status === 'In Progress') return 'warning';
    return 'default';
  };

  const columns = [
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
        sortCol={listState.sortCol}
        sortDir={listState.sortDir}
        onSortChange={handleSortChange}
        onFilterChange={handleFilterChange}
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
