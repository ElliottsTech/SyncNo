'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import Badge from '../../components/Badge';
import Pagination from '../../components/Pagination';

const API = '/api';

export default function EstimatesPage() {
  const [estimates, setEstimates] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(true);

  const fetchEstimates = useCallback(() => {
    setLoading(true);
    fetch(`${API}/estimates?page=${page}&limit=50`)
      .then(r => r.json())
      .then(d => {
        setEstimates(d.data);
        setPagination(d.pagination);
        setLoading(false);
      });
  }, [page]);

  useEffect(() => {
    fetchEstimates();
  }, [fetchEstimates]);

  const columns = [
    {
      key: 'number', label: '#',
      render: (v, r) => <Link href={`/estimates/${r.id}`} className="text-blue-600 hover:underline">{v}</Link>,
    },
    { key: 'customer_name', label: 'Customer' },
    { key: 'status', label: 'Status', render: v => <Badge>{v}</Badge> },
    { key: 'date', label: 'Date', render: v => v ? new Date(v).toLocaleDateString() : '' },
    { key: 'total', label: 'Total' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Estimates</h1>
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <>
          <DataTable columns={columns} data={estimates} emptyMessage="No estimates" />
          <Pagination
            page={pagination.page}
            limit={pagination.limit}
            total={pagination.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
