'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import DataTable from '../../../components/DataTable';
import Badge from '../../../components/Badge';
import RawJsonView from '../../../components/RawJsonView';
import { fetchJson, UnauthorizedError } from '../../../lib/fetch';

const API = '/api';

export default function VendorDetail() {
  const { id } = useParams();
  const [vendor, setVendor] = useState<any>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetchJson(`${API}/vendors/${id}`)
      .then(setVendor)
      .catch(e => { if (!(e instanceof UnauthorizedError)) setNotFound(true); });
    fetchJson(`${API}/vendors/${id}/purchase_orders`)
      .then(setPurchaseOrders)
      .catch(e => { if (!(e instanceof UnauthorizedError)) setPurchaseOrders([]); });
  }, [id]);

  if (notFound) return <p className="text-gray-500">Failed to load vendor.</p>;
  if (!vendor) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="max-w-7xl mx-auto">
      <Link href="/vendors" className="text-blue-600 hover:underline text-sm">← Back to Vendors</Link>

      <div className="mt-4 bg-white rounded border">
        <div className="p-6 border-b">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={!!vendor.synced}
              onChange={async (e) => {
                try {
                  await fetchJson(`${API}/sync/synced`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ table: 'vendors', id: vendor.id, synced: !vendor.synced }),
                  });
                  const res = await fetchJson(`${API}/vendors/${id}`);
                  setVendor(res);
                } catch (err) { if (!(err instanceof UnauthorizedError)) { /* keep current state */ } }
              }}
              className="w-5 h-5 cursor-pointer mt-1"
              title={vendor.synced ? 'Synced — click to force re-sync' : 'Not synced'}
            />
            <h1 className="text-xl font-bold">{vendor.name}</h1>
          </div>
        </div>
        <div className="p-6 grid grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold mb-2">Contact</h3>
            <p><span className="text-gray-500">Rep:</span> {vendor.rep_first_name} {vendor.rep_last_name}</p>
            <p><span className="text-gray-500">Email:</span> {vendor.email}</p>
            <p><span className="text-gray-500">Phone:</span> {vendor.phone}</p>
            <p><span className="text-gray-500">Account #:</span> {vendor.account_number}</p>
          </div>
          <div>
            <h3 className="font-semibold mb-2">Address</h3>
            <p>{vendor.address}</p>
            <p>{vendor.city}, {vendor.state} {vendor.zip}</p>
            {vendor.website && <p className="text-blue-600">{vendor.website}</p>}
          </div>
          {vendor.notes && (
            <div className="col-span-2">
              <h3 className="font-semibold mb-2">Notes</h3>
              <p className="text-gray-700">{vendor.notes}</p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6">
        <h2 className="text-lg font-semibold mb-3">Purchase Orders ({purchaseOrders.length})</h2>
        <DataTable
          columns={[
            { key: 'number', label: 'PO #', render: (v, r) => <Link href={`/purchase-orders/${r.id}`} className="text-blue-600 hover:underline">{v}</Link> },
            { key: 'status', label: 'Status', render: v => <Badge>{v}</Badge> },
            { key: 'total', label: 'Total' },
            { key: 'created_at', label: 'Created', render: v => v ? new Date(v).toLocaleDateString() : '' },
            { key: 'due_date', label: 'Due', render: v => v ? new Date(v).toLocaleDateString() : '' },
          ]}
          data={purchaseOrders}
          emptyMessage="No purchase orders"
        />
      </div>

      <RawJsonView rawJson={vendor.raw_json} label="Vendor Raw JSON" />
    </div>
  );
}
