'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import Pagination from '../../components/Pagination';

const API = '/api';

export default function AssetsPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0 });

  function fetchPage(p: number) {
    setLoading(true);
    fetch(`${API}/assets?page=${p}&limit=50`)
      .then(r => r.json())
      .then(res => {
        setData(res.data || []);
        setPagination(res.pagination || { page: p, limit: 50, total: 0 });
        setLoading(false);
      });
  }

  useEffect(() => {
    fetchPage(1);
  }, []);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Assets</h1>
      </div>
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <>
          <DataTable
            columns={[
              {
                key: 'name', label: 'Name', sortable: true,
                render: (v, r) => <Link href={`/assets/${r.id}`} className="text-blue-600 hover:underline">{v}</Link>,
              },
              { key: 'asset_type', label: 'Type', sortable: true },
              { key: 'asset_serial', label: 'Serial' },
              { key: 'created_at', label: 'Created', render: v => v ? new Date(v).toLocaleDateString() : '' },
            ]}
            data={data}
            loading={loading}
            emptyMessage="No assets"
          />
          <Pagination
            page={pagination.page}
            limit={pagination.limit}
            total={pagination.total}
            onPageChange={(p) => fetchPage(p)}
          />
        </>
      )}
    </div>
  );
}
