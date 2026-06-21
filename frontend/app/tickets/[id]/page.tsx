'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Badge from '../../../components/Badge';
import { usePageTitle } from '../../../lib/usePageTitle';
import RawJsonView from '../../../components/RawJsonView';
import CollapsibleSection from '../../../components/CollapsibleSection';

const API = '/api';

function relTime(s?: string | null) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  const future = sec < 0;
  const abs = Math.abs(sec);
  let str: string;
  if (abs < 60) str = 'just now';
  else if (abs < 3600) str = `${Math.floor(abs / 60)}m`;
  else if (abs < 86400) str = `${Math.floor(abs / 3600)}h`;
  else if (abs < 2592000) str = `${Math.floor(abs / 86400)}d`;
  else if (abs < 31536000) str = `${Math.floor(abs / 2592000)}mo`;
  else str = `${Math.floor(abs / 31536000)}y`;
  return future ? `in ${str}` : `${str} ago`;
}

function fmtDate(s?: string | null) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString();
}
function fmtDateTime(s?: string | null) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString();
}
function fmtDuration(min?: number | null) {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
function fmtMoney(n?: number | string | null) {
  if (n == null || n === '') return '';
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(v)) return '';
  return `$${v.toFixed(2)}`;
}

function priorityVariant(p?: string | null): 'danger' | 'warning' | 'default' {
  if (!p) return 'default';
  if (/^1|critical/i.test(p)) return 'danger';
  if (/^2|high/i.test(p)) return 'warning';
  return 'default';
}
function statusVariant(s?: string | null): 'info' | 'success' | 'warning' | 'danger' | 'default' {
  if (!s) return 'default';
  if (s === 'New') return 'info';
  if (s === 'Resolved' || s === 'Closed') return 'success';
  if (s === 'In Progress') return 'warning';
  if (/waiting|hold|pending/i.test(s)) return 'danger';
  return 'default';
}
function isOverdue(row: any) {
  if (!row?.due_date) return false;
  if (['Resolved', 'Closed'].includes(row?.status)) return false;
  return new Date(row.due_date).getTime() < Date.now();
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <div className="text-gray-500 text-xs uppercase tracking-wide">{label}</div>
      <div className="mt-0.5 text-sm" title={hint}>{children ?? '—'}</div>
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
  const [appointments, setAppointments] = useState<any[]>([]);
  const [worksheets, setWorksheets] = useState<any[]>([]);
  const [attachments, setAttachments] = useState<any[]>(null);
  const [attachmentsMeta, setAttachmentsMeta] = useState<{ count: number, synced_at: string | null }>({ count: 0, synced_at: null });
  const [openWorksheet, setOpenWorksheet] = useState<number | null>(null);
  const [worksheetDetail, setWorksheetDetail] = useState<any>(null);

  useEffect(() => {
    fetch(`${API}/tickets/${id}`).then(r => r.json()).then(setTicket);
    fetch(`${API}/tickets/${id}/comments`).then(r => r.json()).then(setComments);
    fetch(`${API}/tickets/${id}/time_entries`).then(r => r.json()).then(setTimeEntries);
    fetch(`${API}/tickets/${id}/line_items`).then(r => r.json()).then(setLineItems);
    fetch(`${API}/tickets/${id}/invoices`).then(r => r.json()).then(setInvoices);
    fetch(`${API}/tickets/${id}/estimates`).then(r => r.json()).then(setEstimates);
    fetch(`${API}/tickets/${id}/appointments`).then(r => r.json()).then(setAppointments);
    fetch(`${API}/tickets/${id}/worksheet_results`).then(r => r.json()).then(setWorksheets);
    fetch(`${API}/tickets/${id}/attachments`)
      .then(r => r.json())
      .then(d => {
        setAttachments(Array.isArray(d?.data) ? d.data : []);
        setAttachmentsMeta({ count: d?.attachments_count || 0, synced_at: d?.attachments_synced_at || null });
      });
  }, [id]);

  const openWorksheetDetail = (wid: number) => {
    if (openWorksheet === wid) {
      setOpenWorksheet(null);
      setWorksheetDetail(null);
      return;
    }
    setOpenWorksheet(wid);
    setWorksheetDetail(null);
    fetch(`${API}/tickets/${id}/worksheet_results/${wid}`).then(r => r.json()).then(setWorksheetDetail);
  };

  const toggleSynced = async () => {
    await fetch(`${API}/sync/synced`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: 'tickets', id: ticket.id, synced: !ticket.synced }),
    });
    const res = await fetch(`${API}/tickets/${id}`).then(r => r.json());
    setTicket(res);
  };

  usePageTitle(ticket ? `#${ticket.number} ${ticket.subject || ''} — Syncno` : null);

  if (!ticket) return <p className="text-gray-500">Loading...</p>;

  // Pull embedded entities + extras from raw_json if present
  let raw: any = null;
  try { raw = ticket.raw_json ? JSON.parse(ticket.raw_json) : null; } catch { raw = null; }
  const embeddedAssets = Array.isArray(raw?.assets) ? raw.assets : [];
  const embeddedCustomer = raw?.customer || null;
  const embeddedContact = raw?.contact || null;
  const ticketType = raw?.ticket_type?.name || null;
  const tagList = Array.isArray(raw?.tag_list) ? raw.tag_list : [];
  const assetIds = Array.isArray(raw?.asset_ids) ? raw.asset_ids : [];
  const signatureName = raw?.signature_name || null;
  const signatureDate = raw?.signature_date || null;
  const address = raw?.address || embeddedCustomer?.address || null;
  const pdfUrl = raw?.pdf_url || ticket.pdf_url || null;
  const properties = raw?.properties && typeof raw.properties === 'object' ? raw.properties : {};

  const overdue = isOverdue(ticket);
  const totalTimeMin = timeEntries.reduce((s: number, t: any) => s + (t.active_duration ? t.active_duration / 60 : 0), 0);
  const billableTimeMin = timeEntries
    .filter((t: any) => t.billable)
    .reduce((s: number, t: any) => s + (t.active_duration ? t.active_duration / 60 : 0), 0);

  return (
    <div className="max-w-7xl mx-auto">
      <Link href="/tickets" className="text-blue-600 hover:underline text-sm">← Back to Tickets</Link>

      <div className="mt-4 bg-white rounded border">
        {/* Header */}
        <div className="p-6 border-b">
          <div className="flex justify-between items-start gap-4">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <input
                type="checkbox"
                checked={!!ticket.synced}
                onChange={toggleSynced}
                className="w-5 h-5 cursor-pointer mt-1"
                title={ticket.synced ? 'Synced — click to force re-sync' : 'Not synced'}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-gray-500">#{ticket.number}</span>
                  {ticketType && <Badge variant="info">{ticketType}</Badge>}
                  {ticket.problem_type && <Badge variant="default">{ticket.problem_type}</Badge>}
                  {tagList.map((t: string, i: number) => (
                    <span key={i} className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded">{t}</span>
                  ))}
                </div>
                <h1 className="text-xl font-bold mt-1 break-words">{ticket.subject}</h1>
                <p className="text-gray-500 mt-1 text-sm">
                  <Link href={`/customers/${ticket.customer_id}`} className="text-blue-600 hover:underline">
                    {ticket.customer_business_then_name}
                  </Link>
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <Badge variant={statusVariant(ticket.status)}>{ticket.status || '—'}</Badge>
              {ticket.priority && <Badge variant={priorityVariant(ticket.priority)}>{ticket.priority}</Badge>}
              {overdue && <Badge variant="danger">⚠ Overdue</Badge>}
              {pdfUrl && (
                <a href={pdfUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">
                  ↓ PDF
                </a>
              )}
            </div>
          </div>

          {/* Quick info grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mt-5">
            <Field label="Created" hint={fmtDateTime(ticket.created_at)}>{relTime(ticket.created_at)}</Field>
            <Field label="Updated" hint={fmtDateTime(ticket.updated_at)}>{relTime(ticket.updated_at)}</Field>
            <Field label="Due" hint={fmtDateTime(ticket.due_date)}>
              {ticket.due_date ? (
                <span className={overdue ? 'text-red-600 font-medium' : ''}>{relTime(ticket.due_date)}</span>
              ) : '—'}
            </Field>
            <Field label="Resolved" hint={fmtDateTime(ticket.resolved_at)}>
              {ticket.resolved_at ? relTime(ticket.resolved_at) : '—'}
            </Field>
            <Field label="Time logged">{timeEntries.length ? fmtDuration(totalTimeMin) : '—'}</Field>
            <Field label="Billable">{billableTimeMin ? fmtDuration(billableTimeMin) : '—'}</Field>
          </div>

          {/* Assigned tech + customer card */}
          <div className="grid md:grid-cols-2 gap-3 mt-5">
            {ticket.user && typeof ticket.user === 'object' && (
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded text-sm">
                {ticket.user.color && (
                  <span
                    className="w-8 h-8 rounded-full border border-gray-300 shrink-0 flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: '#' + ticket.user.color }}
                    title="User color"
                  >
                    {(ticket.user.full_name || '?').slice(0, 1)}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Assigned</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900">{ticket.user.full_name || 'Unnamed'}</span>
                    {ticket.user.group && (
                      <span className="text-xs text-gray-700 bg-white border px-2 py-0.5 rounded">{ticket.user.group}</span>
                    )}
                    {ticket.user['admin?'] && <Badge variant="info">Admin</Badge>}
                  </div>
                  {ticket.user.email && (
                    <a href={`mailto:${ticket.user.email}`} className="text-blue-600 hover:underline text-xs">
                      {ticket.user.email}
                    </a>
                  )}
                </div>
              </div>
            )}

            {embeddedCustomer && (
              <div className="p-3 bg-gray-50 rounded text-sm">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Customer</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {embeddedCustomer.phone && (
                    <a href={`tel:${embeddedCustomer.phone}`} className="text-blue-600 hover:underline">
                      ☎ {embeddedCustomer.phone}
                    </a>
                  )}
                  {embeddedCustomer.mobile && embeddedCustomer.mobile !== embeddedCustomer.phone && (
                    <a href={`tel:${embeddedCustomer.mobile}`} className="text-blue-600 hover:underline">
                      📱 {embeddedCustomer.mobile}
                    </a>
                  )}
                  {embeddedCustomer.email && (
                    <a href={`mailto:${embeddedCustomer.email}`} className="text-blue-600 hover:underline break-all">
                      ✉ {embeddedCustomer.email}
                    </a>
                  )}
                </div>
                {address && <div className="text-xs text-gray-600 mt-1">📍 {address}</div>}
              </div>
            )}
          </div>

          {(signatureName || Object.keys(properties).length > 0 || assetIds.length > 0) && (
            <div className="grid md:grid-cols-3 gap-3 mt-3 text-sm">
              {signatureName && (
                <div className="p-2 border rounded">
                  <div className="text-xs text-gray-500 uppercase">Signed</div>
                  <div>{signatureName}{signatureDate ? ` · ${fmtDate(signatureDate)}` : ''}</div>
                </div>
              )}
              {assetIds.length > 0 && (
                <div className="p-2 border rounded">
                  <div className="text-xs text-gray-500 uppercase">Asset IDs</div>
                  <div className="text-xs">{assetIds.join(', ')}</div>
                </div>
              )}
              {Object.keys(properties).length > 0 && (
                <div className="p-2 border rounded">
                  <div className="text-xs text-gray-500 uppercase">Properties</div>
                  <div className="text-xs">{Object.keys(properties).length} field(s)</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Assets */}
        <CollapsibleSection title="Assets" count={embeddedAssets.length} defaultOpen={embeddedAssets.length > 0}>
          {embeddedAssets.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-2">
              {embeddedAssets.map((a: any) => (
                <Link
                  key={a.id}
                  href={`/assets/${a.id}`}
                  className="flex items-center justify-between gap-2 text-sm px-3 py-2 rounded border border-gray-200 hover:bg-gray-50"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate">{a.name || 'Unnamed'}</span>
                    {a.asset_type && <Badge variant="default">{a.asset_type}</Badge>}
                  </span>
                  <span className="text-xs text-gray-500 shrink-0">
                    {a.properties?.Make || ''} {a.properties?.Model || ''}
                    {a.asset_serial && <span className="font-mono ml-2">{a.asset_serial}</span>}
                  </span>
                </Link>
              ))}
            </div>
          ) : <p className="text-gray-500 text-sm">No assets linked to this ticket</p>}
        </CollapsibleSection>

        {/* Invoices */}
        <CollapsibleSection title="Invoices" count={invoices.length} defaultOpen={invoices.length > 0}>
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
                    {inv.date && <span className="text-gray-500">{fmtDate(inv.date)}</span>}
                    <span className="font-medium">{fmtMoney(inv.total)}</span>
                    {inv.is_paid ? <Badge variant="success">PAID</Badge>
                      : inv.verified_paid ? <Badge variant="info">VERIFIED</Badge>
                      : <Badge variant="warning">UNPAID</Badge>}
                  </span>
                </Link>
              ))}
            </div>
          ) : <p className="text-gray-500 text-sm">No invoices linked to this ticket</p>}
        </CollapsibleSection>

        {/* Estimates */}
        <CollapsibleSection title="Estimates" count={estimates.length} defaultOpen={estimates.length > 0}>
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
                    {est.status && <Badge variant="default">{est.status}</Badge>}
                  </span>
                  <span className="flex items-center gap-3">
                    {est.date && <span className="text-gray-500">{fmtDate(est.date)}</span>}
                    <span className="font-medium">{fmtMoney(est.total)}</span>
                    {est.invoice_id && <Badge variant="info">INVOICED</Badge>}
                  </span>
                </Link>
              ))}
            </div>
          ) : <p className="text-gray-500 text-sm">No estimates linked to this ticket</p>}
        </CollapsibleSection>

        {/* Appointments */}
        <CollapsibleSection title="Appointments" count={appointments.length} defaultOpen={appointments.length > 0}>
          {appointments.length > 0 ? (
            <div className="space-y-2">
              {appointments.map((a: any) => (
                <Link
                  key={a.id}
                  href={`/appointments/${a.id}`}
                  className="flex items-center justify-between gap-2 text-sm px-3 py-2 rounded border border-gray-200 hover:bg-gray-50"
                >
                  <span className="flex items-center gap-3">
                    <span className="font-medium">{a.summary || '(untitled)'}</span>
                    {a.all_day && <Badge variant="default">ALL DAY</Badge>}
                  </span>
                  <span className="flex items-center gap-3">
                    {a.start_at && <span className="text-gray-500">{fmtDateTime(a.start_at)}</span>}
                    {a.location && <span className="text-gray-500">{a.location}</span>}
                  </span>
                </Link>
              ))}
            </div>
          ) : <p className="text-gray-500 text-sm">No appointments linked to this ticket</p>}
        </CollapsibleSection>

        {/* Worksheets */}
        <CollapsibleSection title="Worksheets" count={worksheets.length} defaultOpen={worksheets.length > 0}>
          {worksheets.length > 0 ? (
            <div className="space-y-2">
              {worksheets.map((w: any) => (
                <div key={w.id} className="border border-gray-200 rounded">
                  <button
                    onClick={() => openWorksheetDetail(w.id)}
                    className="w-full flex justify-between items-center px-3 py-2 text-sm hover:bg-gray-50 text-left"
                  >
                    <span className="font-medium">{w.name || `#${w.id}`}</span>
                    <span className="flex items-center gap-3">
                      {w.created_at && <span className="text-gray-500">{fmtDateTime(w.created_at)}</span>}
                      <span className="text-gray-400">{openWorksheet === w.id ? '▲' : '▼'}</span>
                    </span>
                  </button>
                  {openWorksheet === w.id && (
                    <div className="border-t p-3 bg-gray-50">
                      {worksheetDetail ? (
                        <div className="space-y-2">
                          {worksheetDetail.body && (
                            <div className="text-sm whitespace-pre-wrap bg-white border rounded p-3">{worksheetDetail.body}</div>
                          )}
                          {worksheetDetail.result && (
                            <div className="text-sm whitespace-pre-wrap bg-white border rounded p-3">
                              <span className="text-gray-500 font-semibold">Result: </span>{worksheetDetail.result}
                            </div>
                          )}
                          <details className="text-xs">
                            <summary className="cursor-pointer text-gray-500">Raw JSON</summary>
                            <pre className="mt-2 bg-white border rounded p-2 overflow-x-auto">{worksheetDetail.raw_json || ''}</pre>
                          </details>
                        </div>
                      ) : <p className="text-sm text-gray-500">Loading...</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : <p className="text-gray-500 text-sm">No worksheets</p>}
        </CollapsibleSection>

        {/* Time entries */}
        <CollapsibleSection title="Time entries" count={timeEntries.length} defaultOpen={timeEntries.length > 0}>
          {timeEntries.length > 0 ? (
            <div className="space-y-2">
              <div className="flex gap-4 text-sm text-gray-600 pb-2 border-b">
                <span>Total: <strong>{fmtDuration(totalTimeMin)}</strong></span>
                <span>Billable: <strong>{fmtDuration(billableTimeMin)}</strong></span>
                <span>Entries: <strong>{timeEntries.length}</strong></span>
              </div>
              {timeEntries.map((t: any, i: number) => (
                <div key={i} className="border rounded p-3">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-gray-800">{t.notes || 'No description'}</span>
                    <span className="flex items-center gap-2">
                      {t.billable ? <Badge variant="success">Billable</Badge> : <Badge variant="default">Non-billable</Badge>}
                      <span className="font-medium">{fmtDuration(t.active_duration ? t.active_duration / 60 : null)}</span>
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    <span>Tech: {t.user_id || '—'}</span>
                    <span title={fmtDateTime(t.start_time)}>Start: {t.start_time ? relTime(t.start_time) : '—'}</span>
                    <span title={fmtDateTime(t.end_time)}>End: {t.end_time ? relTime(t.end_time) : '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-gray-500 text-sm">No time entries</p>}
        </CollapsibleSection>

        {/* Line items */}
        <CollapsibleSection title="Line items" count={lineItems.length} defaultOpen={lineItems.length > 0}>
          {lineItems.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 text-left">
                  <tr>
                    <th className="p-2">Product</th>
                    <th className="p-2">Serial</th>
                    <th className="p-2">Description</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2 text-right">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((li: any, i: number) => (
                    <tr key={i} className="border-t hover:bg-gray-50">
                      <td className="p-2">
                        {li.product_id ? (
                          <Link href={`/products/${li.product_id}`} className="text-blue-600 hover:underline font-medium">
                            {li.product_name || li.product_id}
                          </Link>
                        ) : <span className="text-gray-500">{li.product_name || '—'}</span>}
                      </td>
                      <td className="p-2">
                        {li.serial_number ? (
                          <Link href={`/serials/${encodeURIComponent(li.serial_number)}`} className="text-blue-600 hover:underline font-mono text-xs">
                            {li.serial_number}
                          </Link>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="p-2">{li.description || '—'}</td>
                      <td className="p-2 text-right">{li.quantity || 0}</td>
                      <td className="p-2 text-right">{li.price ? '$' + li.price.toFixed(2) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-gray-500 text-sm">No line items</p>}
        </CollapsibleSection>

        {/* Comments */}
        <CollapsibleSection title="Comments" count={comments.length} defaultOpen={comments.length > 0}>
            <div className="space-y-3">
              {comments.map((c: any, i: number) => {
                const isAutomation = /automation|auto-assign|auto assigned/i.test(c.subject || '') || /automation/i.test(c.tech || '');
                const author = c.tech || c.user || c.author || (isAutomation ? 'Automation' : 'Staff');
                return (
                  <div key={i} className={`border rounded p-3 ${isAutomation ? 'bg-gray-50 border-gray-200' : 'bg-white'}`}>
                    <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                      <span className="flex items-center gap-2">
                        <span className="font-medium text-gray-700">{author}</span>
                        {isAutomation && <Badge variant="default">Auto</Badge>}
                        {c.subject && !isAutomation && <span className="text-gray-500">· {c.subject}</span>}
                      </span>
                      <span title={fmtDateTime(c.created_at)}>{c.created_at ? relTime(c.created_at) : ''}</span>
                    </div>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{c.body || c.text || c.content || JSON.stringify(c)}</p>
                  </div>
                );
              })}
            </div>
          </CollapsibleSection>

        {/* Attachments — hidden entirely until first sync has checked this ticket. */}
        {attachments && attachmentsMeta.synced_at && (
          <CollapsibleSection
            title="Attachments"
            count={attachments.length}
            defaultOpen={attachments.length > 0}
          >
            {attachments.length === 0 ? (
              <p className="text-sm text-gray-500">No attachments on disk.</p>
            ) : (
              <ul className="divide-y">
                {attachments.map((a: any, i: number) => (
                  <li key={i} className="py-2 flex items-center gap-3 text-sm">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-gray-400 shrink-0" aria-hidden>
                      <path d="M11.5 4.5L5 11a2 2 0 102.83 2.83L13.5 8.5a3.5 3.5 0 00-4.95-4.95L3.4 8.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <a href={a.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-medium flex-1 truncate">
                      {a.name}
                    </a>
                    <span className="text-gray-500 text-xs whitespace-nowrap">
                      {a.content_type || 'unknown'}
                    </span>
                    <span className="text-gray-400 text-xs whitespace-nowrap">
                      {a.size < 1024 ? `${a.size} B`
                        : a.size < 1024 * 1024 ? `${(a.size / 1024).toFixed(1)} KB`
                        : `${(a.size / 1024 / 1024).toFixed(1)} MB`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {attachmentsMeta.synced_at && (
              <p className="mt-2 text-xs text-gray-400">
                Synced {new Date(attachmentsMeta.synced_at).toLocaleString()}
              </p>
            )}
          </CollapsibleSection>
        )}
      </div>

      <div className="mt-4">
        <RawJsonView rawJson={ticket.raw_json} label="Ticket Raw JSON" />
      </div>
    </div>
  );
}
