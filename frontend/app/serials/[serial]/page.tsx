'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Badge from '../../../components/Badge';
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

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-gray-500 text-sm">{children}</p>;
}

export default function SerialDetail() {
  const { serial } = useParams();
  const router = useRouter();
  const serialStr = decodeURIComponent(Array.isArray(serial) ? serial[0] : serial);
  const [data, setData] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`${API}/serials/${encodeURIComponent(serialStr)}`)
      .then(r => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then(d => { if (d) setData(d); });
  }, [serialStr]);

  usePageTitle(data?.serial ? `Serial ${data.serial.serial_number} — Syncno` : null);

  if (notFound) {
    return (
      <div className="max-w-7xl mx-auto">
        <button onClick={() => router.back()} className="text-blue-600 hover:underline text-sm">← Back</button>
        <p className="mt-4 text-gray-700">Serial <span className="font-mono">{serialStr}</span> not found in DB.</p>
      </div>
    );
  }
  if (!data) return <p className="text-gray-500">Loading...</p>;

  const { serial: s, product, ticket, invoice, estimate, asset } = data;
  const fmtMoney = (v: any) => {
    const n = parseFloat(v);
    return isNaN(n) ? v : `$${n.toFixed(2)}`;
  };
  const fmtDate = (v: string) => v ? new Date(v).toLocaleDateString() : '';

  const hasLinks = ticket || invoice || estimate || asset;

  return (
    <div className="max-w-7xl mx-auto">
      <button onClick={() => router.back()} className="text-blue-600 hover:underline text-sm">← Back</button>

      <div className="mt-4 bg-white rounded border">
        <div className="p-6 border-b">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-xl font-bold font-mono">{s.serial_number}</h1>
              <p className="text-gray-500 mt-1">
                Serial ID: <span className="font-mono">{s.id}</span>
                {s.line_item_id && <> · Line Item: <span className="font-mono">{s.line_item_id}</span></>}
              </p>
              <p className="text-gray-500 mt-1">
                Created: {fmtDate(s.created_at)} · Updated: {fmtDate(s.updated_at)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {s.status && <Badge variant={s.status === 'Sold' ? 'info' : s.status === 'In Stock' ? 'success' : 'default'}>{s.status}</Badge>}
            </div>
          </div>
        </div>

        <CollapsibleSection title="Product">
          {product ? (
            <>
              <Link href={`/products/${product.id}`} className="text-blue-600 hover:underline font-medium">
                {product.name || '(unnamed)'}
              </Link>
              <p className="text-gray-500 text-sm mt-1">Product ID: <span className="font-mono">{product.id}</span></p>
              <RawJsonView rawJson={product.raw_json} label="Product Raw JSON" />
            </>
          ) : (
            <Empty>Product record missing.</Empty>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Invoice" count={invoice ? 1 : 0}>
          {invoice ? (
            <>
              <Link href={`/invoices/${invoice.id}`} className="text-blue-600 hover:underline font-medium">
                Invoice #{invoice.number}
              </Link>
              <p className="text-gray-500 text-sm mt-1">
                ID: <span className="font-mono">{invoice.id}</span>
                {invoice.total != null && <> · Total: {fmtMoney(invoice.total)}</>}
                {' · '}{invoice.is_paid ? 'Paid' : 'Unpaid'}
                {invoice.created_at && <> · {fmtDate(invoice.created_at)}</>}
              </p>
              <RawJsonView rawJson={invoice.raw_json} label="Invoice Raw JSON" />
            </>
          ) : (
            <Empty>No invoice linked to this serial{hasLinks ? '.' : ' and no other linked entities found.'}</Empty>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Ticket" count={ticket ? 1 : 0}>
          {ticket ? (
            <>
              <Link href={`/tickets/${ticket.id}`} className="text-blue-600 hover:underline font-medium">
                Ticket #{ticket.number}
              </Link>
              <p className="text-gray-500 text-sm mt-1">
                ID: <span className="font-mono">{ticket.id}</span>
                {ticket.status && <> · <Badge variant={ticket.status === 'Resolved' ? 'success' : 'default'}>{ticket.status}</Badge></>}
                {ticket.priority && <> · {ticket.priority}</>}
              </p>
              {ticket.subject && <p className="text-gray-700 mt-1">{ticket.subject}</p>}
              {ticket.customer_business_then_name && <p className="text-gray-500 text-sm mt-1">{ticket.customer_business_then_name}</p>}
              <RawJsonView rawJson={ticket.raw_json} label="Ticket Raw JSON" />
            </>
          ) : (
            <Empty>No ticket linked to this serial.</Empty>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Estimate" count={estimate ? 1 : 0}>
          {estimate ? (
            <>
              <Link href={`/estimates/${estimate.id}`} className="text-blue-600 hover:underline font-medium">
                Estimate #{estimate.number}
              </Link>
              <p className="text-gray-500 text-sm mt-1">
                ID: <span className="font-mono">{estimate.id}</span>
                {estimate.status && <> · {estimate.status}</>}
                {estimate.total != null && <> · {fmtMoney(estimate.total)}</>}
              </p>
              <RawJsonView rawJson={estimate.raw_json} label="Estimate Raw JSON" />
            </>
          ) : (
            <Empty>No estimate linked to this serial.</Empty>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Asset" count={asset ? 1 : 0}>
          {asset ? (
            <>
              <Link href={`/assets/${asset.id}`} className="text-blue-600 hover:underline font-medium">
                {asset.name || '(unnamed asset)'}
              </Link>
              <p className="text-gray-500 text-sm mt-1">
                ID: <span className="font-mono">{asset.id}</span>
                {asset.asset_type && <> · {asset.asset_type}</>}
                {asset.customer_id && <> · Customer: <span className="font-mono">{asset.customer_id}</span></>}
              </p>
              <RawJsonView rawJson={asset.raw_json} label="Asset Raw JSON" />
            </>
          ) : (
            <Empty>No asset carries this serial.</Empty>
          )}
        </CollapsibleSection>

        <RawJsonView rawJson={s.raw_json} label="Serial Raw JSON" />
      </div>
    </div>
  );
}
