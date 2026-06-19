'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Badge from '../../components/Badge';
import DataTable from '../../components/DataTable';
import Pagination from '../../components/Pagination';
import { useListState } from '../../lib/useUrlState';

const API = '/api';

export default function PurchaseOrdersPage() {
  const [pos, setPos] = useState([]);
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

  useEffect(() => {
    fetchPOs();
  }, [fetchPOs]);

  const handleSortChange = (col: string, dir: 'asc' | 'desc' | null) => {
    setSort(col, dir);
  };

  const handleFilterChange = (filters: Record<string, string>) => {
    setFilters(filters);
  };

  const columns = [
    {
      key: 'number',
      label: 'PO #',
      render: (v, row) => (
        <Link href={`/purchase-orders/${row.id}`} className="text-blue-600 hover:underline font-medium">
          {v}
        </Link>
      ),
    },
    { key: 'vendor_name', label: 'Vendor' },
    { key: 'status', label: 'Status', render: v => <Badge>{v}</Badge> },
    { key: 'total', label: 'Total' },
    { key: 'created_at', label: 'Created', render: v => v ? new Date(v).toLocaleDateString() : '' },
    { key: 'due_date', label: 'Due', render: v => v ? new Date(v).toLocaleDateString() : '' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Purchase Orders</h1>
      <DataTable
        columns={columns}
        data={pos}
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
