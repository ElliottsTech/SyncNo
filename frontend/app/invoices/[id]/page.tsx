'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { usePageTitle } from '../../../lib/usePageTitle';
import Badge from '../../../components/Badge';
import RawJsonView from '../../../components/RawJsonView';
import { fetchJson, UnauthorizedError } from '../../../lib/fetch';

const API = '/api';

export default function InvoiceDetail() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState<any>(null);
  const [linkedTicket, setLinkedTicket] = useState<{ ticket_id: string | null; ticket: any | null } | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetchJson(`${API}/invoices/${id}`)
      .then(setInvoice)
      .catch(e => { if (!(e instanceof UnauthorizedError)) setNotFound(true); });
    fetchJson(`${API}/invoices/${id}/ticket`)
      .then(setLinkedTicket)
      .catch(e => { if (!(e instanceof UnauthorizedError)) setLinkedTicket(null); });
  }, [id]);

  usePageTitle(invoice ? `Invoice #${invoice.number} — Syncno` : null);

  if (notFound) return <p className="text-gray-500">Failed to load invoice.</p>;
  if (!invoice) return <p className="text-gray-500">Loading...</p>;

  const raw = invoice.raw_json ? (typeof invoice.raw_json === 'string' ? JSON.parse(invoice.raw_json) : invoice.raw_json) : null;
  // Prefer enriched line_items from backend (product_name resolved), fall back to raw
  const lineItems = Array.isArray(invoice.line_items) && invoice.line_items.length > 0
    ? invoice.line_items
    : (raw?.line_items || []);
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
                try {
                  await fetchJson(`${API}/sync/synced`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ table: 'invoices', id: invoice.id, synced: !invoice.synced }),
                  });
                  const res = await fetchJson(`${API}/invoices/${id}`);
                  setInvoice(res);
                } catch (err) { if (!(err instanceof UnauthorizedError)) { /* keep current state */ } }
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

        {linkedTicket && linkedTicket.ticket_id && (
          <div className="p-6 border-t">
            <h3 className="font-semibold mb-2">Linked Ticket</h3>
            {linkedTicket.ticket ? (
              <Link
                href={`/tickets/${linkedTicket.ticket.id}`}
                className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded border border-gray-300 bg-gray-50 hover:bg-gray-100"
              >
                <span className="font-mono">#{linkedTicket.ticket.number}</span>
                <span className="text-gray-700">{linkedTicket.ticket.subject || '(no subject)'}</span>
                {linkedTicket.ticket.status && (
                  <span className="text-xs text-gray-500">· {linkedTicket.ticket.status}</span>
                )}
                <span className="text-blue-600">→</span>
              </Link>
            ) : (
              <p className="text-sm text-gray-500">
                Ticket ID <span className="font-mono">{linkedTicket.ticket_id}</span> not yet synced.
                <Link href="/syncro" className="text-blue-600 hover:underline ml-2">Sync tickets →</Link>
              </p>
            )}
          </div>
        )}
      </div>

      {lineItems.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-3">Line Items</h2>
          <div className="bg-white rounded border overflow-hidden">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b bg-gray-50">
                  <th className="px-4 py-3 text-xs font-medium uppercase">Product</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase">Serial</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase">Description</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase">Qty</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase">Price</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lineItems.map((li: any, i: number) => (
                  <tr key={i}>
                    <td className="px-4 py-3">
                      {li.product_id ? (
                        <Link href={`/products/${li.product_id}`} className="text-blue-600 hover:underline font-medium">
                          {li.product_name || li.name || li.product_id}
                        </Link>
                      ) : (
                        <span>{li.product_name || li.name || 'N/A'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {li.serial_number ? (
                        <Link href={`/serials/${encodeURIComponent(li.serial_number)}`} className="text-blue-600 hover:underline font-mono text-xs">
                          {li.serial_number}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
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

      {invoice.originating_estimate && (
        <div className="mt-6 bg-white rounded border p-4">
          <h2 className="text-lg font-semibold mb-2">Originating Estimate</h2>
          <Link href={`/estimates/${invoice.originating_estimate.id}`} className="text-blue-600 hover:underline">
            Estimate #{invoice.originating_estimate.number}
          </Link>
          <span className="text-gray-500 text-sm ml-2">
            {invoice.originating_estimate.status} · ${parseFloat(invoice.originating_estimate.total || 0).toFixed(2)}
          </span>
        </div>
      )}

      {invoice.payments && invoice.payments.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-3">Payments ({invoice.payments.length})</h2>
          <div className="bg-white rounded border overflow-hidden">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b bg-gray-50">
                  <th className="px-4 py-3 text-xs font-medium uppercase">Ref</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase">Applied</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase">Amount</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invoice.payments.map((p: any) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3">
                      <Link href={`/payments/${p.id}`} className="text-blue-600 hover:underline font-mono">{p.ref_num || p.id}</Link>
                    </td>
                    <td className="px-4 py-3">{p.applied_at ? new Date(p.applied_at).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3">${parseFloat(p.payment_amount || 0).toFixed(2)}</td>
                    <td className="px-4 py-3">{p.payment_method || '—'}</td>
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
