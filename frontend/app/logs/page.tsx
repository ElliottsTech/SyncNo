'use client';
import { useState, useEffect, Fragment } from 'react';
import Pagination from '../../components/Pagination';

const API = '/api';

type Tab = 'all' | 'sync';

function RawDetails({ details }: { details: string }) {
  const [open, setOpen] = useState(false);
  if (!details) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(details);
  } catch {
    parsed = null;
  }

  return (
    <div className="col-span-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-xs text-blue-600 hover:text-blue-800 uppercase font-medium"
      >
        <span>{open ? '▼' : '▶'}</span> Raw Details
      </button>
      {open && (
        <div className="mt-2">
          {parsed ? (
            <pre className="bg-gray-900 text-green-400 p-4 rounded text-xs overflow-x-auto whitespace-pre-wrap break-all max-h-96">
              {JSON.stringify(parsed, null, 2)}
            </pre>
          ) : (
            <p className="font-mono text-gray-800 whitespace-pre-wrap">{details}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function LogsPage() {
  const [logs, setLogs] = useState([]);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<Tab>('all');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 100, total: 0 });

  useEffect(() => {
    const actionFilter = tab === 'sync' ? '&action=SYNC' : '';
    fetch(`${API}/logs?page=${page}&limit=100${actionFilter}`)
      .then(r => r.json())
      .then(d => {
        setLogs(d.data || []);
        setPagination(d.pagination);
      });
  }, [page, tab]);

  const actionVariant = (action: string) => {
    if (action === 'LOGIN') return 'bg-blue-100 text-blue-800';
    if (action === 'LOGOUT') return 'bg-gray-100 text-gray-800';
    if (action === 'CREATE') return 'bg-green-100 text-green-800';
    if (action === 'DELETE') return 'bg-red-100 text-red-800';
    if (action === 'PAGE_VIEW') return 'bg-purple-100 text-purple-800';
    if (action === 'SYNC_START' || action === 'SYNC_ENTITY' || action === 'SYNC_COMPLETE') return 'bg-cyan-100 text-cyan-800';
    if (action === 'SYNC_ERROR') return 'bg-red-100 text-red-800';
    return 'bg-gray-100 text-gray-800';
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'Z');
    return date.toLocaleString();
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Activity Logs</h1>
        <div className="flex gap-1 bg-gray-100 rounded p-1">
          <button
            onClick={() => { setTab('all'); setPage(1); setExpanded(null); }}
            className={`px-3 py-1.5 rounded text-sm ${tab === 'all' ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-600 hover:text-gray-900'}`}
          >
            All
          </button>
          <button
            onClick={() => { setTab('sync'); setPage(1); setExpanded(null); }}
            className={`px-3 py-1.5 rounded text-sm ${tab === 'sync' ? 'bg-white shadow text-cyan-600 font-medium' : 'text-gray-600 hover:text-gray-900'}`}
          >
            Sync Log
          </button>
        </div>
      </div>
      <div className="bg-white rounded border overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="w-8"></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">When</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">IP Address</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Browser / OS</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Device</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {logs.map((log: any) => (
              <Fragment key={log.id}>
                <tr
                  onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                  className={`cursor-pointer hover:bg-gray-50 ${expanded === log.id ? 'bg-blue-50' : ''}`}
                >
                  <td className="px-2 py-3 text-gray-400 text-sm">
                    {expanded === log.id ? '▾' : '▸'}
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    {formatDate(log.created_at)}
                  </td>
                  <td className="px-4 py-3 text-sm">{log.user_name || log.user_email || 'System'}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionVariant(log.action)}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{log.ip_address || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {[log.browser, log.os].filter(Boolean).join(' / ') || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{log.device_type || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 truncate max-w-xs">{log.details || '-'}</td>
                </tr>
                {expanded === log.id && (
                  <tr key={`${log.id}-detail`}>
                    <td colSpan={8} className="px-8 py-4 bg-gray-50 text-sm">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-gray-500 text-xs uppercase">Log ID</p>
                          <p className="font-mono text-gray-800">{log.id}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 text-xs uppercase">User ID</p>
                          <p className="font-mono text-gray-800">{log.user_id || 'System'}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 text-xs uppercase">Country</p>
                          <p className="font-mono text-gray-800">{log.country || '-'}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 text-xs uppercase">User Agent</p>
                          <p className="font-mono text-gray-800 text-xs break-all">{log.user_agent || '-'}</p>
                        </div>
                        <RawDetails details={log.details} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={pagination.page}
        limit={pagination.limit}
        total={pagination.total}
        onPageChange={setPage}
      />
    </div>
  );
}
