'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Badge from '../../components/Badge';
import DataTable from '../../components/DataTable';
import Pagination from '../../components/Pagination';

const API = '/api';

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [sortCol, setSortCol] = useState<string | null>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>('asc');
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  const fetchProducts = useCallback(() => {
    setLoading(true);
    const sort = sortCol && sortDir ? `&sortCol=${sortCol}&sortDir=${sortDir}` : '';
    const colFilters = Object.entries(columnFilters)
      .filter(([, v]) => v)
      .map(([k, v]) => `&filter_${k}=${encodeURIComponent(v)}`)
      .join('');
    fetch(`${API}/products?page=${page}&limit=50${sort}${colFilters}`)
      .then(r => r.json())
      .then(d => {
        setProducts(d.data || []);
        setPagination(d.pagination);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page, sortCol, sortDir, columnFilters]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const handleSortChange = (col: string, dir: 'asc' | 'desc' | null) => {
    setSortCol(col);
    setSortDir(dir);
    setPage(1);
  };

  const handleFilterChange = (filters: Record<string, string>) => {
    setColumnFilters(filters);
    setPage(1);
  };

  const fmtMoney = (v: any) => {
    const n = parseFloat(v);
    return isNaN(n) ? v : `$${n.toFixed(2)}`;
  };

  const columns = [
    {
      key: 'synced',
      label: 'Synced',
      sortable: false,
      render: (v: any, row: any) => (
        <input
          type="checkbox"
          checked={!!v}
          onChange={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await fetch(`${API}/sync/synced`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ table: 'products', id: row.id, synced: !v }),
            });
            fetchProducts();
          }}
          className="w-4 h-4 cursor-pointer"
        />
      ),
    },
    {
      key: 'name',
      label: 'Name',
      render: (v: any, row: any) => (
        <Link href={`/products/${row.id}`} className="text-blue-600 hover:underline font-medium">
          {v || '(unnamed)'}
        </Link>
      ),
    },
    {
      key: 'product_category',
      label: 'Category',
      render: (v: string) => v || <span className="text-gray-400">—</span>,
    },
    { key: 'price_retail', label: 'Retail', render: (v: any) => fmtMoney(v) },
    { key: 'price_cost', label: 'Cost', render: (v: any) => fmtMoney(v) },
    { key: 'quantity', label: 'Qty' },
    {
      key: 'serialized',
      label: 'Serialized',
      render: (v: any) => v ? <Badge variant="info">Yes</Badge> : <span className="text-gray-400">No</span>,
    },
    {
      key: 'disabled',
      label: 'Status',
      render: (v: any) => v
        ? <Badge variant="danger">Disabled</Badge>
        : <Badge variant="success">Active</Badge>,
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Products</h1>
      <DataTable
        columns={columns}
        data={products}
        serverSide
        sortCol={sortCol}
        sortDir={sortDir}
        onSortChange={handleSortChange}
        onFilterChange={handleFilterChange}
        loading={loading}
        emptyMessage="No products. Sync products from Settings."
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
