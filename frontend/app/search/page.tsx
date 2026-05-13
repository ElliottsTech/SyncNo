'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

const API = '/api';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const doSearch = useCallback(async (q: string) => {
    if (!q || q.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const res = await fetch(`${API}/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setResults(data.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => doSearch(query), 300);
    return () => clearTimeout(timer);
  }, [query, doSearch]);

  const typeColor = (type: string) => {
    if (type === 'customer') return 'bg-blue-100 text-blue-800';
    if (type === 'ticket') return 'bg-green-100 text-green-800';
    if (type === 'vendor') return 'bg-purple-100 text-purple-800';
    return 'bg-gray-100 text-gray-800';
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Search</h1>
      <input
        type="text"
        placeholder="Search customers, tickets, vendors..."
        value={query}
        onChange={e => setQuery(e.target.value)}
        className="border px-4 py-2 rounded w-full max-w-lg mb-6"
        autoFocus
      />

      {loading && <p className="text-gray-500">Searching...</p>}

      {!loading && query.length >= 2 && results.length === 0 && (
        <p className="text-gray-500">No results for "{query}"</p>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-2">
          {results.map((r, i) => (
            <div key={i} className="bg-white border rounded p-4 flex justify-between items-start">
              <div>
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium mr-2 ${typeColor(r.type)}`}>
                  {r.type}
                </span>
                <Link
                  href={r.type === 'customer' ? `/customers/${r.id}` : r.type === 'ticket' ? `/tickets/${r.id}` : `/vendors/${r.id}`}
                  className="text-blue-600 hover:underline font-medium"
                >
                  {r.title}
                </Link>
                {r.subtitle && <p className="text-gray-500 text-sm mt-1">{r.subtitle}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
