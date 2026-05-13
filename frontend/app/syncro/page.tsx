'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import SyncTerminal from '@/components/SyncTerminal';
import type { HttpLogEntry } from '@/components/SyncTerminal';

const API = '/api';

type Phase = 'customers' | 'contacts' | 'tickets' | 'invoices' | 'assets' | 'estimates' | 'purchase_orders' | 'vendors';

type PhaseProgress = {
  phase: Phase;
  status: 'started' | 'done' | 'error' | 'cancelled';
  count?: number;
  error?: string;
  message?: string;
};

const ENTITY_PHASES: Phase[] = ['customers', 'contacts', 'tickets', 'invoices', 'assets', 'estimates', 'purchase_orders', 'vendors'];

const PHASE_LABELS: Record<Phase, string> = {
  customers: 'Customers',
  contacts: 'Contacts',
  tickets: 'Tickets',
  invoices: 'Invoices',
  assets: 'Assets',
  estimates: 'Estimates',
  purchase_orders: 'Purchase Orders',
  vendors: 'Vendors',
};

type ActiveSync = {
  phase: Phase | 'all';
  xhr: XMLHttpRequest;
  buffer: string;
};

export default function SyncroPage() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [entityStatus, setEntityStatus] = useState<Record<Phase, PhaseProgress | null>>({
    customers: null, contacts: null, tickets: null, invoices: null,
    assets: null, estimates: null, purchase_orders: null, vendors: null,
  });

  const [syncAllSyncing, setSyncAllSyncing] = useState(false);
  const [syncAllProgress, setSyncAllProgress] = useState<Record<Phase, PhaseProgress | null>>({
    customers: null, contacts: null, tickets: null, invoices: null,
    assets: null, estimates: null, purchase_orders: null, vendors: null,
  });

  const [previewing, setPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<any>(null);

  // Multiple active syncs — each has its own XHR and terminal
  const [activeSyncs, setActiveSyncs] = useState<Record<string, ActiveSync>>({});
  const [selectedSyncKey, setSelectedSyncKey] = useState<string | null>(null);

  // Deduplicate SSE events per sync key
  const lastEventRef = useRef<Record<string, string>>({});
  // Prevent duplicate in-flight syncs
  const syncsInFlight = useRef<Set<string>>(new Set());

  // Restore active syncs from sessionStorage on mount — reconnect to any in-progress syncs
  useEffect(() => {
    fetchStatus();
    try {
      const stored = sessionStorage.getItem('activeSyncs');
      if (stored) {
        const parsed = JSON.parse(stored) as string[];
        if (parsed.length > 0) {
          // Reconnect each active sync by re-triggering it
          parsed.forEach((key: string) => {
            const [, phase] = key.split(':');
            if (phase === 'all') {
              // Small delay to let fetchStatus complete first
              setTimeout(() => handleSyncAll(false), 100);
            } else if (phase) {
              setTimeout(() => handleSyncEntity(phase as Phase), 100);
            }
          });
        }
      }
    } catch (_) {}
  }, []);

  function saveActiveSyncs(syncs: Record<string, ActiveSync>) {
    const keys = Object.keys(syncs);
    sessionStorage.setItem('activeSyncs', JSON.stringify(keys));
  }

  function fetchStatus() {
    fetch(`${API}/sync/status`)
      .then(r => r.json())
      .then(data => {
        setStatus(data);
        setLoading(false);
      });
  }

  async function handlePreview() {
    setPreviewing(true);
    setPreviewResult(null);
    try {
      const res = await fetch(`${API}/sync/preview`, { method: 'POST' });
      setPreviewResult(await res.json());
    } catch (e: any) {
      setPreviewResult({ error: e.message });
    }
    setPreviewing(false);
  }

  function cancelSync(key: string) {
    setActiveSyncs(prev => {
      const sync = prev[key];
      if (sync) {
        // Tell backend to abort, then abort the XHR
        fetch(`${API}/sync/trigger`, { method: 'DELETE' }).catch(() => {});
        sync.xhr.abort();
      }
      const next = { ...prev };
      delete next[key];
      saveActiveSyncs(next);
      return next;
    });
    if (selectedSyncKey === key) setSelectedSyncKey(null);
  }

  function handleEntityProgress(phase: Phase, data: any) {
    // Deduplicate SSE events per phase
    const eventKey = `${data.phase || ''}:${data.status || ''}:${data.current || ''}:${data.count || ''}:${data.error || ''}`;
    if (lastEventRef.current[phase] === eventKey) return;
    lastEventRef.current[phase] = eventKey;

    if (data.type === 'cancelled' || data.status === 'cancelled') {
      setEntityStatus(prev => ({ ...prev, [phase]: { phase, status: 'cancelled' } }));
      return;
    }
    if (data.phase === 'done') {
      setEntityStatus(prev => ({ ...prev, [phase]: { phase, status: 'done', count: data.results?.[phase] || 0 } }));
      return;
    }
    if (data.phase === 'error') {
      setEntityStatus(prev => ({ ...prev, [phase]: { phase, status: 'error', error: data.error } }));
      return;
    }
    if (data.status === 'progress') {
      setEntityStatus(prev => ({
        ...prev,
        [phase]: { phase, status: 'started', message: `${data.current}/${data.total}` },
      }));
      return;
    }
    if (data.phase && data.status) {
      setEntityStatus(prev => ({
        ...prev,
        [phase]: {
          phase: data.phase,
          status: data.status,
          count: data.count,
          error: data.error,
          message: data.message,
        },
      }));
    }
  }

  function handleSyncAllProgress(data: any) {
    // Deduplicate SSE events
    const eventKey = `${data.phase || ''}:${data.status || ''}:${data.current || ''}:${data.count || ''}:${data.error || ''}`;
    if (lastEventRef.current['all'] === eventKey) return;
    lastEventRef.current['all'] = eventKey;

    if (data.type === 'cancelled' || data.status === 'cancelled') {
      setSyncAllSyncing(false);
      setSyncAllProgress({ customers: null, contacts: null, tickets: null, invoices: null, assets: null, estimates: null, purchase_orders: null, vendors: null });
      return;
    }
    if (data.phase === 'done' || data.phase === 'error') {
      setSyncAllSyncing(false);
      fetchStatus();
      return;
    }
    if (data.status === 'progress' && data.phase) {
      setSyncAllProgress(prev => ({
        ...prev,
        [data.phase]: {
          phase: data.phase,
          status: 'started',
          message: `${data.current}/${data.total}`,
        },
      }));
      return;
    }
    if (data.phase && data.status) {
      setSyncAllProgress(prev => ({
        ...prev,
        [data.phase]: {
          phase: data.phase,
          status: data.status,
          count: data.count,
          error: data.error,
          message: data.message,
        },
      }));
    }
  }

  // Sync a single entity phase
  function handleSyncEntity(phase: Phase, limit?: number, forceAll?: boolean) {
    const key = `entity:${phase}${forceAll ? ':force' : ''}`;
    if (syncsInFlight.current.has(key)) return; // prevent duplicate
    syncsInFlight.current.add(key);
    let buffer = '';

    const xhr = new XMLHttpRequest();
    const url = `${API}/sync/trigger?phase=${phase}${limit ? `&limit=${limit}` : ''}${forceAll ? '&forceAll=true' : ''}`;
    xhr.open('POST', url, true);

    setActiveSyncs(prev => {
      const next = { ...prev, [key]: { phase, xhr, buffer } };
      saveActiveSyncs(next);
      return next;
    });
    setSelectedSyncKey(key);
    setEntityStatus(prev => ({ ...prev, [phase]: { phase, status: 'started', message: 'Starting...' } }));

    xhr.onprogress = () => {
      buffer += xhr.responseText.slice(buffer.length);
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            handleEntityProgress(phase, data);
          } catch (_) {}
        }
      }
      // Update buffer in state
      setActiveSyncs(prev => prev[key] ? { ...prev, [key]: { ...prev[key], buffer } } : prev);
    };

    xhr.onload = () => {
      syncsInFlight.current.delete(key);
      setActiveSyncs(prev => {
        const next = { ...prev };
        delete next[key];
        saveActiveSyncs(next);
        return next;
      });
      setEntityStatus(prev => ({ ...prev, [phase]: { phase, status: 'done', count: prev[phase]?.count || 0 } }));
      if (selectedSyncKey === key) setSelectedSyncKey(null);
      fetchStatus();
    };
    xhr.onerror = () => {
      syncsInFlight.current.delete(key);
      setActiveSyncs(prev => {
        const next = { ...prev };
        delete next[key];
        saveActiveSyncs(next);
        return next;
      });
      setEntityStatus(prev => ({ ...prev, [phase]: { phase, status: 'error', error: 'Network error' } }));
      if (selectedSyncKey === key) setSelectedSyncKey(null);
      fetchStatus();
    };
    xhr.send('');
  }

  // Sync All
  function handleSyncAll(forceAll: boolean = false) {
    const key = `entity:all${forceAll ? ':force' : ''}`;
    if (syncsInFlight.current.has(key)) return;
    syncsInFlight.current.add(key);
    let buffer = '';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/sync/trigger${forceAll ? '?forceAll=true' : ''}`, true);

    setActiveSyncs(prev => {
      const next = { ...prev, [key]: { phase: 'all' as const, xhr, buffer } };
      saveActiveSyncs(next);
      return next;
    });
    setSelectedSyncKey(key);
    setSyncAllSyncing(true);
    setSyncAllProgress({ customers: null, contacts: null, tickets: null, invoices: null, assets: null, estimates: null, purchase_orders: null, vendors: null });

    xhr.onprogress = () => {
      buffer += xhr.responseText.slice(buffer.length);
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            handleSyncAllProgress(data);
          } catch (_) {}
        }
      }
      setActiveSyncs(prev => prev[key] ? { ...prev, [key]: { ...prev[key], buffer } } : prev);
    };

    xhr.onload = () => {
      syncsInFlight.current.delete(key);
      setActiveSyncs(prev => {
        const next = { ...prev };
        delete next[key];
        saveActiveSyncs(next);
        return next;
      });
      setSyncAllSyncing(false);
      if (selectedSyncKey === key) setSelectedSyncKey(null);
      fetchStatus();
    };
    xhr.onerror = () => {
      syncsInFlight.current.delete(key);
      setActiveSyncs(prev => {
        const next = { ...prev };
        delete next[key];
        saveActiveSyncs(next);
        return next;
      });
      setSyncAllSyncing(false);
      if (selectedSyncKey === key) setSelectedSyncKey(null);
    };
    xhr.send('');
  }

  function phaseIcon(p: PhaseProgress | null) {
    if (!p) return '○';
    if (p.status === 'done') return '✓';
    if (p.status === 'error') return '✗';
    if (p.status === 'cancelled') return '⊘';
    return '◐';
  }

  function phaseColor(p: PhaseProgress | null) {
    if (!p) return 'text-gray-400';
    if (p.status === 'done') return 'text-green-600';
    if (p.status === 'error') return 'text-red-600';
    if (p.status === 'cancelled') return 'text-orange-600';
    return 'text-blue-600';
  }

  if (loading) return <p className="text-gray-500">Loading...</p>;

  const s = status?.syncro;
  const e = status?.entra;
  const u = status?.urls;

  const activeSyncList = Object.entries(activeSyncs);
  const anySyncing = activeSyncList.length > 0;

  return (
    <div>
      <Link href="/tickets" className="text-blue-600 hover:underline text-sm">← Back to Tickets</Link>

      <div className="mt-4 max-w-xl">
        <h1 className="text-xl font-bold mb-6">Settings</h1>

        {/* Syncro */}
        <div className="bg-white rounded border p-4 mb-4">
          <h2 className="font-semibold mb-3">Syncro</h2>
          {s?.configured ? (
            <div className="text-sm space-y-1">
              <p className="text-green-600">✓ Configured</p>
              <p>Subdomain: <span className="font-mono">{s.subdomain}</span></p>
              <p>API Key: <span className="font-mono">{s.apiKeyMasked}</span></p>
              <p>Last Sync: {s.lastSync ? new Date(s.lastSync).toLocaleString() : 'Never'}</p>
            </div>
          ) : (
            <p className="text-red-600 text-sm">Not configured — set SYNCRO_API_KEY and SYNCRO_SUBDOMAIN in backend .env</p>
          )}
        </div>

        {/* Entra */}
        <div className="bg-white rounded border p-4 mb-4">
          <h2 className="font-semibold mb-3">Entra ID (Azure AD)</h2>
          {e?.configured ? (
            <div className="text-sm space-y-1">
              <p className="text-green-600">✓ Configured</p>
              <p>Client ID: <span className="font-mono">{e.clientId}</span></p>
              <p>Tenant ID: <span className="font-mono">{e.tenantId}</span></p>
            </div>
          ) : (
            <p className="text-red-600 text-sm">Not configured — set AZURE_CLIENT_ID and AZURE_TENANT_ID in frontend .env.local</p>
          )}
        </div>

        {/* URLs */}
        <div className="bg-white rounded border p-4 mb-4">
          <h2 className="font-semibold mb-3">URLs</h2>
          <div className="text-sm space-y-1">
            <p>NEXTAUTH_URL: <span className="font-mono">{u?.nextAuth || '—'}</span></p>
            <p>API URL: <span className="font-mono">{u?.api || '—'}</span></p>
          </div>
        </div>

        {/* Sync Data */}
        {s?.configured && (
          <div className="bg-white rounded border p-4">
            <h2 className="font-semibold mb-4">Sync Data</h2>

            {/* Active sync tabs */}
            {anySyncing && (
              <div className="flex items-center gap-2 mb-4 pb-3 border-b overflow-x-auto">
                <span className="text-xs text-gray-500 shrink-0">Active:</span>
                {activeSyncList.map(([key, sync]) => (
                  <div key={key} className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs shrink-0 ${selectedSyncKey === key ? 'bg-black text-white' : 'bg-gray-100 text-gray-700'}`}>
                    <button onClick={() => setSelectedSyncKey(key)} className="font-mono">
                      {sync.phase === 'all' ? 'Sync All' : PHASE_LABELS[sync.phase as Phase]}
                    </button>
                    <button
                      onClick={() => cancelSync(key)}
                      className="text-red-400 hover:text-red-300 font-bold ml-1"
                      title="Cancel"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Individual entity sync rows */}
            <div className="grid grid-cols-1 gap-2 mb-4">
              {ENTITY_PHASES.map(phase => {
                const syncing = !!activeSyncs[`entity:${phase}`];
                const progress = entityStatus[phase];
                const isRunning = syncing;

                return (
                  <div key={phase} className="flex items-center gap-2">
                    <button
                      onClick={() => handleSyncEntity(phase)}
                      disabled={isRunning}
                      className={`px-3 py-1.5 rounded text-sm border ${isRunning
                        ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {isRunning ? 'Syncing...' : 'Sync'}
                    </button>
                    <button
                      onClick={() => handleSyncEntity(phase, undefined, true)}
                      disabled={!!activeSyncs[`entity:${phase}:force`]}
                      className="px-3 py-1.5 rounded text-sm border border-orange-300 text-orange-700 bg-orange-50 hover:bg-orange-100 disabled:opacity-50"
                      title="Re-sync all records regardless of last sync time"
                    >
                      Re-sync
                    </button>
                    <span className={`text-sm ${phaseColor(progress)}`}>
                      {phaseIcon(progress)} {PHASE_LABELS[phase]}
                    </span>
                    {progress?.status === 'started' && (
                      <span className="text-xs text-gray-500">{progress.message}</span>
                    )}
                    {progress?.status === 'done' && (
                      <span className="text-xs text-gray-500">({progress.count})</span>
                    )}
                    {progress?.status === 'error' && (
                      <span className="text-xs text-red-500">{progress.error}</span>
                    )}
                    {progress?.status === 'cancelled' && (
                      <span className="text-xs text-orange-500">Cancelled</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Test Sync — 10 most recent per entity */}
            <div className="flex flex-wrap gap-2 mb-6">
              {ENTITY_PHASES.map(phase => (
                <button
                  key={phase}
                  onClick={() => handleSyncEntity(phase, 10)}
                  disabled={!!activeSyncs[`entity:${phase}`]}
                  className="bg-blue-50 border border-blue-200 text-blue-700 px-3 py-1.5 rounded text-sm hover:bg-blue-100 disabled:opacity-50"
                >
                  Test (10 {PHASE_LABELS[phase]})
                </button>
              ))}
              <span className="text-xs text-gray-500 self-center">Syncs 10 most recent records per entity</span>
            </div>

            {/* Sync All */}
            <div className="border-t pt-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleSyncAll(false)}
                  disabled={!!activeSyncs['entity:all']}
                  className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50"
                >
                  {activeSyncs['entity:all'] ? 'Syncing All...' : 'Sync All'}
                </button>
                <button
                  onClick={() => handleSyncAll(true)}
                  disabled={!!activeSyncs['entity:all:force']}
                  className="bg-orange-600 text-white px-4 py-2 rounded text-sm hover:bg-orange-700 disabled:opacity-50"
                  title="Re-sync all records for all entities regardless of last sync time"
                >
                  Re-sync All
                </button>
                {activeSyncs['entity:all'] && (
                  <div className="flex items-center gap-2 text-sm text-blue-600">
                    <span className="animate-spin">◐</span>
                    <span>Running full sync...</span>
                  </div>
                )}
                {anySyncing && (
                  <button
                    onClick={() => setSelectedSyncKey(activeSyncList[0]?.[0] || null)}
                    className="bg-black text-green-400 px-3 py-1 rounded text-xs font-mono border border-green-700 hover:bg-gray-900"
                  >
                    View Terminal
                  </button>
                )}
              </div>

              {activeSyncs['entity:all'] && (
                <div className="mt-3 space-y-1">
                  {ENTITY_PHASES.map(phase => (
                    <div key={phase} className={`flex items-center gap-2 text-sm ${phaseColor(syncAllProgress[phase])}`}>
                      <span>{phaseIcon(syncAllProgress[phase])}</span>
                      <span>{PHASE_LABELS[phase]}</span>
                      {syncAllProgress[phase]?.status === 'done' && (
                        <span className="text-gray-500 text-xs">({syncAllProgress[phase].count})</span>
                      )}
                      {syncAllProgress[phase]?.status === 'started' && (
                        <span className="text-gray-500 text-xs">{syncAllProgress[phase]?.message}</span>
                      )}
                      {syncAllProgress[phase]?.status === 'error' && (
                        <span className="text-red-500 text-xs">{syncAllProgress[phase]?.error}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Preview */}
            <div className="border-t pt-4 mt-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={handlePreview}
                  disabled={previewing || anySyncing}
                  className="bg-gray-100 border text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-200 disabled:opacity-50"
                >
                  {previewing ? 'Previewing...' : 'Preview Changes'}
                </button>
              </div>

              {previewResult && (
                <div className="mt-4">
                  <h3 className="font-medium text-sm mb-2">Preview — records newer than last sync</h3>
                  {previewResult.error ? (
                    <p className="text-red-600 text-sm">Error: {previewResult.error}</p>
                  ) : (
                    <div className="text-sm space-y-1">
                      <p className="text-gray-500 text-xs mb-2">{previewResult.sinceLabel}</p>
                      <p>Customers: <span className="font-mono">{previewResult.entities?.customers?.total || 0}</span> / {previewResult.entities?.customers?.page1Total || 0}</p>
                      <p>Contacts: <span className="font-mono">{previewResult.entities?.contacts?.total || 0}</span> / {previewResult.entities?.contacts?.page1Total || 0}</p>
                      <p>Tickets: <span className="font-mono">{previewResult.entities?.tickets?.total || 0}</span> / {previewResult.entities?.tickets?.page1Total || 0}</p>
                      <p>Invoices: <span className="font-mono">{previewResult.entities?.invoices?.total || 0}</span> / {previewResult.entities?.invoices?.page1Total || 0}</p>
                      {previewResult.errors?.length > 0 && (
                        <p className="text-red-600 text-xs">{previewResult.errors.join(', ')}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Multiple terminal windows */}
      {activeSyncList.map(([key, sync]) => (
        selectedSyncKey === key ? (
          <SyncTerminal
            key={key}
            onClose={() => setSelectedSyncKey(null)}
            xhr={sync.xhr}
            bufferRef={{ current: sync.buffer }}
          />
        ) : null
      ))}
    </div>
  );
}
