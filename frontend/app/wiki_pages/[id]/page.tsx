'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import RawJsonView from '../../../components/RawJsonView';
import CollapsibleSection from '../../../components/CollapsibleSection';
import { usePageTitle } from '../../../lib/usePageTitle';

const API = '/api';

export default function WikiPageDetail() {
  const { id } = useParams();
  const [row, setRow] = useState<any>(null);

  useEffect(() => {
    fetch(`${API}/wiki_pages/${id}`).then(r => r.json()).then(setRow);
  }, [id]);

  usePageTitle(row ? `${row.name || 'Wiki'} — Syncno` : null);

  if (!row) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/wiki_pages" className="text-blue-600 hover:underline text-sm">← Back to Wiki</Link>
      <div className="mt-4 bg-white rounded border">
        <div className="p-6 border-b">
          <h1 className="text-xl font-bold">{row.name}</h1>
          <p className="text-gray-500 mt-1 text-sm">
            <span className="font-mono">{row.slug}</span>
            {row.modified ? ` · modified ${new Date(row.modified).toLocaleString()}` : ''}
          </p>
        </div>
        <CollapsibleSection title="Body">
          <div className="prose prose-sm max-w-none whitespace-pre-wrap">{row.body || row.interpolated_body || '(empty)'}</div>
        </CollapsibleSection>
      </div>
      <RawJsonView rawJson={row.raw_json} label="Wiki Page Raw JSON" />
    </div>
  );
}
