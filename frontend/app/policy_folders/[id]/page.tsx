'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import RawJsonView from '../../../components/RawJsonView';
import CollapsibleSection from '../../../components/CollapsibleSection';
import { usePageTitle } from '../../../lib/usePageTitle';
import { fetchJson, UnauthorizedError } from '../../../lib/fetch';

const API = '/api';

export default function PolicyFolderDetail() {
  const { id } = useParams();
  const [row, setRow] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetchJson(`${API}/policy_folders/${id}`)
      .then(setRow)
      .catch(e => { if (!(e instanceof UnauthorizedError)) setNotFound(true); });
  }, [id]);

  usePageTitle(row ? `${row.name || 'Policy'} — Syncno` : null);

  if (notFound) return <p className="text-gray-500">Failed to load policy.</p>;
  if (!row) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/policy_folders" className="text-blue-600 hover:underline text-sm">← Back to Policy Folders</Link>
      <div className="mt-4 bg-white rounded border">
        <div className="p-6 border-b">
          <h1 className="text-xl font-bold">{row.name || `#${row.id}`}</h1>
          {row.description && <p className="text-gray-600 text-sm mt-1">{row.description}</p>}
          <div className="mt-2 text-sm text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
            {row.customer_name && (
              <span>Customer:{' '}
                <Link href={`/customers/${row.customer_id}`} className="text-blue-600 hover:underline">{row.customer_name}</Link>
              </span>
            )}
            {row.effective_policy_id && <span>Effective Policy: <span className="font-mono">{row.effective_policy_id}</span></span>}
            {row.partial_policy_id && <span>Partial Policy: <span className="font-mono">{row.partial_policy_id}</span></span>}
          </div>
        </div>

        <CollapsibleSection title={`Assets under this policy (${row.assets?.length || 0})`} defaultOpen>
          {row.assets?.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="p-2">Name</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">Serial</th>
                    <th className="p-2">Customer</th>
                  </tr>
                </thead>
                <tbody>
                  {row.assets.map((a: any) => (
                    <tr key={a.id} className="border-t hover:bg-gray-50">
                      <td className="p-2">
                        <Link href={`/assets/${a.id}`} className="text-blue-600 hover:underline font-medium">{a.name || `#${a.id}`}</Link>
                      </td>
                      <td className="p-2 text-gray-700">{a.asset_type || '—'}</td>
                      <td className="p-2 font-mono text-xs">{a.asset_serial || '—'}</td>
                      <td className="p-2">
                        {a.customer_name
                          ? <Link href={`/customers/${a.customer_id}`} className="text-blue-600 hover:underline">{a.customer_name}</Link>
                          : <span className="text-gray-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No assets linked to this policy folder.</p>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Hierarchy">
          <div className="text-sm space-y-2">
            {row.parent_folder ? (
              <p>
                <span className="text-gray-500">Parent:</span>{' '}
                <Link href={`/policy_folders/${row.parent_folder.id}`} className="text-blue-600 hover:underline">{row.parent_folder.name}</Link>
              </p>
            ) : <p className="text-gray-500">No parent folder (root level).</p>}
            {row.child_folders?.length > 0 && (
              <div>
                <p className="text-gray-500 mb-1">Children:</p>
                <ul className="list-disc list-inside text-gray-700">
                  {row.child_folders.map((c: any) => (
                    <li key={c.id}>
                      <Link href={`/policy_folders/${c.id}`} className="text-blue-600 hover:underline">{c.name}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Details">
          <div className="text-sm space-y-1">
            <p><span className="text-gray-500">Created:</span> {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</p>
            <p><span className="text-gray-500">Updated:</span> {row.updated_at ? new Date(row.updated_at).toLocaleString() : '—'}</p>
          </div>
        </CollapsibleSection>
      </div>
      <RawJsonView rawJson={row.raw_json} label="Policy Folder Raw JSON" />
    </div>
  );
}
