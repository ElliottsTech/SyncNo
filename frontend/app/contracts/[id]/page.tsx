'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Badge from '../../../components/Badge';
import RawJsonView from '../../../components/RawJsonView';
import CollapsibleSection from '../../../components/CollapsibleSection';
import { usePageTitle } from '../../../lib/usePageTitle';

const API = '/api';

export default function ContractDetail() {
  const { id } = useParams();
  const [row, setRow] = useState<any>(null);

  useEffect(() => {
    fetch(`${API}/contracts/${id}`).then(r => r.json()).then(setRow);
  }, [id]);

  usePageTitle(row ? `${row.name || 'Contract'} — Syncno` : null);

  if (!row) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/contracts" className="text-blue-600 hover:underline text-sm">← Back to Contracts</Link>
      <div className="mt-4 bg-white rounded border">
        <div className="p-6 border-b flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">{row.name || `#${row.id}`}</h1>
            <p className="text-gray-500 mt-1">
              {row.start_date ? new Date(row.start_date).toLocaleDateString() : ''} → {row.end_date ? new Date(row.end_date).toLocaleDateString() : ''}
            </p>
          </div>
          <div className="flex gap-2">
            {row.status && <Badge variant="info">{row.status}</Badge>}
            {row.likelihood && <Badge>{row.likelihood}</Badge>}
          </div>
        </div>

        <CollapsibleSection title="Details">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <p><span className="text-gray-500">Amount:</span> {row.contract_amount ? `$${parseFloat(row.contract_amount).toFixed(2)}` : '—'}</p>
            <p><span className="text-gray-500">Apply to all:</span> {row.apply_to_all ? 'Yes' : 'No'}</p>
            <p><span className="text-gray-500">SLA ID:</span> {row.sla_id || '—'}</p>
            <p><span className="text-gray-500">Created:</span> {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</p>
          </div>
          {row.description && (
            <div className="mt-4">
              <h3 className="font-semibold mb-1">Description</h3>
              <p className="text-sm whitespace-pre-wrap">{row.description}</p>
            </div>
          )}
        </CollapsibleSection>

        {row.customer && (
          <CollapsibleSection title="Customer">
            <Link href={`/customers/${row.customer.id}`} className="text-blue-600 hover:underline text-sm">
              {row.customer.display_name || `#${row.customer.id}`}
            </Link>
          </CollapsibleSection>
        )}
      </div>
      <RawJsonView rawJson={row.raw_json} label="Contract Raw JSON" />
    </div>
  );
}
