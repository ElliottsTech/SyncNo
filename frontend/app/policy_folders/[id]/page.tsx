'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import RawJsonView from '../../../components/RawJsonView';
import CollapsibleSection from '../../../components/CollapsibleSection';
import { usePageTitle } from '../../../lib/usePageTitle';

const API = '/api';

export default function PolicyFolderDetail() {
  const { id } = useParams();
  const [row, setRow] = useState<any>(null);

  useEffect(() => {
    fetch(`${API}/policy_folders/${id}`).then(r => r.json()).then(setRow);
  }, [id]);

  usePageTitle(row ? `${row.name || 'Policy'} — Syncno` : null);

  if (!row) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/policy_folders" className="text-blue-600 hover:underline text-sm">← Back to Policy Folders</Link>
      <div className="mt-4 bg-white rounded border">
        <div className="p-6 border-b">
          <h1 className="text-xl font-bold">{row.name || `#${row.id}`}</h1>
          {row.description && <p className="text-gray-600 text-sm mt-1">{row.description}</p>}
        </div>
        <CollapsibleSection title="Details">
          <div className="text-sm space-y-1">
            <p><span className="text-gray-500">Created:</span> {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</p>
            <p><span className="text-gray-500">Updated:</span> {row.updated_at ? new Date(row.updated_at).toLocaleString() : '—'}</p>
          </div>
        </CollapsibleSection>
        {(row.customer || row.asset) && (
          <CollapsibleSection title="Links">
            <div className="space-y-2 text-sm">
              {row.customer && (
                <p>
                  <span className="text-gray-500">Customer:</span>{' '}
                  <Link href={`/customers/${row.customer.id}`} className="text-blue-600 hover:underline">{row.customer.display_name || `#${row.customer.id}`}</Link>
                </p>
              )}
              {row.asset && (
                <p>
                  <span className="text-gray-500">Asset:</span>{' '}
                  <Link href={`/assets/${row.asset.id}`} className="text-blue-600 hover:underline">{row.asset.name || `#${row.asset.id}`}</Link>
                </p>
              )}
            </div>
          </CollapsibleSection>
        )}
      </div>
      <RawJsonView rawJson={row.raw_json} label="Policy Folder Raw JSON" />
    </div>
  );
}
