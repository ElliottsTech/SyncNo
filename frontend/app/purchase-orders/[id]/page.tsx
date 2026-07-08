'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Badge from '../../../components/Badge';
import RawJsonView from '../../../components/RawJsonView';
import { fetchJson, UnauthorizedError } from '../../../lib/fetch';

const API = '/api';

export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const [po, setPo] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetchJson(`${API}/purchase-orders/${id}`)
      .then(setPo)
      .catch(e => { if (!(e instanceof UnauthorizedError)) setNotFound(true); });
  }, [id]);

  if (notFound) return <p className="text-gray-500">Failed to load purchase order.</p>;
  if (!po) return <p className="text-gray-500">Loading...</p>;

  const lineItems = Array.isArray(po.line_items) ? po.line_items : [];
  const vendor = typeof po.vendor === 'object' ? po.vendor : null;

  return (
    <div className="max-w-7xl mx-auto">
      <Link href="/purchase-orders" className="text-blue-600 hover:underline text-sm">← Back to Purchase Orders</Link>

      <div className="mt-4 bg-white rounded border">
        <div className="p-6 border-b">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={!!po.synced}
              onChange={async (e) => {
                try {
                  await fetchJson(`${API}/sync/synced`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ table: 'purchase_orders', id: po.id, synced: !po.synced }),
                  });
                  const res = await fetchJson(`${API}/purchase-orders/${id}`);
                  setPo(res);
                } catch (err) { if (!(err instanceof UnauthorizedError)) { /* keep current state */ } }
              }}
              className="w-5 h-5 cursor-pointer mt-1"
              title={po.synced ? 'Synced — click to force re-sync' : 'Not synced'}
            />
            <div className="flex-1">
              <h1 className="text-xl font-bold">PO #{po.number}</h1>
              {vendor && <p className="text-gray-500 mt-1">Vendor: {vendor.name}</p>}
            </div>
            <a
              href={`${API}/purchase-orders/${po.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm px-3 py-2 rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 whitespace-nowrap"
              title="Generate and download a purchase order PDF"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
                <path d="M8 1.5v9M8 10.5L5 7.5M8 10.5L11 7.5M2.5 13h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Download PDF
            </a>
            <Badge>{po.status}</Badge>
          </div>
        </div>

        <div className="p-6 grid grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold mb-2">Details</h3>
            <p><span className="text-gray-500">Created:</span> {po.created_at ? new Date(po.created_at).toLocaleDateString() : ''}</p>
            <p><span className="text-gray-500">Due:</span> {po.due_date ? new Date(po.due_date).toLocaleDateString() : ''}</p>
            <p><span className="text-gray-500">Paid:</span> {po.paid_date ? new Date(po.paid_date).toLocaleDateString() : 'N/A'}</p>
            <p className="text-lg font-semibold mt-2">Total: {po.total}</p>
          </div>
          {vendor && (
            <div>
              <h3 className="font-semibold mb-2">Vendor Contact</h3>
              <p>{vendor.name}</p>
              <p>{vendor.rep_first_name} {vendor.rep_last_name}</p>
              <p>{vendor.email}</p>
              <p>{vendor.phone}</p>
            </div>
          )}
        </div>
      </div>

      {lineItems.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-3">Line Items</h2>
          <div className="bg-white rounded border overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Qty</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cost</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {lineItems.map((item: any, i: number) => (
                  <tr key={i}>
                    <td className="px-4 py-3 text-sm">{item.product_name || item.description || item.name || `Item ${i + 1}`}</td>
                    <td className="px-4 py-3 text-sm">{item.quantity || 1}</td>
                    <td className="px-4 py-3 text-sm">${item.cost || item.price || 0}</td>
                    <td className="px-4 py-3 text-sm">${((item.quantity || 1) * (item.cost || item.price || 0)).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <RawJsonView rawJson={po.raw_json} label="Purchase Order Raw JSON" />
    </div>
  );
}
