'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import Badge from '../../components/Badge';
import Pagination from '../../components/Pagination';

const API = '/api';

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [sortCol, setSortCol] = useState<string | null>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>('desc');
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  const fetchInvoices = useCallback(() => {
    setLoading(true);
    const sort = sortCol && sortDir ? `&sortCol=${sortCol}&sortDir=${sortDir}` : '';
    const colFilters = Object.entries(columnFilters)
      .filter(([_, v]) => v)
      .map(([k, v]) => `&filter_${k}=${encodeURIComponent(v)}`)
      .join('');
    fetch(`${API}/invoices?page=${page}&limit=50${sort}${colFilters}`)
      .then(r => r.json())
      .then(d => {
        setInvoices(d.data);
        setPagination(d.pagination);
        setLoading(false);
      });
  }, [page, sortCol, sortDir, columnFilters]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

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
    if (status === 'paid') return 'success';
    if (status === 'overdue') return 'danger';
    if (status === 'verified_paid' || status === 'tech_marked_paid') return 'info';
    return 'warning';
  };

  const columns = [
    {
      key: 'number',
      label: '#',
      render: (v, row) => (
        <Link href={`/invoices/${row.id}`} className="text-blue-600 hover:underline font-medium">
          {v}
        </Link>
      ),
    },
    { key: 'customer_name', label: 'Customer' },
    { key: 'date', label: 'Date', render: v => v ? new Date(v).toLocaleDateString() : '' },
    { key: 'due_date', label: 'Due', render: v => v ? new Date(v).toLocaleDateString() : '' },
    { key: 'total', label: 'Total' },
    { key: 'payment_status', label: 'Status', render: (v: string) => <Badge variant={statusVariant(v)}>{v}</Badge> },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Invoices</h1>
      <DataTable
        columns={columns}
        data={invoices}
        serverSide
        sortCol={sortCol}
        sortDir={sortDir}
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
