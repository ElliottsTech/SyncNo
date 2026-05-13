'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Badge from '../../components/Badge';
import DataTable from '../../components/DataTable';
import Pagination from '../../components/Pagination';

const API = '/api';

export default function PurchaseOrdersPage() {
  const [pos, setPos] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [sortCol, setSortCol] = useState<string | null>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>('desc');
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  const fetchPOs = useCallback(() => {
    setLoading(true);
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
  }, [page, sortCol, sortDir, columnFilters]);

  useEffect(() => {
    fetchPOs();
  }, [fetchPOs]);

  const handleSortChange = (col: string, dir: 'asc' | 'desc' | null) => {
    setSortCol(col);
    setSortDir(dir);
    setPage(1);
  };

  const handleFilterChange = (filters: Record<string, string>) => {
    setColumnFilters(filters);
    setPage(1);
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
              body: JSON.stringify({ table: 'purchase_orders', id: row.id, synced: !v }),
            });
            fetchPOs();
          }}
          className="w-4 h-4 cursor-pointer"
        />
      ),
    },
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
