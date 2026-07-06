'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import { usePageTitle } from '../../lib/usePageTitle';
import { fetchJson, UnauthorizedError } from '../../lib/fetch';

const API = '/api';

export default function VendorsPage() {
  usePageTitle('Vendors — Syncno');
  const [vendors, setVendors] = useState([]);

  const fetchVendors = useCallback(() => {
    fetchJson(`${API}/vendors`)
      .then(setVendors)
      .catch(e => { if (!(e instanceof UnauthorizedError)) setVendors([]); });
  }, []);

  useEffect(() => {
    fetchVendors();
  }, [fetchVendors]);

  const columns = [
    {
      key: 'name',
      label: 'Name',
      render: (v, row) => (
        <Link href={`/vendors/${row.id}`} className="text-blue-600 hover:underline font-medium">
          {v}
        </Link>
      ),
    },
    { key: 'rep_first_name', label: 'Rep' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'website', label: 'Website' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Vendors</h1>
      <DataTable columns={columns} data={vendors} emptyMessage="No vendors" rowClassName={(row: any) => !row.synced ? 'bg-red-50' : ''} />
    </div>
  );
}
