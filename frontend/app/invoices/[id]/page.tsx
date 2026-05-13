'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Badge from '../../../components/Badge';
import DataTable from '../../../components/DataTable';
import RawJsonView from '../../../components/RawJsonView';

const API = '/api';

export default function InvoiceDetail() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);

  useEffect(() => {
    fetch(`${API}/invoices/${id}`)
      .then(r => r.json())
      .then(setInvoice);
    fetch(`${API}/invoices/${id}/payments`)
      .then(r => r.json())
      .then(setPayments);
  }, [id]);

  if (!invoice) return <p className="text-gray-500">Loading...</p>;

  const raw = invoice.raw_json ? (typeof invoice.raw_json === 'string' ? JSON.parse(invoice.raw_json) : invoice.raw_json) : null;
  const lineItems = raw?.line_items || [];
  const customer = raw?.customer;
  const hasBusiness = customer?.business_name && customer?.business_name !== customer?.fullname;
  const displayName = hasBusiness
    ? `${customer.business_name} (${customer.fullname})`
    : customer?.business_then_name || customer?.fullname || invoice.customer_business_then_name || 'Unknown Customer';
  const statusVariant = (status: string) => {
    if (status === 'paid') return 'success';
    if (status === 'overdue') return 'danger';
    if (status === 'verified_paid' || status === 'tech_marked_paid') return 'info';
    return 'warning';
  };

  return (
    <div className="max-w-7xl mx-auto">
      <Link href="/invoices" className="text-blue-600 hover:underline text-sm">← Back to Invoices</Link>

      <div className="mt-4 bg-white rounded border">
        <div className="p-6 border-b">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={!!invoice.synced}
              onChange={async (e) => {
                await fetch(`${API}/sync/synced`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ table: 'invoices', id: invoice.id, synced: !invoice.synced }),
                });
                const res = await fetch(`${API}/invoices/${id}`).then(r => r.json());
                setInvoice(res);
              }}
              className="w-5 h-5 cursor-pointer mt-1"
              title={invoice.synced ? 'Synced — click to force re-sync' : 'Not synced'}
            />
            <div className="flex-1">
              <h1 className="text-xl font-bold">Invoice #{invoice.number}</h1>
              <p className="text-gray-500 mt-1">{displayName}</p>
            </div>
            <Badge variant={statusVariant(invoice.payment_status)}>
              {invoice.payment_status?.toUpperCase()}
            </Badge>
          </div>
        </div>

        <div className="p-6 grid grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold mb-2">Details</h3>
            <p><span className="text-gray-500">Date:</span> {invoice.date ? new Date(invoice.date).toLocaleDateString() : ''}</p>
            <p><span className="text-gray-500">Due:</span> {invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : ''}</p>
            <p><span className="text-gray-500">Subtotal:</span> {invoice.subtotal}</p>
            <p><span className="text-gray-500">Tax:</span> {invoice.tax}</p>
            <p className="text-lg font-semibold mt-2">Total: {invoice.total}</p>
          </div>
          {customer ? (
            <div>
              <h3 className="font-semibold mb-2">Customer</h3>
              <p>{hasBusiness ? `${customer.business_name} (${customer.fullname})` : customer.business_then_name || customer.fullname}</p>
              {customer.email && <p><span className="text-gray-500">Email:</span> {customer.email}</p>}
              {customer.phone && <p><span className="text-gray-500">Phone:</span> {customer.phone}</p>}
              {customer.mobile && <p><span className="text-gray-500">Mobile:</span> {customer.mobile}</p>}
            </div>
          ) : invoice.note ? (
            <div>
              <h3 className="font-semibold mb-2">Notes</h3>
              <p className="text-gray-700">{invoice.note}</p>
            </div>
          ) : null}
        </div>
      </div>

      {payments.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-3">Payments</h2>
          <DataTable
            columns={[
              { key: 'payment_amount', label: 'Amount' },
              { key: 'payment_method', label: 'Method' },
              { key: 'applied_at', label: 'Date', render: v => v ? new Date(v).toLocaleDateString() : '' },
              { key: 'ref_num', label: 'Ref #' },
            ]}
            data={payments}
          />
        </div>
      )}

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
                    <td className="px-4 py-3">{li.description || '—'}</td>
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

      <RawJsonView rawJson={invoice.raw_json} label="Invoice Raw JSON" />
    </div>
  );
}
