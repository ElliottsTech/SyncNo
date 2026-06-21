'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import RawJsonView from '../../../components/RawJsonView';
import { usePageTitle } from '../../../lib/usePageTitle';

const API = '/api';

export default function AppointmentTypeDetail() {
  const { id } = useParams();
  const [row, setRow] = useState<any>(null);

  useEffect(() => {
    fetch(`${API}/appointment_types/${id}`).then(r => r.json()).then(setRow);
  }, [id]);

  usePageTitle(row ? `${row.name} — Syncno` : null);

  if (!row) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/appointment_types" className="text-blue-600 hover:underline text-sm">← Back to Appointment Types</Link>
      <div className="mt-4 bg-white rounded border p-6">
        <h1 className="text-xl font-bold">{row.name || `#${row.id}`}</h1>
        <p className="text-gray-500 mt-1">Created: {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</p>
      </div>
      <RawJsonView rawJson={row.raw_json} label="Appointment Type Raw JSON" />
    </div>
  );
}
