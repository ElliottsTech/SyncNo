'use client';
import { useState, useEffect, Fragment } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Badge from '../../../components/Badge';
import CollapsibleSection from '../../../components/CollapsibleSection';
import RawJsonView from '../../../components/RawJsonView';
import { fetchJson, UnauthorizedError } from '../../../lib/fetch';

const API = '/api';

export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const [po, setPo] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);
  const [expandedItem, setExpandedItem] = useState<number | null>(null);
  const [attachments, setAttachments] = useState<any[] | null>(null);
  const [attachmentsMeta, setAttachmentsMeta] = useState<{ count: number, synced_at: string | null }>({ count: 0, synced_at: null });
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncSource, setSyncSource] = useState<'syncro' | 'qbo'>('syncro');

  useEffect(() => {
    fetchJson(`${API}/purchase-orders/${id}`)
      .then(setPo)
      .catch(e => { if (!(e instanceof UnauthorizedError)) setNotFound(true); });
    fetchJson(`${API}/purchase-orders/${id}/attachments`)
      .then(d => {
        setAttachments(Array.isArray(d?.data) ? d.data : []);
        setAttachmentsMeta({ count: d?.attachments_count || 0, synced_at: d?.attachments_synced_at || null });
      })
      .catch(e => { if (!(e instanceof UnauthorizedError)) { setAttachments([]); } });
  }, [id]);

  const refreshAttachments = async () => {
    try {
      const d = await fetchJson(`${API}/purchase-orders/${id}/attachments`);
      setAttachments(Array.isArray(d?.data) ? d.data : []);
      setAttachmentsMeta({ count: d?.attachments_count || 0, synced_at: d?.attachments_synced_at || null });
    } catch (e) { if (!(e instanceof UnauthorizedError)) { /* keep */ } }
  };

  const fetchAttachments = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await fetch(`${API}/purchase-orders/${id}/sync-attachments?source=${syncSource}`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setSyncMsg(d.error || `Failed (HTTP ${r.status})`);
      } else {
        setSyncMsg(
          d.matched === false
            ? 'No matching QuickBooks PO found for this PO number.'
            : d.message || `Pulled ${d.downloaded || 0} new attachment(s)${d.skipped ? `, ${d.skipped} already on disk` : ''}${d.errors?.length ? `, ${d.errors.length} error(s)` : ''}.`
        );
        await refreshAttachments();
      }
    } catch (e: any) {
      setSyncMsg(e.message || 'Failed to fetch attachments.');
    } finally {
      setSyncing(false);
    }
  };

  if (notFound) return <p className="text-gray-500">Failed to load purchase order.</p>;
  if (!po) return <p className="text-gray-500">Loading...</p>;

  const lineItems = Array.isArray(po.line_items) ? po.line_items : [];
  const vendor = typeof po.vendor === 'object' ? po.vendor : null;

  return (
    <div className="max-w-7xl mx-auto">
      <Link href="/purchase-orders" className="text-blue-600 hover:underline text-sm">← Back to Purchase Orders</Link>

      <div className="mt-4 bg-white rounded border">
        <div className="p-6 border-b">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={!!po.synced}
              onChange={async (e) => {
                try {
                  await fetchJson(`${API}/sync/synced`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ table: 'purchase_orders', id: po.id, synced: !po.synced }),
                  });
                  const res = await fetchJson(`${API}/purchase-orders/${id}`);
                  setPo(res);
                } catch (err) { if (!(err instanceof UnauthorizedError)) { /* keep current state */ } }
              }}
              className="w-5 h-5 cursor-pointer mt-1"
              title={po.synced ? 'Synced — click to force re-sync' : 'Not synced'}
            />
            <div className="flex-1">
              <h1 className="text-xl font-bold">PO #{po.number}</h1>
              {vendor && <p className="text-gray-500 mt-1">Vendor: {vendor.name}</p>}
            </div>
            <a
              href={`${API}/purchase-orders/${po.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm px-3 py-2 rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 whitespace-nowrap"
              title="Generate and download a purchase order PDF"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
                <path d="M8 1.5v9M8 10.5L5 7.5M8 10.5L11 7.5M2.5 13h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Download PDF
            </a>
            <Badge>{po.status}</Badge>
          </div>
        </div>

        <div className="p-6 grid grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold mb-2">Details</h3>
            <p><span className="text-gray-500">Created:</span> {po.created_at ? new Date(po.created_at).toLocaleDateString() : ''}</p>
            <p><span className="text-gray-500">Due:</span> {po.due_date ? new Date(po.due_date).toLocaleDateString() : ''}</p>
            <p><span className="text-gray-500">Paid:</span> {po.paid_date ? new Date(po.paid_date).toLocaleDateString() : 'N/A'}</p>
            <p className="text-lg font-semibold mt-2">Total: {po.total}</p>
          </div>
          {vendor && (
            <div>
              <h3 className="font-semibold mb-2">Vendor Contact</h3>
              <p>{vendor.name}</p>
              <p>{vendor.rep_first_name} {vendor.rep_last_name}</p>
              <p>{vendor.email}</p>
              <p>{vendor.phone}</p>
            </div>
          )}
        </div>
      </div>

      {lineItems.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-3">Line Items</h2>
          <div className="bg-white rounded border overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Qty</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cost</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {lineItems.map((item: any, i: number) => {
                  const hasSerials = item.serials && item.serials.length > 0;
                  const isOpen = expandedItem === i;
                  return (
                    <Fragment key={i}>
                      <tr className={hasSerials ? 'cursor-pointer hover:bg-gray-50' : ''} onClick={hasSerials ? () => setExpandedItem(isOpen ? null : i) : undefined}>
                        <td className="px-4 py-3 text-sm">
                          {hasSerials && (
                            <span className="inline-block w-4 text-gray-400 select-none">{isOpen ? '▼' : '▶'}</span>
                          )}
                          {!hasSerials && <span className="inline-block w-4" />}
                          {item.product_name || item.description || item.name || `Item ${i + 1}`}
                          {hasSerials && (
                            <span className="ml-2 text-xs text-gray-400">({item.serials.length} serial{item.serials.length === 1 ? '' : 's'})</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm">{item.quantity || 1}</td>
                        <td className="px-4 py-3 text-sm">${item.cost || item.price || 0}</td>
                        <td className="px-4 py-3 text-sm">${((item.quantity || 1) * (item.cost || item.price || 0)).toFixed(2)}</td>
                      </tr>
                      {isOpen && hasSerials && (
                        <tr className="bg-gray-50">
                          <td colSpan={4} className="px-4 py-3">
                            <div className="flex flex-wrap gap-x-6 gap-y-1.5">
                              {item.serials.map((s: any) => (
                                <div key={s.id} className="flex items-center gap-2 text-sm">
                                  <Link href={`/serials/${encodeURIComponent(s.serial_number)}`} className="text-blue-600 hover:underline font-mono">
                                    {s.serial_number}
                                  </Link>
                                  {s.status && (
                                    <Badge variant={s.status === 'Sold' ? 'info' : s.status === 'In Stock' ? 'success' : 'default'}>
                                      {s.status}
                                    </Badge>
                                  )}
                                  {s.created_at && (
                                    <span className="text-xs text-gray-400">{new Date(s.created_at).toLocaleDateString()}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Attachments — Syncro (web cookie) or QuickBooks Online. */}
      {attachments && (
        <div className="mt-6 bg-white rounded border">
          <CollapsibleSection
            title="Attachments"
            count={attachments.length}
            containerClassName=""
            bodyClassName="p-4 pt-0 space-y-3"
            headerClassName="w-full flex justify-between items-center p-4 hover:bg-gray-50 text-left"
            defaultOpen={attachments.length > 0 || !attachmentsMeta.synced_at}
          >
            <div className="flex items-center gap-2 flex-wrap">
              {/* Source toggle */}
              <div className="flex rounded border border-gray-300 overflow-hidden text-xs">
                <button
                  onClick={() => setSyncSource('syncro')}
                  className={`px-2.5 py-1.5 ${syncSource === 'syncro' ? 'bg-black text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  Syncro
                </button>
                <button
                  onClick={() => setSyncSource('qbo')}
                  className={`px-2.5 py-1.5 ${syncSource === 'qbo' ? 'bg-black text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  QBO
                </button>
              </div>
              <button
                onClick={fetchAttachments}
                disabled={syncing}
                className="text-sm px-3 py-1.5 rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 disabled:opacity-50"
                title={syncSource === 'syncro' ? 'Pull attachments from Syncro (web session cookie)' : 'Pull attachments from QuickBooks Online'}
              >
                {syncing ? 'Fetching…' : 'Fetch Attachments'}
              </button>
              {syncMsg && <span className="text-xs text-gray-600">{syncMsg}</span>}
            </div>
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
              <p className="text-xs text-gray-400">
                Synced {new Date(attachmentsMeta.synced_at).toLocaleString()}
              </p>
            )}
          </CollapsibleSection>
        </div>
      )}

      <RawJsonView rawJson={po.raw_json} label="Purchase Order Raw JSON" />
    </div>
  );
}
