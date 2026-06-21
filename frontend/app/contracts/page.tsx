'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import Badge from '../../components/Badge';
import Pagination from '../../components/Pagination';
import { useListState } from '../../lib/useUrlState';
import { usePageTitle } from '../../lib/usePageTitle';

const API = '/api';

export default function ContractsPage() {
  usePageTitle('Contracts — Syncno');
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [listState, { setPage, setSort, setFilters }] = useListState({
    page: 1, sortCol: 'name', sortDir: 'asc', columnFilters: {},
  });

  const fetchRows = useCallback(() => {
    setLoading(true);
    const { page, sortCol, sortDir, columnFilters } = listState;
    const sort = sortCol && sortDir ? `&sortCol=${sortCol}&sortDir=${sortDir}` : '';
    const colFilters = Object.entries(columnFilters)
      .filter(([_, v]) => v)
      .map(([k, v]) => `&filter_${k}=${encodeURIComponent(v)}`)
      .join('');
    fetch(`${API}/contracts?page=${page}&limit=50${sort}${colFilters}`)
      .then(r => r.json())
      .then(d => { setRows(d.data); setPagination(d.pagination); setLoading(false); });
  }, [listState]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const columns = [
    {
      key: 'name', label: 'Name',
      render: (v, row) => <Link href={`/contracts/${row.id}`} className="text-blue-600 hover:underline font-medium">{v}</Link>,
    },
    { key: 'status', label: 'Status', render: v => v ? <Badge>{v}</Badge> : '' },
    { key: 'contract_amount', label: 'Amount', render: v => v ? `$${parseFloat(v).toFixed(2)}` : '—' },
    { key: 'start_date', label: 'Start', render: v => v ? new Date(v).toLocaleDateString() : '' },
    { key: 'end_date', label: 'End', render: v => v ? new Date(v).toLocaleDateString() : '' },
    { key: 'likelihood', label: 'Likelihood' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Contracts</h1>
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
