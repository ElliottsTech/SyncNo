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

export default function PortalUserDetail() {
  const { id } = useParams();
  const [row, setRow] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetchJson(`${API}/portal_users/${id}`)
      .then(setRow)
      .catch(e => { if (!(e instanceof UnauthorizedError)) setNotFound(true); });
  }, [id]);

  usePageTitle(row ? `${row.email || 'Portal User'} — Syncno` : null);

  if (notFound) return <p className="text-gray-500">Failed to load portal user.</p>;
  if (!row) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/portal_users" className="text-blue-600 hover:underline text-sm">← Back to Portal Users</Link>
      <div className="mt-4 bg-white rounded border">
        <div className="p-6 border-b flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">{row.email}</h1>
            <p className="text-gray-500 mt-1">{row.mobile || ''}</p>
          </div>
          {row.disabled ? <Badge variant="danger">Disabled</Badge> : <Badge variant="success">Active</Badge>}
        </div>
        <CollapsibleSection title="Details">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <p><span className="text-gray-500">Mobile:</span> {row.mobile || '—'}</p>
            <p><span className="text-gray-500">Confirmed Mobile:</span> {row.confirmed_mobile || '—'}</p>
            <p><span className="text-gray-500">Require MFA:</span> {row.require_mfa ? 'Yes' : 'No'}</p>
            <p><span className="text-gray-500">Created:</span> {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</p>
          </div>
        </CollapsibleSection>
        {(row.customer || row.contact) && (
          <CollapsibleSection title="Links">
            <div className="space-y-2 text-sm">
              {row.customer && (
                <p>
                  <span className="text-gray-500">Customer:</span>{' '}
                  <Link href={`/customers/${row.customer.id}`} className="text-blue-600 hover:underline">{row.customer.display_name || `#${row.customer.id}`}</Link>
                </p>
              )}
              {row.contact && (
                <p>
                  <span className="text-gray-500">Contact:</span>{' '}
                  <Link href={`/customers/${row.contact.id}`} className="text-blue-600 hover:underline">{row.contact.name || row.contact.email}</Link>
                </p>
              )}
            </div>
          </CollapsibleSection>
        )}
      </div>
      <RawJsonView rawJson={row.raw_json} label="Portal User Raw JSON" />
    </div>
  );
}
