'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import SyncTerminal from '@/components/SyncTerminal';
import type { HttpLogEntry } from '@/components/SyncTerminal';

// Sync API calls go directly to backend, bypassing NextAuth proxy
// Use backend port so auth middleware doesn't block status checks
const API = (typeof window !== 'undefined' && window.location.port === '3001')
  ? 'http://localhost:3002/api'  // local Docker: browser→frontend:3001 but sync→backend:3002
  : '/api';  // fallback: use proxy (auth required)

type Phase = 'customers' | 'contacts' | 'tickets' | 'invoices' | 'assets' | 'estimates' | 'purchase_orders' | 'vendors';

type PhaseProgress = {
  phase: Phase;
  status: 'started' | 'done' | 'error' | 'cancelled' | 'conflict' | 'resuming' | 'building_catalog';
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
  xhr: XMLHttpRequest | null;
  buffer: string;
  storedEvents: string[];  // SSE event lines persisted to sessionStorage
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

  // Polling interval ref for background sync state
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check backend sync state on mount — do NOT auto-start a new sync
  useEffect(() => {
    fetchStatus();
    fetch(`${API}/sync/progress`)
      .then(r => r.json())
      .then(data => {
        // Check if any entity has a non-idle phase
        const states = [data.tickets, data.customers, data.contacts, data.invoices, data.assets, data.estimates, data.purchase_orders, data.vendors];
        const anyRunning = states.some(s => s && s.phase && s.phase !== 'idle' && s.phase !== 'error');

        if (anyRunning) {
          // Sync is running on backend — show its state, do NOT restart
          // Restore syncAllProgress from sessionStorage (survives refresh),
          // then overlay with fresh backend state for accuracy
          const storedProgress = loadSyncProgress();
          const backendProgress = {
            tickets: buildProgressFromState('tickets', data.tickets),
            customers: buildProgressFromState('customers', data.customers),
            contacts: buildProgressFromState('contacts', data.contacts),
            invoices: buildProgressFromState('invoices', data.invoices),
            assets: buildProgressFromState('assets', data.assets),
            estimates: buildProgressFromState('estimates', data.estimates),
            purchase_orders: buildProgressFromState('purchase_orders', data.purchase_orders),
            vendors: buildProgressFromState('vendors', data.vendors),
          };
          // Prefer sessionStorage progress if available, otherwise use backend state (never null)
          const mergedProgress = storedProgress || backendProgress;
          setSyncAllProgress(mergedProgress);
          saveSyncProgress(mergedProgress);
          setSyncAllSyncing(true);
          // Restore buffered SSE events from sessionStorage so View Terminal works
          const storedEventsRaw = sessionStorage.getItem('syncEvents:entity:all');
          const storedEvents: string[] = storedEventsRaw ? JSON.parse(storedEventsRaw) : [];
          setActiveSyncs({ 'entity:all': { phase: 'all', xhr: null, buffer: '', storedEvents } });
          const savedKey = loadActiveSyncKey();
          if (savedKey && savedKey.startsWith('entity:')) setSelectedSyncKey(savedKey);
          // Start polling immediately to keep UI updated (SSE won't reconnect without user action)
          startProgressPolling();
          return;
        }
        // Nothing running on backend
        syncsInFlight.current.clear();
        sessionStorage.removeItem('activeSyncs');
        setSyncAllSyncing(false);
        setSyncAllProgress({ customers: null, contacts: null, tickets: null, invoices: null, assets: null, estimates: null, purchase_orders: null, vendors: null });
      })
      .catch(() => {
        syncsInFlight.current.clear();
        sessionStorage.removeItem('activeSyncs');
      });
  }, []);

  function buildProgressFromState(phase: Phase, state: any): PhaseProgress {
    if (!state || state.phase === 'idle' || state.phase === 'error') return null;
    const p: PhaseProgress = { phase: phase as Phase, status: 'started' };
    if (state.phase === 'catalog') {
      p.message = `catalog page ${state.last_page_synced || 0}/${state.total_pages || '?'}`;
    } else if (state.phase === 'detail') {
      p.message = `detail ${state.detail_synced || 0}/${state.detail_total || 0}`;
    } else if (state.phase === 'error') {
      p.status = 'error';
      p.error = 'error';
    }
    return p;
  }

  function startProgressPolling() {
    if (pollIntervalRef.current) return;
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/sync/progress`);
        const data = await res.json();
        const states = [data.tickets, data.customers, data.contacts, data.invoices, data.assets, data.estimates, data.purchase_orders, data.vendors];
        const anyRunning = states.some(s => s && s.phase && s.phase !== 'idle' && s.phase !== 'error');
        if (!anyRunning) {
          clearInterval(pollIntervalRef.current!);
          pollIntervalRef.current = null;
          setSyncAllSyncing(false);
          setSyncAllProgress({ customers: null, contacts: null, tickets: null, invoices: null, assets: null, estimates: null, purchase_orders: null, vendors: null });
          setActiveSyncs({});
          fetchStatus();
          return;
        }
        setSyncAllProgress({
          tickets: buildProgressFromState('tickets', data.tickets),
          customers: buildProgressFromState('customers', data.customers),
          contacts: buildProgressFromState('contacts', data.contacts),
          invoices: buildProgressFromState('invoices', data.invoices),
          assets: buildProgressFromState('assets', data.assets),
          estimates: buildProgressFromState('estimates', data.estimates),
          purchase_orders: buildProgressFromState('purchase_orders', data.purchase_orders),
          vendors: buildProgressFromState('vendors', data.vendors),
        });
      } catch (_) {}
    }, 3000);
  }

  function saveActiveSyncs(syncs: Record<string, ActiveSync>, selectedKey: string | null) {
    const keys = Object.keys(syncs);
    sessionStorage.setItem('activeSyncs', JSON.stringify(keys));
    if (selectedKey) sessionStorage.setItem('activeSyncKey', selectedKey);
  }

  function loadActiveSyncKey(): string | null {
    return sessionStorage.getItem('activeSyncKey');
  }

  function saveSyncProgress(progress: Record<string, any>) {
    sessionStorage.setItem('syncProgress', JSON.stringify(progress));
  }

  function loadSyncProgress(): Record<Phase, PhaseProgress | null> | null {
    try {
      const raw = sessionStorage.getItem('syncProgress');
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
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
        sync.xhr?.abort();
      }
      const next = { ...prev };
      delete next[key];
      const newSelectedKey = selectedSyncKey === key ? (Object.keys(next)[0] || null) : selectedSyncKey;
      saveActiveSyncs(next, newSelectedKey);
      return next;
    });
    sessionStorage.removeItem(`syncEvents:${key}`);
    sessionStorage.removeItem('syncProgress');
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
    const eventKey = `${data.phase || ''}:${data.status || ''}:${data.subphase || ''}:${data.current || ''}:${data.count || ''}:${data.error || ''}`;
    if (lastEventRef.current['all'] === eventKey) return;
    lastEventRef.current['all'] = eventKey;

    if (data.type === 'cancelled' || data.status === 'cancelled') {
      setSyncAllSyncing(false);
      const next = { customers: null, contacts: null, tickets: null, invoices: null, assets: null, estimates: null, purchase_orders: null, vendors: null };
      setSyncAllProgress(next);
      sessionStorage.removeItem('syncProgress');
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
      return;
    }
    if (data.phase === 'done' || data.phase === 'error') {
      setSyncAllSyncing(false);
      sessionStorage.removeItem('syncProgress');
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
      fetchStatus();
      return;
    }

    // Progress update
    if (data.phase && data.status === 'progress') {
      const phase = data.phase as Phase;
      let message = '';
      if (phase === 'tickets' && data.subphase === 'catalog') {
        message = `catalog page ${data.page}/${data.totalPages}`;
      } else if (phase === 'tickets' && data.subphase === 'detail') {
        message = `detail ${data.current}/${data.total}`;
      } else {
        message = `${data.current}/${data.total}`;
      }
      setSyncAllProgress(prev => {
        const next = { ...prev, [phase]: { phase, status: 'started', message } };
        saveSyncProgress(next);
        return next;
      });
      return;
    }

    // Phase started/done/error
    if (data.phase && data.status) {
      const phase = data.phase as Phase;
      if (phase === 'tickets' && data.status === 'catalog_done') {
        setSyncAllProgress(prev => {
          const next = { ...prev, tickets: { phase: 'tickets' as Phase, status: 'started' as const, message: `catalog done, ${data.detailTotal} to fetch` } };
          saveSyncProgress(next);
          return next;
        });
        return;
      }
      if (phase === 'tickets' && data.status === 'building_catalog') {
        setSyncAllProgress(prev => {
          const next = { ...prev, tickets: { phase: 'tickets' as Phase, status: 'started' as const, message: data.message || `catalog page ${data.resumePage}/?` } };
          saveSyncProgress(next);
          return next;
        });
        return;
      }
      setSyncAllProgress(prev => {
        const next = {
          ...prev,
          [phase]: {
            phase,
            status: data.status === 'done' ? 'done' : data.status === 'error' ? 'error' : 'started',
            count: data.count,
            error: data.error,
            message: data.message || (data.count != null ? `${data.count}` : ''),
          },
        };
        saveSyncProgress(next);
        return next;
      });
    }
  }

  // Sync a single entity phase
  function handleSyncEntity(phase: Phase, limit?: number, forceAll?: boolean) {
    const key = `entity:${phase}${forceAll ? ':force' : ''}`;
    if (syncsInFlight.current.has(key)) return; // prevent duplicate
    syncsInFlight.current.add(key);
    let buffer = '';
    let storedEvents: string[] = [];

    const xhr = new XMLHttpRequest();
    const url = `${API}/sync/trigger${forceAll ? '?forceAll=true' : ''}`;
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');

    const next = { [key]: { phase, xhr, buffer, storedEvents } };
    setActiveSyncs(next);
    saveActiveSyncs(next, key);
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
            storedEvents = [...storedEvents, line].slice(-500);
            sessionStorage.setItem(`syncEvents:${key}`, JSON.stringify(storedEvents));
          } catch (_) {}
        }
      }
      // Update buffer in state
      setActiveSyncs(prev => prev[key] ? { ...prev, [key]: { ...prev[key], buffer, storedEvents } } : prev);
    };

    xhr.onload = () => {
      syncsInFlight.current.delete(key);
      setActiveSyncs(prev => {
        const next = { ...prev };
        delete next[key];
        const newSelectedKey = selectedSyncKey === key ? (Object.keys(next)[0] || null) : selectedSyncKey;
        saveActiveSyncs(next, newSelectedKey);
        return next;
      });
      sessionStorage.removeItem(`syncEvents:${key}`);
      setEntityStatus(prev => ({ ...prev, [phase]: { phase, status: 'done', count: prev[phase]?.count || 0 } }));
      if (selectedSyncKey === key) setSelectedSyncKey(null);
      fetchStatus();
    };
    xhr.onerror = () => {
      syncsInFlight.current.delete(key);
      setActiveSyncs(prev => {
        const next = { ...prev };
        delete next[key];
        const newSelectedKey = selectedSyncKey === key ? (Object.keys(next)[0] || null) : selectedSyncKey;
        saveActiveSyncs(next, newSelectedKey);
        return next;
      });
      sessionStorage.removeItem(`syncEvents:${key}`);
      setEntityStatus(prev => ({ ...prev, [phase]: { phase, status: 'error', error: 'Network error' } }));
      if (selectedSyncKey === key) setSelectedSyncKey(null);
      fetchStatus();
    };
    xhr.send(JSON.stringify({ entity: phase, limit }));
  }

  // Sync All
  function handleSyncAll(forceAll: boolean = false) {
    const key = `entity:all${forceAll ? ':force' : ''}`;
    if (syncsInFlight.current.has(key)) return;
    syncsInFlight.current.add(key);
    let buffer = '';
    let storedEvents: string[] = [];

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/sync/trigger${forceAll ? '?forceAll=true' : ''}`, true);
    xhr.setRequestHeader('Content-Type', 'application/json');

    const next = { [key]: { phase: 'all' as const, xhr, buffer, storedEvents } };
    setActiveSyncs(next);
    saveActiveSyncs(next, key);
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
            // Persist SSE events to sessionStorage for cross-navigation recovery
            storedEvents = [...storedEvents, line].slice(-500);
            sessionStorage.setItem(`syncEvents:${key}`, JSON.stringify(storedEvents));
          } catch (_) {}
        }
      }
      setActiveSyncs(prev => prev[key] ? { ...prev, [key]: { ...prev[key], buffer, storedEvents } } : prev);
    };

    xhr.onload = () => {
      syncsInFlight.current.delete(key);
      if (xhr.status === 409) {
        // Sync already running — poll progress endpoint
        const err = JSON.parse(xhr.responseText);
        setSyncAllProgress(prev => ({
          ...prev,
          tickets: {
            phase: 'tickets',
            status: 'conflict',
            message: `Sync already running (${err.phase || 'unknown'})`,
          },
        }));
        setSyncAllSyncing(true);
        startProgressPolling();
        return;
      }
      setActiveSyncs(prev => {
        const next = { ...prev };
        delete next[key];
        const newSelectedKey = selectedSyncKey === key ? (Object.keys(next)[0] || null) : selectedSyncKey;
        saveActiveSyncs(next, newSelectedKey);
        return next;
      });
      sessionStorage.removeItem(`syncEvents:${key}`);
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
      setSyncAllSyncing(false);
      if (selectedSyncKey === key) setSelectedSyncKey(null);
      fetchStatus();
    };
    xhr.onerror = () => {
      syncsInFlight.current.delete(key);
      setActiveSyncs(prev => {
        const next = { ...prev };
        delete next[key];
        const newSelectedKey = selectedSyncKey === key ? (Object.keys(next)[0] || null) : selectedSyncKey;
        saveActiveSyncs(next, newSelectedKey);
        return next;
      });
      sessionStorage.removeItem(`syncEvents:${key}`);
      sessionStorage.removeItem('syncProgress');
      setSyncAllSyncing(false);
      if (selectedSyncKey === key) setSelectedSyncKey(null);
    };
    xhr.send(JSON.stringify({ entity: 'all' }));
  }

  function phaseIcon(p: PhaseProgress | null) {
    if (!p) return '○';
    if (p.status === 'done') return '✓';
    if (p.status === 'error') return '✗';
    if (p.status === 'cancelled') return '⊘';
    if (p.status === 'conflict') return '⚠';
    if (p.status === 'resuming' || p.status === 'building_catalog') return '◐';
    return '◐';
  }

  function phaseColor(p: PhaseProgress | null) {
    if (!p) return 'text-gray-400';
    if (p.status === 'done') return 'text-green-600';
    if (p.status === 'error') return 'text-red-600';
    if (p.status === 'cancelled') return 'text-orange-600';
    if (p.status === 'conflict') return 'text-red-600 font-bold';
    if (p.status === 'resuming' || p.status === 'building_catalog') return 'text-blue-600';
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
                <button
                  onClick={async () => {
                    if (!confirm('Reset all ticket sync state? This clears in-progress flags so a new sync can start.')) return;
                    const res = await fetch(`${API}/sync/reset`, { method: 'POST' });
                    const data = await res.json();
                    if (data.ok) {
                      setSyncAllProgress(prev => ({ ...prev, tickets: null }));
                      fetchStatus();
                    }
                  }}
                  className="bg-red-600 text-white px-3 py-1 rounded text-xs hover:bg-red-700"
                >
                  Reset Sync State
                </button>
              </div>

              {(activeSyncs['entity:all'] || syncAllSyncing) && (
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
            storedEvents={sync.storedEvents}
            apiUrl={API}
          />
        ) : null
      ))}
    </div>
  );
}
