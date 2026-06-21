'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Badge from '../../../components/Badge';
import RawJsonView from '../../../components/RawJsonView';
import CollapsibleSection from '../../../components/CollapsibleSection';
import { usePageTitle } from '../../../lib/usePageTitle';

const API = '/api';

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>(\n)?/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <p>
      <span className="text-gray-500">{label}:</span>{' '}
      {value === null || value === undefined || value === '' ? <span className="text-gray-400">—</span> : String(value)}
    </p>
  );
}

export default function LeadDetail() {
  const { id } = useParams();
  const [row, setRow] = useState<any>(null);

  useEffect(() => {
    fetch(`${API}/leads/${id}`).then(r => r.json()).then(setRow);
  }, [id]);

  const displayName = row?.name || row?.business_then_name || 'Lead';
  usePageTitle(row ? `${displayName} — Syncno` : null);

  if (!row) return <p className="text-gray-500">Loading...</p>;

  const ticketDescriptionText = stripHtml(row.ticket_description || '');

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/leads" className="text-blue-600 hover:underline text-sm">← Back to Leads</Link>

      <div className="mt-4 bg-white rounded border">
        {/* Header */}
        <div className="p-6 border-b flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold">{displayName}</h1>
            <p className="text-gray-500 mt-1 text-sm">
              {row.email || ''}
              {row.email && (row.phone || row.mobile) ? ' · ' : ''}
              {[row.phone, row.mobile].filter(Boolean).join(' · ')}
            </p>
            <p className="text-gray-400 mt-1 text-xs">Lead #{row.id}</p>
            {row.ticket_id && (
              <p className="mt-2 text-sm">
                <span className="text-gray-500">Ticket:</span>{' '}
                <Link href={`/tickets/${row.ticket_id}`} className="text-blue-600 hover:underline font-medium">
                  {row.ticket_subject || row.ticket?.subject || `#${row.ticket_id}`}
                </Link>
                {row.ticket?.number && <span className="text-gray-500 ml-1">#{row.ticket.number}</span>}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {row.status && <Badge variant="info">{row.status}</Badge>}
            {row.has_attachments ? <Badge variant="warning">Attachments</Badge> : null}
            <Badge>{row.message_read ? 'Read' : 'Unread'}</Badge>
          </div>
        </div>

        {/* Contact details */}
        <CollapsibleSection title="Lead Details" defaultOpen>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Field label="First name" value={row.first_name} />
            <Field label="Last name" value={row.last_name} />
            <Field label="Email" value={row.email} />
            <Field label="Phone" value={row.phone} />
            <Field label="Mobile" value={row.mobile} />
            <Field label="Location" value={[row.city, row.state, row.zip].filter(Boolean).join(', ') || null} />
            <Field label="Created" value={row.created_at ? new Date(row.created_at).toLocaleString() : null} />
            <Field label="Updated" value={row.updated_at ? new Date(row.updated_at).toLocaleString() : null} />
          </div>
          {row.description && (
            <div className="mt-4">
              <h3 className="font-semibold mb-1 text-sm">Description</h3>
              <p className="text-sm whitespace-pre-wrap text-gray-700">{row.description}</p>
            </div>
          )}
        </CollapsibleSection>

        {/* Ticket */}
        {(row.ticket_id || row.ticket_subject || ticketDescriptionText) && (
          <CollapsibleSection title="Source Ticket" defaultOpen>
            <div className="space-y-2">
              <p>
                {row.ticket_id ? (
                  <Link href={`/tickets/${row.ticket_id}`} className="text-blue-600 hover:underline font-medium">
                    {row.ticket_subject || row.ticket?.subject || `(ticket #${row.ticket_id})`}
                  </Link>
                ) : (
                  <span className="font-medium">{row.ticket_subject}</span>
                )}
                {row.ticket?.number && (
                  <>
                    {' '}
                    <span className="text-gray-500 text-sm">#{row.ticket.number}</span>
                  </>
                )}
                {row.ticket?.status && <Badge variant="info">{row.ticket.status}</Badge>}
                {row.ticket?.priority && <Badge>{row.ticket.priority}</Badge>}
                {row.ticket_id && !row.ticket && (
                  <span className="text-gray-400 text-xs ml-2">(ticket {row.ticket_id} not in local DB)</span>
                )}
              </p>
              {row.ticket_problem_type && (
                <p className="text-sm"><span className="text-gray-500">Problem type:</span> {row.ticket_problem_type}</p>
              )}
              {row.ticket?.customer_business_then_name && (
                <p className="text-sm"><span className="text-gray-500">Customer on ticket:</span> {row.ticket.customer_business_then_name}</p>
              )}
              {row.ticket?.created_at && (
                <p className="text-sm"><span className="text-gray-500">Ticket created:</span> {new Date(row.ticket.created_at).toLocaleString()}</p>
              )}
              {ticketDescriptionText && (
                <div className="mt-2">
                  <h3 className="font-semibold mb-1 text-sm">Ticket description</h3>
                  <div className="text-sm whitespace-pre-wrap text-gray-700 bg-gray-50 border rounded p-3 max-h-80 overflow-y-auto">
                    {ticketDescriptionText}
                  </div>
                </div>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* Customer */}
        {row.customer && (
          <CollapsibleSection title="Customer">
            <div className="space-y-1">
              <Link href={`/customers/${row.customer.id}`} className="text-blue-600 hover:underline font-medium">
                {row.customer.display_name || `#${row.customer.id}`}
              </Link>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <Field label="Email" value={row.customer.email} />
                <Field label="Phone" value={row.customer.phone} />
                <Field label="Location" value={[row.customer.city, row.customer.state].filter(Boolean).join(', ') || null} />
              </div>
            </div>
          </CollapsibleSection>
        )}

        {/* Contact */}
        {row.contact && (
          <CollapsibleSection title="Contact">
            <div className="space-y-1">
              <p className="font-medium">{row.contact.name || `#${row.contact.id}`}</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <Field label="Email" value={row.contact.email} />
                <Field label="Phone" value={row.contact.phone} />
                <Field label="Mobile" value={row.contact.mobile} />
              </div>
            </div>
          </CollapsibleSection>
        )}

        {/* Mailbox */}
        {row.mailbox_name && (
          <CollapsibleSection title="Mailbox">
            <div className="text-sm">
              <Field label="Mailbox" value={row.mailbox_name} />
              {row.mailbox_id && <Field label="Mailbox ID" value={row.mailbox_id} />}
            </div>
          </CollapsibleSection>
        )}
      </div>

      <RawJsonView rawJson={row.raw_json} label="Lead Raw JSON" />
    </div>
  );
}
