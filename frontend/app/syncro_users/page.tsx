'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import Badge from '../../components/Badge';
import Pagination from '../../components/Pagination';
import { useListState } from '../../lib/useUrlState';
import { usePageTitle } from '../../lib/usePageTitle';
import { fetchJson, UnauthorizedError } from '../../lib/fetch';

const API = '/api';

export default function SyncroUsersPage() {
  usePageTitle('Syncro Users — Syncno');
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [listState, { setPage, setSort, setFilters }] = useListState({
    page: 1, sortCol: 'email', sortDir: 'asc', columnFilters: {},
  });

  const fetchRows = useCallback(() => {
    setLoading(true);
    const { page, sortCol, sortDir, columnFilters } = listState;
    const sort = sortCol && sortDir ? `&sortCol=${sortCol}&sortDir=${sortDir}` : '';
    const colFilters = Object.entries(columnFilters)
      .filter(([_, v]) => v)
      .map(([k, v]) => `&filter_${k}=${encodeURIComponent(v)}`)
      .join('');
    fetchJson(`${API}/syncro_users?page=${page}&limit=50${sort}${colFilters}`)
      .then(d => { setRows(d.data || []); setPagination(d.pagination || { page: 1, limit: 50, total: 0 }); setLoading(false); })
      .catch(e => { if (!(e instanceof UnauthorizedError)) { setRows([]); setLoading(false); } });
  }, [listState]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const columns = [
    {
      key: 'email', label: 'Email',
      render: (v, row) => <Link href={`/syncro_users/${row.id}`} className="text-blue-600 hover:underline font-medium">{v}</Link>,
    },
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type' },
    { key: 'disabled', label: 'Status', render: v => v ? <Badge variant="danger">Disabled</Badge> : <Badge variant="success">Active</Badge> },
    { key: 'created_at', label: 'Created', render: v => v ? new Date(v).toLocaleDateString() : '' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Syncro Users</h1>
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
