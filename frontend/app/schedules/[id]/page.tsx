'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Badge from '../../../components/Badge';
import RawJsonView from '../../../components/RawJsonView';
import CollapsibleSection from '../../../components/CollapsibleSection';
import { usePageTitle } from '../../../lib/usePageTitle';
import { fetchJson, UnauthorizedError } from '../../../lib/fetch';

const API = '/api';

function fmtDate(s?: string | null) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString();
}
function fmtMoney(s?: string | null) {
  if (s == null || s === '') return '—';
  const n = parseFloat(s);
  if (isNaN(n)) return '—';
  return `$${n.toFixed(2)}`;
}
function Bool({ v }: { v: boolean }) {
  return v ? <span className="text-green-700">Yes</span> : <span className="text-gray-400">No</span>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-gray-500 text-xs uppercase tracking-wide">{label}</div>
      <div className="mt-0.5">{children ?? '—'}</div>
    </div>
  );
}

export default function ScheduleDetail() {
  const { id } = useParams();
  const [row, setRow] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetchJson(`${API}/schedules/${id}`)
      .then(setRow)
      .catch(e => { if (!(e instanceof UnauthorizedError)) setNotFound(true); });
  }, [id]);

  usePageTitle(row ? `${row.name || 'Schedule'} — Syncno` : null);

  if (notFound) return <p className="text-gray-500">Failed to load schedule.</p>;
  if (!row) return <p className="text-gray-500">Loading...</p>;

  const p = row.parsed || {};
  const lines = Array.isArray(p.lines) ? p.lines : [];

  const statusLabel = p.paused ? 'Paused' : (row.status || 'Active');

  return (
    <div className="max-w-6xl mx-auto">
      <Link href="/schedules" className="text-blue-600 hover:underline text-sm">← Back to Schedules</Link>

      <div className="mt-4 bg-white rounded border">
        {/* Header */}
        <div className="p-6 border-b flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">{row.name || `Schedule #${row.id}`}</h1>
            <p className="text-gray-500 mt-1 text-sm">
              {row.frequency || '—'}{p.next_run ? ` · next ${fmtDate(p.next_run)}` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <Badge variant={p.paused ? 'warning' : 'success'}>{statusLabel}</Badge>
            {p.last_invoice_paid && <Badge variant="info">Last invoice paid</Badge>}
          </div>
        </div>

        {/* Overview */}
        <CollapsibleSection title="Overview">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Field label="Schedule ID">{row.id}</Field>
            <Field label="Frequency">{row.frequency || '—'}</Field>
            <Field label="Next run">{fmtDate(p.next_run)}</Field>
            <Field label="Status">{statusLabel}</Field>
            <Field label="Subtotal (Syncro)">{p.subtotal_cents != null ? fmtMoney(String(p.subtotal_cents / 100)) : '—'}</Field>
            <Field label="Cost subtotal (calc)">{fmtMoney(p.subtotal_cost)}</Field>
            <Field label="Retail subtotal (calc)">{fmtMoney(p.subtotal_retail)}</Field>
            <Field label="Line items">{p.line_count ?? lines.length}</Field>
            <Field label="Account ID">{p.account_id ?? '—'}</Field>
            <Field label="Synced">{row.synced ? 'Yes' : 'No'}</Field>
          </div>
        </CollapsibleSection>

        {/* Flags */}
        <CollapsibleSection title="Flags">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Field label="Paused"><Bool v={!!p.paused} /></Field>
            <Field label="Email customer"><Bool v={!!p.email_customer} /></Field>
            <Field label="Snail mail"><Bool v={!!p.snail_mail} /></Field>
            <Field label="Charge MOP"><Bool v={!!p.charge_mop} /></Field>
            <Field label="Last invoice paid"><Bool v={!!p.last_invoice_paid} /></Field>
            <Field label="Invoice unbilled ticket charges"><Bool v={!!p.invoice_unbilled_ticket_charges} /></Field>
          </div>
        </CollapsibleSection>

        {/* Links */}
        {(row.invoice || row.customer) && (
          <CollapsibleSection title="Links">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <Field label="Customer">
                {row.customer ? (
                  <Link href={`/customers/${row.customer.id}`} className="text-blue-600 hover:underline">
                    {row.customer.display_name || `#${row.customer.id}`}
                  </Link>
                ) : '—'}
              </Field>
              <Field label="Invoice">
                {row.invoice ? (
                  <Link href={`/invoices/${row.invoice.id}`} className="text-blue-600 hover:underline">
                    {row.invoice.number || `#${row.invoice.id}`}
                  </Link>
                ) : '—'}
              </Field>
            </div>
          </CollapsibleSection>
        )}

        {/* Line items */}
        <CollapsibleSection title="Line items" count={lines.length}>
          {lines.length === 0 ? (
            <p className="text-sm text-gray-500">No line items.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 text-left">
                  <tr>
                    <th className="p-2">#</th>
                    <th className="p-2">Name</th>
                    <th className="p-2">Description</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2 text-right">Cost</th>
                    <th className="p-2 text-right">Retail</th>
                    <th className="p-2 text-right">Line cost</th>
                    <th className="p-2 text-right">Line retail</th>
                    <th className="p-2">Category</th>
                    <th className="p-2">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l: any, i: number) => {
                    const qty = parseFloat(l.quantity);
                    const lineCost = (l.cost != null && !isNaN(qty)) ? (parseFloat(l.cost) * qty).toFixed(2) : null;
                    const lineRetail = (l.retail != null && !isNaN(qty)) ? (parseFloat(l.retail) * qty).toFixed(2) : null;
                    return (
                      <tr key={l.id} className="border-t hover:bg-gray-50">
                        <td className="p-2 text-gray-500">{l.position ?? i + 1}</td>
                        <td className="p-2 font-medium">
                          {l.product_id ? (
                            <Link href={`/products/${l.product_id}`} className="text-blue-600 hover:underline">
                              {l.name || `#${l.product_id}`}
                            </Link>
                          ) : (l.name || '—')}
                        </td>
                        <td className="p-2 text-gray-600">{l.description || '—'}</td>
                        <td className="p-2 text-right">{l.quantity ?? '—'}</td>
                        <td className="p-2 text-right">{fmtMoney(l.cost)}</td>
                        <td className="p-2 text-right">{fmtMoney(l.retail)}</td>
                        <td className="p-2 text-right">{lineCost != null ? `$${lineCost}` : '—'}</td>
                        <td className="p-2 text-right">{lineRetail != null ? `$${lineRetail}` : '—'}</td>
                        <td className="p-2 text-gray-600 text-xs">{l.product_category || '—'}</td>
                        <td className="p-2 text-xs space-x-1">
                          {l.taxable && <Badge variant="info">Taxable</Badge>}
                          {l.one_time_charge && <Badge variant="warning">One-time</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-gray-50 font-semibold">
                  <tr>
                    <td colSpan={6} className="p-2 text-right">Totals</td>
                    <td className="p-2 text-right">{fmtMoney(p.subtotal_cost)}</td>
                    <td className="p-2 text-right">{fmtMoney(p.subtotal_retail)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CollapsibleSection>
      </div>

      <div className="mt-4">
        <RawJsonView rawJson={row.raw_json} label="Schedule Raw JSON" />
      </div>
    </div>
  );
}
