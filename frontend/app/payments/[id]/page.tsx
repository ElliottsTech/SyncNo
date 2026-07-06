'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Badge from '../../../components/Badge';
import RawJsonView from '../../../components/RawJsonView';
import { usePageTitle } from '../../../lib/usePageTitle';
import { fetchJson, UnauthorizedError } from '../../../lib/fetch';

const API = '/api';

export default function PaymentDetail() {
  const { id } = useParams();
  const [payment, setPayment] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetchJson(`${API}/payments/${id}`)
      .then(setPayment)
      .catch(e => { if (!(e instanceof UnauthorizedError)) setNotFound(true); });
  }, [id]);

  usePageTitle(payment ? `Payment ${payment.ref_num || payment.id} — Syncno` : null);

  if (notFound) return <p className="text-gray-500">Failed to load payment.</p>;
  if (!payment) return <p className="text-gray-500">Loading...</p>;

  const raw = payment.raw_json ? (typeof payment.raw_json === 'string' ? JSON.parse(payment.raw_json) : payment.raw_json) : null;
  const customer = typeof payment.customer === 'string' ? (() => { try { return JSON.parse(payment.customer); } catch (_) { return null; } })() : payment.customer;

  return (
    <div className="max-w-7xl mx-auto">
      <Link href="/invoices" className="text-blue-600 hover:underline text-sm">← Back to Invoices</Link>

      <div className="mt-4 bg-white rounded border">
        <div className="p-6 border-b">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={!!payment.synced}
              onChange={async (e) => {
                try {
                  await fetchJson(`${API}/sync/synced`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ table: 'payments', id: payment.id, synced: !payment.synced }),
                  });
                  const res = await fetchJson(`${API}/payments/${id}`);
                  setPayment(res);
                } catch (err) { if (!(err instanceof UnauthorizedError)) { /* keep current state */ } }
              }}
              className="w-5 h-5 cursor-pointer mt-1"
              title={payment.synced ? 'Synced — click to force re-sync' : 'Not synced'}
            />
            <div className="flex-1">
              <h1 className="text-xl font-bold">
                Payment <span className="font-mono">{payment.ref_num || `#${payment.id}`}</span>
              </h1>
              <p className="text-gray-500 mt-1">
                {payment.applied_at ? new Date(payment.applied_at).toLocaleDateString() : ''}
                {payment.payment_method ? ` · ${payment.payment_method}` : ''}
              </p>
            </div>
            <Badge variant={payment.success ? 'success' : 'danger'}>
              {payment.success ? 'SUCCESS' : 'FAILED'}
            </Badge>
          </div>
        </div>

        <div className="p-6 grid grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold mb-2">Details</h3>
            <p><span className="text-gray-500">Amount:</span> ${parseFloat(payment.payment_amount || 0).toFixed(2)}</p>
            <p><span className="text-gray-500">Method:</span> {payment.payment_method || '—'}</p>
            <p><span className="text-gray-500">Ref #:</span> <span className="font-mono">{payment.ref_num || '—'}</span></p>
            <p><span className="text-gray-500">Applied:</span> {payment.applied_at ? new Date(payment.applied_at).toLocaleString() : '—'}</p>
            <p><span className="text-gray-500">Created:</span> {payment.created_at ? new Date(payment.created_at).toLocaleString() : '—'}</p>
          </div>
          {customer && (
            <div>
              <h3 className="font-semibold mb-2">Customer</h3>
              {customer.id && (
                <Link href={`/customers/${customer.id}`} className="text-blue-600 hover:underline">
                  {customer.business_name || customer.fullname || `#${customer.id}`}
                </Link>
              )}
              {customer.email && <p><span className="text-gray-500">Email:</span> {customer.email}</p>}
              {customer.phone && <p><span className="text-gray-500">Phone:</span> {customer.phone}</p>}
            </div>
          )}
        </div>
      </div>

      {Array.isArray(payment.invoices) && payment.invoices.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-3">Applied to Invoices ({payment.invoices.length})</h2>
          <div className="bg-white rounded border overflow-hidden">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b bg-gray-50">
                  <th className="px-4 py-3 text-xs font-medium uppercase">Invoice #</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase">Date</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase">Total</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase">Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {payment.invoices.map((inv: any) => (
                  <tr key={inv.id}>
                    <td className="px-4 py-3">
                      <Link href={`/invoices/${inv.id}`} className="text-blue-600 hover:underline font-mono">{inv.number}</Link>
                    </td>
                    <td className="px-4 py-3">{inv.date ? new Date(inv.date).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3">${parseFloat(inv.total || 0).toFixed(2)}</td>
                    <td className="px-4 py-3">{inv.is_paid ? <Badge variant="success">Yes</Badge> : <Badge variant="warning">No</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <RawJsonView rawJson={payment.raw_json} label="Payment Raw JSON" />
    </div>
  );
}
