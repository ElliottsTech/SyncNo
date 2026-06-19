'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import RawJsonView from '../../../components/RawJsonView';
import { usePageTitle } from '../../../lib/usePageTitle';

const API = '/api';

function CollapsibleSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex justify-between items-center p-4 hover:bg-gray-50 text-left"
      >
        <h2 className="font-semibold">{title}</h2>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="p-4 pt-2">{children}</div>}
    </div>
  );
}

export default function AssetDetail() {
  const { id } = useParams();
  const [asset, setAsset] = useState<any>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`${API}/assets/${id}`)
      .then(r => r.json())
      .then(setAsset);
  }, [id]);

  usePageTitle(asset ? `${asset.name || 'Asset'} — Syncno` : null);

  if (!asset) return <p className="text-gray-500">Loading...</p>;

  const props = asset.properties || {};
  const kabuto = props.kabuto_information || {};

  return (
    <div className="max-w-7xl mx-auto">
      <Link href="/assets" className="text-blue-600 hover:underline text-sm">← Back to Assets</Link>

      <div className="mt-4 bg-white rounded border">
        <div className="p-6 border-b">
          <div className="flex justify-between items-start">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={!!asset.synced}
                onChange={async (e) => {
                  await fetch(`${API}/sync/synced`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ table: 'assets', id: asset.id, synced: !asset.synced }),
                  });
                  const res = await fetch(`${API}/assets/${id}`).then(r => r.json());
                  setAsset(res);
                }}
                className="w-5 h-5 cursor-pointer mt-1"
                title={asset.synced ? 'Synced — click to force re-sync' : 'Not synced'}
              />
              <div>
                <h1 className="text-xl font-bold">{asset.name}</h1>
                <p className="text-gray-500 mt-1">
                  {asset.asset_type} · {asset.asset_serial
                    ? <Link href={`/serials/${encodeURIComponent(asset.asset_serial)}`} className="text-blue-600 hover:underline font-mono">{asset.asset_serial}</Link>
                    : 'No serial'}
                </p>
              </div>
            </div>
            <span className="text-sm text-gray-500">{props.form_factor || asset.asset_type}</span>
          </div>
        </div>

        <CollapsibleSection title="Overview">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p><span className="text-gray-500">Manufacturer:</span> {props.manufacturer || 'N/A'}</p>
              <p><span className="text-gray-500">Model:</span> {props.model || 'N/A'}</p>
              <p><span className="text-gray-500">Serial:</span> {asset.asset_serial
                ? <Link href={`/serials/${encodeURIComponent(asset.asset_serial)}`} className="text-blue-600 hover:underline font-mono">{asset.asset_serial}</Link>
                : 'N/A'}</p>
            </div>
            <div>
              <p><span className="text-gray-500">Form Factor:</span> {props.form_factor || 'N/A'}</p>
              <p><span className="text-gray-500">OS:</span> {props.os || 'N/A'}</p>
              <p><span className="text-gray-500">Created:</span> {asset.created_at ? new Date(asset.created_at).toLocaleString() : 'N/A'}</p>
            </div>
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="System Info">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p><span className="text-gray-500">RAM:</span> {kabuto.ram_gb ? `${kabuto.ram_gb} GB` : 'N/A'}</p>
              <p><span className="text-gray-500">Last User:</span> {kabuto.last_user || 'N/A'}</p>
              <p><span className="text-gray-500">Agent Version:</span> {props.agent_version || 'N/A'}</p>
            </div>
            <div>
              {kabuto.os?.name && <p><span className="text-gray-500">OS:</span> {kabuto.os.name}</p>}
              {kabuto.computer_uuid && <p><span className="text-gray-500">UUID:</span> <span className="font-mono text-xs">{kabuto.computer_uuid.substring(0, 8)}...</span></p>}
              {props.monitoring !== undefined && <p><span className="text-gray-500">Monitoring:</span> {props.monitoring ? 'Yes' : 'No'}</p>}
            </div>
          </div>
          {kabuto.cpu?.length > 0 && (
            <div className="mt-3 text-sm">
              <p className="text-gray-500 mb-1">CPU:</p>
              <ul className="list-disc list-inside text-gray-700">
                {kabuto.cpu.map((c: any, i: number) => (
                  <li key={i}>{c.name || c}</li>
                ))}
              </ul>
            </div>
          )}
          {kabuto.hdd?.length > 0 && (
            <div className="mt-3 text-sm">
              <p className="text-gray-500 mb-1">Storage:</p>
              <ul className="list-disc list-inside text-gray-700">
                {kabuto.hdd.map((h: any, i: number) => (
                  <li key={i}>{h.model || h.name || 'Disk'} — {h.size || h.capacity || ''}</li>
                ))}
              </ul>
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Network">
          {kabuto.network_adapters?.length > 0 ? (
            <div className="space-y-2 text-sm">
              {kabuto.network_adapters.map((n: any, i: number) => (
                <div key={i} className="border rounded p-2">
                  <p><span className="text-gray-500">Adapter:</span> {n.name || n.interface_name || `Adapter ${i + 1}`}</p>
                  {n.mac_address && <p><span className="text-gray-500">MAC:</span> {n.mac_address}</p>}
                  {n.ip_address && <p><span className="text-gray-500">IP:</span> {n.ip_address}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No network adapters</p>
          )}
        </CollapsibleSection>

        {asset.customer && (
          <CollapsibleSection title="Customer">
            <div className="text-sm">
              <p><span className="text-gray-500">Name:</span> {typeof asset.customer === 'object' ? asset.customer.name || asset.customer.business_name || 'N/A' : asset.customer}</p>
              {typeof asset.customer === 'object' && asset.customer.email && (
                <p><span className="text-gray-500">Email:</span> {asset.customer.email}</p>
              )}
            </div>
          </CollapsibleSection>
        )}
      </div>

      <RawJsonView rawJson={asset.raw_json} label="Asset Raw JSON" />
    </div>
  );
}
