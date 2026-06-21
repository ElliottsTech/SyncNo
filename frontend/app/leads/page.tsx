'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import Badge from '../../components/Badge';
import Pagination from '../../components/Pagination';
import { useListState } from '../../lib/useUrlState';
import { usePageTitle } from '../../lib/usePageTitle';

const API = '/api';

export default function LeadsPage() {
  usePageTitle('Leads — Syncno');
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [listState, { setPage, setSort, setFilters }] = useListState({
    page: 1, sortCol: 'created_at', sortDir: 'desc', columnFilters: {},
  });

  const fetchRows = useCallback(() => {
    setLoading(true);
    const { page, sortCol, sortDir, columnFilters } = listState;
    const sort = sortCol && sortDir ? `&sortCol=${sortCol}&sortDir=${sortDir}` : '';
    const colFilters = Object.entries(columnFilters)
      .filter(([_, v]) => v)
      .map(([k, v]) => `&filter_${k}=${encodeURIComponent(v)}`)
      .join('');
    fetch(`${API}/leads?page=${page}&limit=50${sort}${colFilters}`)
      .then(r => r.json())
      .then(d => { setRows(d.data); setPagination(d.pagination); setLoading(false); });
  }, [listState]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const columns = [
    {
      key: 'name', label: 'Name', sortable: true,
      render: (v, row) => (
        <Link href={`/leads/${row.id}`} className="text-blue-600 hover:underline font-medium">
          {v || row.business_then_name || '(no name)'}
        </Link>
      ),
    },
    { key: 'email', label: 'Email', sortable: true },
    { key: 'phone', label: 'Phone' },
    { key: 'status', label: 'Status', sortable: true, render: v => v ? <Badge>{v}</Badge> : '' },
    {
      key: 'ticket_subject', label: 'Ticket', sortable: true,
      render: (v, row) => row.ticket_id ? (
        <Link href={`/tickets/${row.ticket_id}`} className="text-blue-600 hover:underline">
          {v || `#${row.ticket_id}`}
        </Link>
      ) : '',
    },
    { key: 'mailbox_name', label: 'Mailbox', sortable: true },
    { key: 'created_at', label: 'Created', sortable: true, render: v => v ? new Date(v).toLocaleDateString() : '' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Leads</h1>
      <DataTable
        columns={columns}
        data={rows}
        serverSide
        sortCol={listState.sortCol}
        sortDir={listState.sortDir}
        onSortChange={(col, dir) => setSort(col, dir)}
        onFilterChange={setFilters}
        loading={loading}
        rowClassName={(row: any) => !row.synced ? 'bg-red-50' : ''}
      />
      <Pagination page={pagination.page} limit={pagination.limit} total={pagination.total} onPageChange={setPage} />
    </div>
  );
}
