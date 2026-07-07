'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { usePageTitle } from '../../lib/usePageTitle';
import { fetchJson, UnauthorizedError } from '../../lib/fetch';

const API = '/api';

// Label + route + badge color per searchable type.
// Keep keys in sync with backend ALL_TYPES (routes/search.js).
const TYPE_META: Record<string, { label: string; href: (r: any) => string; badge: string }> = {
  customer:      { label: 'Customers',       href: r => `/customers/${r.id}`,                    badge: 'bg-blue-100 text-blue-800' },
  ticket:        { label: 'Tickets',         href: r => `/tickets/${r.id}`,                      badge: 'bg-green-100 text-green-800' },
  ticket_comment:{ label: 'Ticket Comments', href: r => `/tickets/${r.id}`,                      badge: 'bg-emerald-100 text-emerald-800' },
  invoice:       { label: 'Invoices',        href: r => `/invoices/${r.id}`,                     badge: 'bg-rose-100 text-rose-800' },
  product:       { label: 'Products',        href: r => `/products/${r.id}`,                     badge: 'bg-amber-100 text-amber-800' },
  vendor:        { label: 'Vendors',         href: r => `/vendors/${r.id}`,                      badge: 'bg-purple-100 text-purple-800' },
  serial:        { label: 'Product Serials', href: r => `/serials/${encodeURIComponent(r.id)}`, badge: 'bg-orange-100 text-orange-800' },
  appointment:   { label: 'Appointments',    href: r => `/appointments/${r.id}`,                 badge: 'bg-pink-100 text-pink-800' },
  contract:      { label: 'Contracts',       href: r => `/contracts/${r.id}`,                    badge: 'bg-indigo-100 text-indigo-800' },
  lead:          { label: 'Leads',           href: r => `/leads/${r.id}`,                        badge: 'bg-yellow-100 text-yellow-800' },
  portal_user:   { label: 'Portal Users',    href: r => `/portal_users/${r.id}`,                 badge: 'bg-teal-100 text-teal-800' },
  syncro_user:   { label: 'Syncro Users',    href: r => `/syncro_users/${r.id}`,                 badge: 'bg-cyan-100 text-cyan-800' },
  wiki_page:     { label: 'Wiki Pages',      href: r => `/wiki_pages/${r.id}`,                   badge: 'bg-fuchsia-100 text-fuchsia-800' },
  schedule:      { label: 'Schedules',       href: r => `/schedules/${r.id}`,                    badge: 'bg-lime-100 text-lime-800' },
};

const ALL_TYPE_KEYS = Object.keys(TYPE_META);

type ColKey = 'type' | 'title' | 'subtitle' | 'status' | 'customer' | 'date';
const COLUMNS: { key: ColKey; label: string; className?: string }[] = [
  { key: 'type',     label: 'Type',     className: 'w-40' },
  { key: 'title',    label: 'Title' },
  { key: 'subtitle', label: 'Detail',   className: 'w-64' },
  { key: 'customer', label: 'Customer', className: 'w-56' },
  { key: 'status',   label: 'Status',   className: 'w-32' },
  { key: 'date',     label: 'Date',     className: 'w-28' },
];

// Format ISO/ts string as dd/mm/yyyy. Returns '' if unparseable.
function formatDate(raw: any): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function cellText(row: any, key: ColKey): string {
  if (key === 'type') return TYPE_META[row.type]?.label || row.type || '';
  if (key === 'date') return formatDate(row.date);
  return row[key] || '';
}

export default function SearchPage() {
  usePageTitle('Search — Syncno');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]); // empty = all
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [colFilters, setColFilters] = useState<Record<ColKey, string>>({
    type: '', title: '', subtitle: '', customer: '', status: '', date: '',
  });

  // Close picker on outside click.
  useEffect(() => {
    if (!pickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [pickerOpen]);

  const doSearch = useCallback(async (q: string, types: string[]) => {
    if (!q || q.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({ q });
    if (types.length > 0) params.set('type', types.join(','));
    try {
      const data = await fetchJson(`${API}/search?${params.toString()}`);
      setResults(data.data || []);
    } catch (e) {
      if (!(e instanceof UnauthorizedError)) setResults([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => doSearch(query, selected), 300);
    return () => clearTimeout(timer);
  }, [query, selected, doSearch]);

  // Reset column filters when a new search runs.
  useEffect(() => {
    setColFilters({ type: '', title: '', subtitle: '', customer: '', status: '', date: '' });
  }, [query, selected]);

  const toggleType = (key: string) => {
    setSelected(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const clearTypes = () => setSelected([]);
  const selectOnly = (key: string) => setSelected([key]);

  const typeBadgeClass = (type: string) =>
    (TYPE_META[type]?.badge) || 'bg-gray-100 text-gray-800';

  const linkFor = (r: any) =>
    (TYPE_META[r.type]?.href) ? TYPE_META[r.type].href(r) : '#';

  const typeLabel = (type: string) => TYPE_META[type]?.label || type;

  const summaryLabel = selected.length === 0
    ? 'All types'
    : selected.length === 1
      ? typeLabel(selected[0])
      : `${selected.length} types`;

  // Apply column filters client-side.
  const filtered = useMemo(() => {
    const active = (Object.keys(colFilters) as ColKey[]).filter(k => colFilters[k].trim());
    if (active.length === 0) return results;
    const lc: Record<ColKey, string> = {
      type: colFilters.type.trim().toLowerCase(),
      title: colFilters.title.trim().toLowerCase(),
      subtitle: colFilters.subtitle.trim().toLowerCase(),
      customer: colFilters.customer.trim().toLowerCase(),
      status: colFilters.status.trim().toLowerCase(),
      date: colFilters.date.trim().toLowerCase(),
    };
    return results.filter(r => active.every(k => cellText(r, k).toLowerCase().includes(lc[k])));
  }, [results, colFilters]);

  const anyColFilter = (Object.keys(colFilters) as ColKey[]).some(k => colFilters[k].trim());

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Search</h1>

      <div className="flex gap-2 mb-4 max-w-3xl">
        <input
          type="text"
          placeholder="Search customers, tickets, comments, vendors, serials..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="border px-4 py-2 rounded flex-1"
          autoFocus
        />

        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setPickerOpen(o => !o)}
            className="border px-4 py-2 rounded bg-white hover:bg-gray-50 whitespace-nowrap flex items-center gap-2"
          >
            <span>{summaryLabel}</span>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </button>

          {pickerOpen && (
            <div className="absolute right-0 mt-1 w-64 bg-white border rounded shadow-lg z-20">
              <div className="flex items-center justify-between px-3 py-2 border-b text-sm">
                <span className="font-medium">Filter types</span>
                <button
                  type="button"
                  onClick={clearTypes}
                  className={`text-blue-600 hover:underline ${selected.length === 0 ? 'invisible' : ''}`}
                >
                  All
                </button>
              </div>
              <ul className="max-h-80 overflow-y-scroll py-1 picker-scroll">
                {ALL_TYPE_KEYS.map(key => (
                  <li key={key}>
                    <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={selected.includes(key)}
                        onChange={() => toggleType(key)}
                        className="accent-blue-600"
                      />
                      <span className="flex-1">{typeLabel(key)}</span>
                      <button
                        type="button"
                        onClick={e => { e.preventDefault(); selectOnly(key); }}
                        className="text-xs text-gray-400 hover:text-blue-600"
                        title="Only this"
                      >
                        only
                      </button>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-4">
          {selected.map(k => (
            <span key={k} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${typeBadgeClass(k)}`}>
              {typeLabel(k)}
              <button
                type="button"
                onClick={() => toggleType(k)}
                className="hover:opacity-70"
                aria-label={`Remove ${typeLabel(k)}`}
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={clearTypes}
            className="text-xs text-blue-600 hover:underline ml-1"
          >
            clear
          </button>
        </div>
      )}

      {loading && <p className="text-gray-500">Searching...</p>}

      {!loading && query.length >= 2 && results.length === 0 && (
        <p className="text-gray-500">No results for "{query}"</p>
      )}

      {!loading && results.length > 0 && (
        <div className="bg-white border rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b text-left text-xs uppercase tracking-wide text-gray-600">
                  {COLUMNS.map(col => (
                    <th key={col.key} className={`px-3 py-2 font-medium ${col.className || ''}`}>
                      {col.label}
                    </th>
                  ))}
                </tr>
                <tr className="bg-gray-50 border-b">
                  {COLUMNS.map(col => (
                    <th key={col.key} className={`px-2 pb-2 ${col.className || ''}`}>
                      <input
                        type="text"
                        value={colFilters[col.key]}
                        onChange={e => setColFilters(prev => ({ ...prev, [col.key]: e.target.value }))}
                        placeholder="Filter…"
                        className="w-full text-xs px-2 py-1 border rounded font-normal normal-case tracking-normal"
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={`${r.type}-${r.id}-${i}`} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2 align-top">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${typeBadgeClass(r.type)}`}>
                        {typeLabel(r.type)}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Link href={linkFor(r)} className="text-blue-600 hover:underline font-medium">
                        {r.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2 align-top text-gray-700">{r.subtitle || '—'}</td>
                    <td className="px-3 py-2 align-top text-gray-700">{r.customer || '—'}</td>
                    <td className="px-3 py-2 align-top text-gray-700">{r.status || '—'}</td>
                    <td className="px-3 py-2 align-top text-gray-500">{r.date ? formatDate(r.date) : '—'}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-gray-500">
                      No rows match the column filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 text-xs text-gray-500 border-t bg-gray-50 flex items-center justify-between">
            <span>
              {filtered.length} of {results.length} result{results.length === 1 ? '' : 's'}
            </span>
            {anyColFilter && (
              <button
                type="button"
                onClick={() => setColFilters({ type: '', title: '', subtitle: '', customer: '', status: '', date: '' })}
                className="text-blue-600 hover:underline"
              >
                Clear column filters
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
