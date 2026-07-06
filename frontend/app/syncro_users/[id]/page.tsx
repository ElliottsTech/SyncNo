'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Badge from '../../../components/Badge';
import RawJsonView from '../../../components/RawJsonView';
import CollapsibleSection from '../../../components/CollapsibleSection';
import { usePageTitle } from '../../../lib/usePageTitle';
import { fetchJson, UnauthorizedError } from '../../../lib/fetch';

const API = '/api';

export default function SyncroUserDetail() {
  const { id } = useParams();
  const [row, setRow] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetchJson(`${API}/syncro_users/${id}`)
      .then(setRow)
      .catch(e => { if (!(e instanceof UnauthorizedError)) setNotFound(true); });
  }, [id]);

  usePageTitle(row ? `${row.name || row.email || 'User'} — Syncno` : null);

  if (notFound) return <p className="text-gray-500">Failed to load user.</p>;
  if (!row) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/syncro_users" className="text-blue-600 hover:underline text-sm">← Back to Syncro Users</Link>
      <div className="mt-4 bg-white rounded border">
        <div className="p-6 border-b flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">{row.name || row.email}</h1>
            <p className="text-gray-500 mt-1">{row.email}</p>
          </div>
          <div className="flex gap-2">
            {row.type && <Badge variant="info">{row.type}</Badge>}
            {row.disabled ? <Badge variant="danger">Disabled</Badge> : <Badge variant="success">Active</Badge>}
          </div>
        </div>
        <CollapsibleSection title="Details">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <p><span className="text-gray-500">First Name:</span> {row.first_name || '—'}</p>
            <p><span className="text-gray-500">Last Name:</span> {row.last_name || '—'}</p>
            <p><span className="text-gray-500">Type:</span> {row.type || '—'}</p>
            <p><span className="text-gray-500">Created:</span> {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</p>
          </div>
        </CollapsibleSection>
      </div>
      <RawJsonView rawJson={row.raw_json} label="Syncro User Raw JSON" />
    </div>
  );
}
