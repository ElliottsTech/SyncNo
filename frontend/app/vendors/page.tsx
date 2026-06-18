'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';

const API = '/api';

export default function VendorsPage() {
  const [vendors, setVendors] = useState([]);

  const fetchVendors = useCallback(() => {
    fetch(`${API}/vendors`)
      .then(r => r.json())
      .then(setVendors);
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
      <DataTable columns={columns} data={vendors} emptyMessage="No vendors" />
    </div>
  );
}
