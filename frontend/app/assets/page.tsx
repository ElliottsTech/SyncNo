'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import Badge from '../../components/Badge';
import Pagination from '../../components/Pagination';
import { useListState } from '../../lib/useUrlState';
import { usePageTitle } from '../../lib/usePageTitle';

const API = '/api';

function fmtDate(s?: string | null) {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}
function relTime(s?: string | null) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  let str: string;
  if (abs < 86400000) str = `${Math.floor(abs / 3600000)}h`;
  else if (abs < 2592000000) str = `${Math.floor(abs / 86400000)}d`;
  else if (abs < 31536000000) str = `${Math.floor(abs / 2592000000)}mo`;
  else str = `${Math.floor(abs / 31536000000)}y`;
  return diff < 0 ? `in ${str}` : `${str} ago`;
}
function parseProperties(p: any): Record<string, any> {
  if (!p) return {};
  if (typeof p === 'object') return p;
  try { return JSON.parse(p); } catch { return {}; }
}

export default function AssetsPage() {
  usePageTitle('Assets — Syncno');
  const [assets, setAssets] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [listState, { setPage, setSort, setFilters }] = useListState({
    page: 1,
    sortCol: 'updated_at',
    sortDir: 'desc',
    columnFilters: {},
  });

  const fetchAssets = useCallback(() => {
    setLoading(true);
    const { page, sortCol, sortDir, columnFilters } = listState;
    const sort = sortCol && sortDir ? `&sortCol=${sortCol}&sortDir=${sortDir}` : '';
    const colFilters = Object.entries(columnFilters)
      .filter(([_, v]) => v)
      .map(([k, v]) => `&filter_${k}=${encodeURIComponent(v)}`)
      .join('');
    fetch(`${API}/assets?page=${page}&limit=50${sort}${colFilters}`)
      .then(r => r.json())
      .then(d => {
        setAssets(d.data);
        setPagination(d.pagination);
        setLoading(false);
      });
  }, [listState]);

  useEffect(() => { fetchAssets(); }, [fetchAssets]);

  const stats = useMemo(() => {
    const typeCount: Record<string, number> = {};
    let withSerial = 0;
    let updatedThisMonth = 0;
    const monthAgo = Date.now() - 30 * 86400000;
    for (const a of assets) {
      if (a.asset_type) typeCount[a.asset_type] = (typeCount[a.asset_type] || 0) + 1;
      if (a.asset_serial) withSerial++;
      if (a.updated_at && new Date(a.updated_at).getTime() > monthAgo) updatedThisMonth++;
    }
    const topType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0];
    return {
      typeCount: Object.keys(typeCount).length,
      topType: topType ? topType[0] : null,
      withSerial,
      updatedThisMonth,
    };
  }, [assets]);

  const columns = [
    {
      key: 'name', label: 'Name',
      render: (v: string, row: any) => (
        <Link href={`/assets/${row.id}`} className="text-blue-600 hover:underline font-medium">{v}</Link>
      ),
    },
    {
      key: 'asset_type', label: 'Type',
      render: (v: string) => v ? <Badge variant="info">{v}</Badge> : <span className="text-gray-400">—</span>,
    },
    {
      key: 'asset_serial', label: 'Serial',
      render: (v: string) => v ? (
        <Link href={`/serials/${encodeURIComponent(v)}`} className="text-blue-600 hover:underline font-mono text-xs">
          {v}
        </Link>
      ) : <span className="text-gray-400">—</span>,
    },
    {
      key: 'properties', label: 'Make / Model',
      render: (v: any) => {
        const p = parseProperties(v);
        const make = p.Make || p.make;
        const model = p.Model || p.model;
        if (!make && !model) return <span className="text-gray-400">—</span>;
        return <span className="text-sm text-gray-700">{[make, model].filter(Boolean).join(' ')}</span>;
      },
    },
    {
      key: 'created_at', label: 'Created',
      render: (v: string) => <span title={fmtDate(v)} className="text-gray-600">{fmtDate(v)}</span>,
    },
    {
      key: 'updated_at', label: 'Updated',
      render: (v: string) => <span title={fmtDate(v)} className="text-gray-600">{relTime(v)}</span>,
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Assets</h1>
        <div className="text-sm text-gray-500">{pagination.total.toLocaleString()} total</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Distinct types</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{stats.typeCount}</div>
          {stats.topType && <div className="text-xs text-gray-500 mt-1">Top: {stats.topType}</div>}
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">With serial</div>
          <div className="text-2xl font-bold text-blue-600 mt-1">{stats.withSerial}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Updated (30d)</div>
          <div className="text-2xl font-bold text-green-600 mt-1">{stats.updatedThisMonth}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">On page</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{assets.length}</div>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={assets}
        serverSide
        sortCol={listState.sortCol}
        sortDir={listState.sortDir}
        onSortChange={(c, d) => setSort(c, d)}
        onFilterChange={f => setFilters(f)}
        loading={loading}
        rowClassName={(row: any) => !row.synced ? 'bg-red-50' : ''}
      />
      <Pagination
        page={pagination.page}
        limit={pagination.limit}
        total={pagination.total}
        onPageChange={setPage}
      />
    </div>
  );
}
