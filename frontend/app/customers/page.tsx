'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import Pagination from '../../components/Pagination';

const API = '/api';

export default function CustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [sortCol, setSortCol] = useState<string | null>('business_name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>('asc');
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  const fetchCustomers = useCallback(() => {
    setLoading(true);
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
  }, [page, search, sortCol, sortDir, columnFilters]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(1);
  };

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
          value={search}
          onChange={e => handleSearch(e.target.value)}
          className="border px-3 py-2 rounded w-64"
        />
      </div>

      <DataTable
        columns={columns}
        data={customers}
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
