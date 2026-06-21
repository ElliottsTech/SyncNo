'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Badge from '../../../components/Badge';
import RawJsonView from '../../../components/RawJsonView';
import CollapsibleSection from '../../../components/CollapsibleSection';
import { usePageTitle } from '../../../lib/usePageTitle';

const API = '/api';

export default function AppointmentDetail() {
  const { id } = useParams();
  const [appt, setAppt] = useState<any>(null);

  useEffect(() => {
    fetch(`${API}/appointments/${id}`)
      .then(r => r.json())
      .then(setAppt);
  }, [id]);

  usePageTitle(appt ? `${appt.summary || 'Appointment'} — Syncno` : null);

  if (!appt) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/appointments" className="text-blue-600 hover:underline text-sm">← Back to Appointments</Link>

      <div className="mt-4 bg-white rounded border">
        <div className="p-6 border-b">
          <h1 className="text-xl font-bold">{appt.summary || '(untitled)'}</h1>
          <p className="text-gray-500 mt-1">
            {appt.all_day ? 'All day' : (
              appt.start_at ? new Date(appt.start_at).toLocaleString() : ''
            )}
            {!appt.all_day && appt.end_at ? ` → ${new Date(appt.end_at).toLocaleString()}` : ''}
            {appt.location ? ` · ${appt.location}` : ''}
          </p>
        </div>

        <CollapsibleSection title="Details">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <p><span className="text-gray-500">Start:</span> {appt.start_at ? new Date(appt.start_at).toLocaleString() : '—'}</p>
            <p><span className="text-gray-500">End:</span> {appt.end_at ? new Date(appt.end_at).toLocaleString() : '—'}</p>
            <p><span className="text-gray-500">Duration:</span> {appt.duration != null ? `${appt.duration}m` : '—'}</p>
            <p><span className="text-gray-500">Location:</span> {appt.location || '—'}</p>
            <p><span className="text-gray-500">Type:</span> {appt.appointment_location_type || '—'}</p>
            <p><span className="text-gray-500">All Day:</span> {appt.all_day ? 'Yes' : 'No'}</p>
            <p><span className="text-gray-500">Created:</span> {appt.created_at ? new Date(appt.created_at).toLocaleString() : '—'}</p>
            <p><span className="text-gray-500">Updated:</span> {appt.updated_at ? new Date(appt.updated_at).toLocaleString() : '—'}</p>
          </div>
          {appt.description && (
            <div className="mt-4">
              <h3 className="font-semibold mb-1">Description</h3>
              <p className="text-sm whitespace-pre-wrap">{appt.description}</p>
            </div>
          )}
        </CollapsibleSection>

        {(appt.ticket || appt.customer) && (
          <CollapsibleSection title="Links">
            <div className="space-y-2 text-sm">
              {appt.ticket && (
                <p>
                  <span className="text-gray-500">Ticket:</span>{' '}
                  <Link href={`/tickets/${appt.ticket.id}`} className="text-blue-600 hover:underline">
                    #{appt.ticket.number} {appt.ticket.subject}
                  </Link>
                  {' '}<Badge variant="info">{appt.ticket.status}</Badge>
                </p>
              )}
              {appt.customer && (
                <p>
                  <span className="text-gray-500">Customer:</span>{' '}
                  <Link href={`/customers/${appt.customer.id}`} className="text-blue-600 hover:underline">
                    {appt.customer.display_name || `#${appt.customer.id}`}
                  </Link>
                </p>
              )}
            </div>
          </CollapsibleSection>
        )}
      </div>

      <RawJsonView rawJson={appt.raw_json} label="Appointment Raw JSON" />
    </div>
  );
}
