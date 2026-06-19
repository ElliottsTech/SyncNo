'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Badge from '../../../components/Badge';
import { usePageTitle } from '../../../lib/usePageTitle';
import RawJsonView from '../../../components/RawJsonView';

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

export default function TicketDetail() {
  const { id } = useParams();
  const [ticket, setTicket] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [timeEntries, setTimeEntries] = useState<any[]>([]);
  const [lineItems, setLineItems] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [estimates, setEstimates] = useState<any[]>([]);

  useEffect(() => {
    fetch(`${API}/tickets/${id}`)
      .then(r => r.json())
      .then(setTicket);

    fetch(`${API}/tickets/${id}/comments`)
      .then(r => r.json())
      .then(setComments);

    fetch(`${API}/tickets/${id}/time_entries`)
      .then(r => r.json())
      .then(setTimeEntries);

    fetch(`${API}/tickets/${id}/line_items`)
      .then(r => r.json())
      .then(setLineItems);

    fetch(`${API}/tickets/${id}/invoices`)
      .then(r => r.json())
      .then(setInvoices);

    fetch(`${API}/tickets/${id}/estimates`)
      .then(r => r.json())
      .then(setEstimates);
  }, [id]);

  usePageTitle(ticket ? `#${ticket.number} ${ticket.subject || ''} — Syncno` : null);

  if (!ticket) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="max-w-7xl mx-auto">
      <Link href="/tickets" className="text-blue-600 hover:underline text-sm">← Back to Tickets</Link>

      <div className="mt-4 bg-white rounded border">
        <div className="p-6 border-b">
          <div className="flex justify-between items-start">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={!!ticket.synced}
                onChange={async (e) => {
                  await fetch(`${API}/sync/synced`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ table: 'tickets', id: ticket.id, synced: !ticket.synced }),
                  });
                  const res = await fetch(`${API}/tickets/${id}`).then(r => r.json());
                  setTicket(res);
                }}
                className="w-5 h-5 cursor-pointer mt-1"
                title={ticket.synced ? 'Synced — click to force re-sync' : 'Not synced'}
              />
              <div>
                <h1 className="text-xl font-bold">{ticket.subject}</h1>
                <p className="text-gray-500 mt-1">
                  #{ticket.number} · {ticket.customer_business_then_name}
                </p>
              </div>
            </div>
            <Badge variant={ticket.status === 'New' ? 'info' : ticket.status === 'Resolved' ? 'success' : 'default'}>
              {ticket.status}
            </Badge>
          </div>

          <div className="flex gap-6 mt-4 text-sm text-gray-600">
            <span>Priority: {ticket.priority || 'N/A'}</span>
            <span>Created: {ticket.created_at ? new Date(ticket.created_at).toLocaleString() : 'N/A'}</span>
            {ticket.due_date && <span>Due: {new Date(ticket.due_date).toLocaleDateString()}</span>}
            {ticket.resolved_at && <span>Resolved: {new Date(ticket.resolved_at).toLocaleString()}</span>}
          </div>

          {ticket.user && typeof ticket.user === 'object' && (
            <div className="mt-4 flex items-center gap-3 p-3 bg-gray-50 rounded text-sm">
              {ticket.user.color && (
                <span
                  className="w-5 h-5 rounded-full border border-gray-300 shrink-0"
                  style={{ backgroundColor: '#' + ticket.user.color }}
                  title="User color"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900">{ticket.user.full_name || 'Unnamed'}</span>
                  {ticket.user.group && (
                    <span className="text-xs text-gray-700 bg-white border px-2 py-0.5 rounded">{ticket.user.group}</span>
                  )}
                  {ticket.user['admin?'] && (
                    <span className="text-xs text-purple-700 bg-purple-100 px-2 py-0.5 rounded">Admin</span>
                  )}
                </div>
                {ticket.user.email && (
                  <a href={`mailto:${ticket.user.email}`} className="text-blue-600 hover:underline text-xs">
                    {ticket.user.email}
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        <CollapsibleSection title="Invoices" count={invoices.length}>
          {invoices.length > 0 ? (
            <div className="space-y-2">
              {invoices.map((inv: any) => (
                <Link
                  key={inv.id}
                  href={`/invoices/${inv.id}`}
                  className="flex items-center justify-between gap-2 text-sm px-3 py-2 rounded border border-gray-200 hover:bg-gray-50"
                >
                  <span className="flex items-center gap-3">
                    <span className="font-mono">#{inv.number}</span>
                    <span className="text-gray-500">{inv.customer_business_then_name || ''}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    {inv.date && <span className="text-gray-500">{new Date(inv.date).toLocaleDateString()}</span>}
                    <span className="font-medium">{inv.total ? `$${inv.total}` : ''}</span>
                    {inv.is_paid ? (
                      <span className="text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded">PAID</span>
                    ) : inv.verified_paid ? (
                      <span className="text-xs text-blue-700 bg-blue-100 px-2 py-0.5 rounded">VERIFIED</span>
                    ) : (
                      <span className="text-xs text-orange-700 bg-orange-100 px-2 py-0.5 rounded">UNPAID</span>
                    )}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No invoices linked to this ticket</p>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Estimates" count={estimates.length}>
          {estimates.length > 0 ? (
            <div className="space-y-2">
              {estimates.map((est: any) => (
                <Link
                  key={est.id}
                  href={`/estimates/${est.id}`}
                  className="flex items-center justify-between gap-2 text-sm px-3 py-2 rounded border border-gray-200 hover:bg-gray-50"
                >
                  <span className="flex items-center gap-3">
                    <span className="font-mono">#{est.number}</span>
                    {est.status && <span className="text-xs text-gray-700 bg-gray-100 px-2 py-0.5 rounded">{est.status}</span>}
                  </span>
                  <span className="flex items-center gap-3">
                    {est.date && <span className="text-gray-500">{new Date(est.date).toLocaleDateString()}</span>}
                    <span className="font-medium">{est.total ? `$${est.total}` : ''}</span>
                    {est.invoice_id && <span className="text-xs text-blue-700 bg-blue-100 px-2 py-0.5 rounded">INVOICED</span>}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No estimates linked to this ticket</p>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Time Entries" count={timeEntries.length}>
          {timeEntries.length > 0 ? (
            <div className="space-y-3">
              {timeEntries.map((t: any, i: number) => (
                <div key={i} className="border rounded p-4">
                  <div className="flex justify-between text-sm text-gray-500 mb-2">
                    <span>{t.notes || 'No description'}</span>
                    <span>{t.billable ? 'Billable' : 'Non-billable'}</span>
                  </div>
                  <div className="flex gap-4 text-sm text-gray-600">
                    <span>Tech ID: {t.user_id || 'N/A'}</span>
                    <span>Start: {t.start_time ? new Date(t.start_time).toLocaleString() : 'N/A'}</span>
                    <span>End: {t.end_time ? new Date(t.end_time).toLocaleString() : 'N/A'}</span>
                    <span>Duration: {t.active_duration ? Math.round(t.active_duration / 60) + ' min' : 'N/A'}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No time entries</p>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Line Items" count={lineItems.length}>
          {lineItems.length > 0 ? (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2">Product</th>
                  <th className="pb-2">Serial</th>
                  <th className="pb-2">Description</th>
                  <th className="pb-2">Qty</th>
                  <th className="pb-2">Price</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li: any, i: number) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2">
                      {li.product_id ? (
                        <Link href={`/products/${li.product_id}`} className="text-blue-600 hover:underline font-medium">
                          {li.product_name || li.product_id}
                        </Link>
                      ) : (
                        <span className="text-gray-500">{li.product_name || 'N/A'}</span>
                      )}
                    </td>
                    <td className="py-2">
                      {li.serial_number ? (
                        <Link href={`/serials/${encodeURIComponent(li.serial_number)}`} className="text-blue-600 hover:underline font-mono text-xs">
                          {li.serial_number}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-2">{li.description || 'N/A'}</td>
                    <td className="py-2">{li.quantity || 0}</td>
                    <td className="py-2">{li.price ? '$' + li.price.toFixed(2) : 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-gray-500 text-sm">No line items</p>
          )}
        </CollapsibleSection>

        {comments.length > 0 && (
          <div className="p-6">
            <h2 className="font-semibold mb-4">Comments</h2>
            <div className="space-y-4">
              {comments.map((c: any, i: number) => (
                <div key={i} className="border rounded p-4">
                  <div className="flex justify-between text-sm text-gray-500 mb-2">
                    <span>{c.tech || c.user || c.author || 'Staff'}</span>
                    <span>{c.created_at ? new Date(c.created_at).toLocaleString() : ''}</span>
                  </div>
                  <p className="text-gray-800 whitespace-pre-wrap">{c.body || c.text || c.content || JSON.stringify(c)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <RawJsonView rawJson={ticket.raw_json} label="Ticket Raw JSON" />
    </div>
  );
}
