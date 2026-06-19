'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import Pagination from '../../components/Pagination';
import { useListState } from '../../lib/useUrlState';
import { usePageTitle } from '../../lib/usePageTitle';

const API = '/api';

export default function CustomersPage() {
  usePageTitle('Customers — Syncno');
  const [customers, setCustomers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [listState, { setPage, setSort, setFilters, setSearch }] = useListState({
    page: 1,
    sortCol: 'business_name',
    sortDir: 'asc',
    columnFilters: {},
    search: '',
  });

  const fetchCustomers = useCallback(() => {
    setLoading(true);
    const { page, sortCol, sortDir, columnFilters, search } = listState;
    const sort = sortCol && sortDir ? `&sortCol=${sortCol}&sortDir=${sortDir}` : '';
    const globalSearch = search ? `&search=${encodeURIComponent(search)}` : '';
    const colFilters = Object.entries(columnFilters)
      .filter(([_, v]) => v)
      .map(([k, v]) => `&filter_${k}=${encodeURIComponent(v)}`)
      .join('');
    fetch(`${API}/customers?page=${page}&limit=50${globalSearch}${colFilters}${sort}`)
      .then(r => r.json())
      .then(d => {
        setCustomers(d.data);
        setPagination(d.pagination);
        setLoading(false);
      });
  }, [listState]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const handleSortChange = (col: string, dir: 'asc' | 'desc' | null) => {
    setSort(col, dir);
  };

  const handleFilterChange = (filters: Record<string, string>) => {
    setFilters(filters);
  };

  const columns = [
    {
      key: 'display_name',
      label: 'Business',
      render: (v, row) => (
        <Link href={`/customers/${row.id}`} className="text-blue-600 hover:underline font-medium">
          {v || row.fullname || 'N/A'}
        </Link>
      ),
    },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
  ];

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Customers</h1>
        <input
          type="text"
          placeholder="Global search..."
          value={listState.search || ''}
          onChange={e => setSearch(e.target.value)}
          className="border px-3 py-2 rounded w-64"
        />
      </div>

      <DataTable
        columns={columns}
        data={customers}
        serverSide
        sortCol={listState.sortCol}
        sortDir={listState.sortDir}
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
