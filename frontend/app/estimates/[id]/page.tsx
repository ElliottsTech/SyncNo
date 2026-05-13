'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Badge from '../../../components/Badge';
import RawJsonView from '../../../components/RawJsonView';

const API = '/api';

export default function EstimateDetail() {
  const { id } = useParams();
  const [estimate, setEstimate] = useState<any>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`${API}/estimates/${id}`)
      .then(r => r.json())
      .then(setEstimate);
  }, [id]);

  if (!estimate) return <p className="text-gray-500">Loading...</p>;

  const raw = estimate.raw_json ? (typeof estimate.raw_json === 'string' ? JSON.parse(estimate.raw_json) : estimate.raw_json) : null;
  const lineItems = raw?.line_items || [];
  const customer = raw?.customer;
  const hasBusiness = customer?.business_name && customer?.business_name !== customer?.fullname;
  const displayName = hasBusiness
    ? `${customer.business_name} (${customer.fullname})`
    : customer?.business_then_name || customer?.fullname || 'Unknown Customer';

  return (
    <div className="max-w-7xl mx-auto">
      <Link href="/estimates" className="text-blue-600 hover:underline text-sm">← Back to Estimates</Link>

      <div className="mt-4 bg-white rounded border">
        <div className="p-6 border-b">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={!!estimate.synced}
              onChange={async (e) => {
                await fetch(`${API}/sync/synced`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ table: 'estimates', id: estimate.id, synced: !estimate.synced }),
                });
                const res = await fetch(`${API}/estimates/${id}`).then(r => r.json());
                setEstimate(res);
              }}
              className="w-5 h-5 cursor-pointer mt-1"
              title={estimate.synced ? 'Synced — click to force re-sync' : 'Not synced'}
            />
            <div className="flex-1">
              <h1 className="text-xl font-bold">Estimate #{estimate.number}</h1>
              <p className="text-gray-500 mt-1">{displayName}</p>
            </div>
            <Badge variant={estimate.status === 'Fresh' ? 'info' : estimate.status === 'Accepted' ? 'success' : 'default'}>
              {estimate.status}
            </Badge>
          </div>
        </div>

        <div className="p-6 grid grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold mb-2">Details</h3>
            <p><span className="text-gray-500">Date:</span> {estimate.date ? new Date(estimate.date).toLocaleDateString() : ''}</p>
            <p><span className="text-gray-500">Subtotal:</span> ${parseFloat(estimate.subtotal || 0).toFixed(2)}</p>
            <p><span className="text-gray-500">Tax:</span> ${parseFloat(estimate.tax || 0).toFixed(2)}</p>
            <p className="text-lg font-semibold mt-2">Total: ${parseFloat(estimate.total || 0).toFixed(2)}</p>
          </div>
          {customer ? (
            <div>
              <h3 className="font-semibold mb-2">Customer</h3>
              <p>{hasBusiness ? `${customer.business_name} (${customer.fullname})` : customer.business_then_name || customer.fullname}</p>
              {customer.email && <p><span className="text-gray-500">Email:</span> {customer.email}</p>}
              {customer.phone && <p><span className="text-gray-500">Phone:</span> {customer.phone}</p>}
              {customer.mobile && <p><span className="text-gray-500">Mobile:</span> {customer.mobile}</p>}
            </div>
          ) : null}
        </div>
      </div>

      {lineItems.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-3">Line Items</h2>
          <div className="bg-white rounded border overflow-hidden">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b bg-gray-50">
                  <th className="px-4 py-3 text-xs font-medium uppercase">Product</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase">Description</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase">Qty</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase">Price</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lineItems.map((li: any, i: number) => (
                  <tr key={i}>
                    <td className="px-4 py-3">{li.product_name || li.name || 'N/A'}</td>
                    <td className="px-4 py-3">{li.description || li.name || '—'}</td>
                    <td className="px-4 py-3">{li.quantity || 1}</td>
                    <td className="px-4 py-3">${parseFloat(li.price || li.unit_price || 0).toFixed(2)}</td>
                    <td className="px-4 py-3">${parseFloat(li.total || (li.quantity * li.price) || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <RawJsonView rawJson={estimate.raw_json} label="Estimate Raw JSON" />
    </div>
  );
}
