'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Badge from '../../../components/Badge';
import DataTable from '../../../components/DataTable';
import RawJsonView from '../../../components/RawJsonView';
import { usePageTitle } from '../../../lib/usePageTitle';

const API = '/api';

function CollapsibleSection({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-t">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex justify-between items-center p-4 hover:bg-gray-50 text-left"
      >
        <h2 className="font-semibold">
          {title}
          {count !== undefined && count > 0 && (
            <span className="ml-2 text-sm text-gray-500">({count})</span>
          )}
        </h2>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="p-4 pt-0">{children}</div>}
    </div>
  );
}

export default function ProductDetail() {
  const { id } = useParams();
  const [product, setProduct] = useState<any>(null);
  const [tickets, setTickets] = useState<any[]>([]);

  useEffect(() => {
    fetch(`${API}/products/${id}`)
      .then(r => r.json())
      .then(setProduct);
    fetch(`${API}/products/${id}/tickets`)
      .then(r => r.json())
      .then(setTickets);
  }, [id]);

  usePageTitle(product ? `${product.name || 'Product'} — Syncno` : null);

  if (!product) return <p className="text-gray-500">Loading...</p>;

  const fmtMoney = (v: any) => {
    const n = parseFloat(v);
    return isNaN(n) ? v : `$${n.toFixed(2)}`;
  };

  const margin = (() => {
    const retail = parseFloat(product.price_retail);
    const cost = parseFloat(product.price_cost);
    if (isNaN(retail) || isNaN(cost) || retail === 0) return null;
    return `${(((retail - cost) / retail) * 100).toFixed(1)}%`;
  })();

  let vendorIds: any[] = [];
  try {
    const raw = typeof product.vendor_ids === 'string' ? JSON.parse(product.vendor_ids) : product.vendor_ids;
    if (Array.isArray(raw)) vendorIds = raw;
  } catch (_) {}

  return (
    <div className="max-w-7xl mx-auto">
      <Link href="/products" className="text-blue-600 hover:underline text-sm">← Back to Products</Link>

      <div className="mt-4 bg-white rounded border">
        <div className="p-6 border-b">
          <div className="flex justify-between items-start">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={!!product.synced}
                onChange={async (e) => {
                  await fetch(`${API}/sync/synced`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ table: 'products', id: product.id, synced: !product.synced }),
                  });
                  const res = await fetch(`${API}/products/${id}`).then(r => r.json());
                  setProduct(res);
                }}
                className="w-5 h-5 cursor-pointer mt-1"
                title={product.synced ? 'Synced — click to force re-sync' : 'Not synced'}
              />
              <div>
                <h1 className="text-xl font-bold">{product.name || '(unnamed)'}</h1>
                <p className="text-gray-500 mt-1">
                  ID: <span className="font-mono">{product.id}</span>
                  {product.upc_code && <> · UPC: <span className="font-mono">{product.upc_code}</span></>}
                </p>
                {product.description && (
                  <p className="text-gray-700 mt-2">{product.description}</p>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              {product.disabled
                ? <Badge variant="danger">Disabled</Badge>
                : <Badge variant="success">Active</Badge>}
              {product.serialized && <Badge variant="info">Serialized</Badge>}
              {product.taxable && <Badge>Taxable</Badge>}
              {product.maintain_stock && <Badge>Maintains Stock</Badge>}
            </div>
          </div>
        </div>

        <div className="p-6 grid grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold mb-2">Pricing &amp; Stock</h3>
            <p><span className="text-gray-500">Retail:</span> {fmtMoney(product.price_retail)}</p>
            <p><span className="text-gray-500">Cost:</span> {fmtMoney(product.price_cost)}</p>
            <p><span className="text-gray-500">Wholesale:</span> {fmtMoney(product.price_wholesale)}</p>
            {margin && <p><span className="text-gray-500">Margin:</span> {margin}</p>}
            <p className="mt-2"><span className="text-gray-500">Quantity on hand:</span> {product.quantity}</p>
            {product.reorder_at && <p><span className="text-gray-500">Reorder at:</span> {product.reorder_at}</p>}
            {product.desired_stock_level && <p><span className="text-gray-500">Desired stock:</span> {product.desired_stock_level}</p>}
            {product.physical_location && <p><span className="text-gray-500">Location:</span> {product.physical_location}</p>}
          </div>
          <div>
            <h3 className="font-semibold mb-2">Categorization</h3>
            <p><span className="text-gray-500">Category:</span> {product.product_category || '—'}</p>
            <p><span className="text-gray-500">Category path:</span> {product.category_path || '—'}</p>
            {product.condition && <p><span className="text-gray-500">Condition:</span> {product.condition}</p>}
            {product.warranty && <p><span className="text-gray-500">Warranty:</span> {product.warranty}</p>}
            {vendorIds.length > 0 && (
              <p><span className="text-gray-500">Vendor IDs:</span> {vendorIds.join(', ')}</p>
            )}
            {product.qb_item_id && <p><span className="text-gray-500">QB Item ID:</span> {product.qb_item_id}</p>}
            {product.since_updated_at && (
              <p><span className="text-gray-500">Last Syncro update:</span> {new Date(product.since_updated_at).toLocaleString()}</p>
            )}
          </div>
        </div>

        {/* Usage summary */}
        {product.usage && (product.usage.tickets + product.usage.invoices + product.usage.estimates + product.usage.purchase_orders) > 0 && (
          <div className="p-6 border-t">
            <h3 className="font-semibold mb-3">Usage</h3>
            <div className="flex flex-wrap gap-4 text-sm">
              <Link href="#" onClick={(e) => { e.preventDefault(); document.getElementById('tickets-section')?.scrollIntoView({ behavior: 'smooth' }); }}
                className="px-3 py-2 rounded border border-gray-200 hover:bg-gray-50">
                <span className="text-gray-500">Tickets:</span> <span className="font-semibold">{product.usage.tickets}</span>
              </Link>
              <div className="px-3 py-2 rounded border border-gray-200">
                <span className="text-gray-500">Invoices:</span> <span className="font-semibold">{product.usage.invoices}</span>
              </div>
              <div className="px-3 py-2 rounded border border-gray-200">
                <span className="text-gray-500">Estimates:</span> <span className="font-semibold">{product.usage.estimates}</span>
              </div>
              <div className="px-3 py-2 rounded border border-gray-200">
                <span className="text-gray-500">Purchase Orders:</span> <span className="font-semibold">{product.usage.purchase_orders}</span>
              </div>
            </div>
          </div>
        )}

        {product.long_description && (
          <div className="p-6 border-t">
            <h3 className="font-semibold mb-2">Long Description</h3>
            <p className="text-gray-700 whitespace-pre-wrap">{product.long_description}</p>
          </div>
        )}

        {product.notes && (
          <div className="p-6 border-t">
            <h3 className="font-semibold mb-2">Notes</h3>
            <p className="text-gray-700 whitespace-pre-wrap">{product.notes}</p>
          </div>
        )}

        <CollapsibleSection title="Linked Tickets" count={tickets.length}>
          {tickets.length > 0 ? (
            <div className="space-y-2">
              {tickets.map((t: any) => (
                <Link
                  key={t.id}
                  href={`/tickets/${t.id}`}
                  className="flex items-center justify-between gap-2 text-sm px-3 py-2 rounded border border-gray-200 hover:bg-gray-50"
                >
                  <span className="flex items-center gap-3">
                    <span className="font-mono">#{t.number}</span>
                    <span className="text-gray-700">{t.subject}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    {t.customer_business_then_name && <span className="text-gray-500">{t.customer_business_then_name}</span>}
                    {t.status && <Badge variant={t.status === 'Resolved' ? 'success' : 'default'}>{t.status}</Badge>}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No tickets reference this product</p>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Serials" count={product.serials?.length || 0}>
          {product.serials && product.serials.length > 0 ? (
            <DataTable
              columns={[
                { key: 'serial_number', label: 'Serial Number', render: (v) => v ? <Link href={`/serials/${encodeURIComponent(v)}`} className="text-blue-600 hover:underline font-mono">{v}</Link> : '' },
                { key: 'status', label: 'Status' },
                { key: 'created_at', label: 'Created', render: v => v ? new Date(v).toLocaleDateString() : '' },
                { key: 'updated_at', label: 'Updated', render: v => v ? new Date(v).toLocaleDateString() : '' },
              ]}
              data={product.serials}
              emptyMessage="No serials"
            />
          ) : (
            <p className="text-gray-500 text-sm">
              {product.serialized ? 'No serials synced for this product.' : 'Product is not serialized.'}
            </p>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="SKUs" count={product.skus?.length || 0}>
          {product.skus && product.skus.length > 0 ? (
            <DataTable
              columns={[
                { key: 'sku', label: 'SKU' },
                {
                  key: 'vendor_name',
                  label: 'Vendor',
                  render: (v, row) => row.vendor_id
                    ? <Link href={`/vendors/${row.vendor_id}`} className="text-blue-600 hover:underline">{v}</Link>
                    : v,
                },
              ]}
              data={product.skus}
              emptyMessage="No SKUs"
            />
          ) : (
            <p className="text-gray-500 text-sm">No SKUs registered for this product.</p>
          )}
        </CollapsibleSection>
      </div>

      <RawJsonView rawJson={product.raw_json} label="Product Raw JSON" />
    </div>
  );
}
