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

type LastResult = {
  count: number;
  error: string | null;
  last_sync: string | null;
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

  const [lastResults, setLastResults] = useState<Record<Phase, LastResult>>({
    customers: { count: 0, error: null, last_sync: null },
    contacts: { count: 0, error: null, last_sync: null },
    tickets: { count: 0, error: null, last_sync: null },
    invoices: { count: 0, error: null, last_sync: null },
    assets: { count: 0, error: null, last_sync: null },
    estimates: { count: 0, error: null, last_sync: null },
    purchase_orders: { count: 0, error: null, last_sync: null },
    vendors: { count: 0, error: null, last_sync: null },
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
  // Last completed sync — kept so terminal can be reopened to replay events
  const [completedSync, setCompletedSync] = useState<{key: string; sync: ActiveSync} | null>(null);
  const [selectedSyncKey, setSelectedSyncKey] = useState<string | null>(null);

  // Deduplicate SSE events per sync key
  const lastEventRef = useRef<Record<string, string>>({});
  // Prevent duplicate in-flight syncs
  const syncsInFlight = useRef<Set<string>>(new Set());
  // Track whether a sync has already been finalized (done/error) to avoid xhr.onerror overwriting done
  const syncFinalizedRef = useRef<Record<string, boolean>>({});

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

          // Restore ALL stored active sync tabs (multi-sync support).
          // Each entry keeps its own buffered SSE events for terminal replay.
          const storedKeys: string[] = JSON.parse(sessionStorage.getItem('activeSyncs') || '[]');
          const restored: Record<string, ActiveSync> = {};
          const restoredStatus: Partial<Record<Phase, PhaseProgress>> = {};
          let hasAllSync = false;
          for (const k of storedKeys) {
            const isAll = k === 'entity:all' || k === 'entity:all:force';
            const phase = isAll ? 'all' : (k.replace('entity:', '').replace(':force', '') as Phase);
            const storedEventsRaw = sessionStorage.getItem(`syncEvents:${k}`);
            const storedEvents: string[] = storedEventsRaw ? JSON.parse(storedEventsRaw) : [];
            restored[k] = { phase: phase as any, xhr: null, buffer: '', storedEvents };
            if (isAll) {
              hasAllSync = true;
            } else if (phase !== 'all') {
              // Single-entity: seed initial progress from backend state
              const st = data[phase as Phase];
              if (st) {
                const p = buildProgressFromState(phase as Phase, st);
                if (p) restoredStatus[phase as Phase] = p;
              }
            }
          }
          if (Object.keys(restored).length > 0) {
            setActiveSyncs(restored);
          }
          if (Object.keys(restoredStatus).length > 0) {
            setEntityStatus(prev => ({ ...prev, ...restoredStatus }));
          }
          if (hasAllSync) {
            setSyncAllSyncing(true);
          }
          // Selected tab: prefer saved key (if still in restored), else first restored
          const savedKey = loadActiveSyncKey();
          const selected = (savedKey && restored[savedKey]) ? savedKey : Object.keys(restored)[0];
          // Do NOT auto-open terminal on reload — only via View Terminal button.
          // Start polling immediately to keep UI updated (SSE won't reconnect without user action)
          startProgressPolling();
          return;
        }
        // Nothing running on backend — restore completed sync terminal from sessionStorage if available
        syncsInFlight.current.clear();
        sessionStorage.removeItem('activeSyncs');
        setSyncAllSyncing(false);
        setSyncAllProgress({ customers: null, contacts: null, tickets: null, invoices: null, assets: null, estimates: null, purchase_orders: null, vendors: null });
        // Restore completedSync from sessionStorage so View Terminal still works after refresh
        const savedKey = loadActiveSyncKey();
        if (savedKey) {
          const storedEventsRaw = sessionStorage.getItem(`syncEvents:${savedKey}`);
          const storedEvents: string[] = storedEventsRaw ? JSON.parse(storedEventsRaw) : [];
          if (storedEvents.length > 0) {
            setCompletedSync({
              key: savedKey,
              sync: {
                phase: savedKey === 'entity:all' ? 'all' : (savedKey.replace('entity:', '').replace(':force', '') as Phase),
                xhr: null,
                buffer: '',
                storedEvents,
              },
            });
          }
        }
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
      // detail_item_index is the actual DB checkpoint; detail_synced is SSE-cached and can lag
      p.message = `detail ${state.detail_item_index || 0}/${state.detail_total || 0}`;
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
    fetchLastResults();
  }

  function fetchLastResults() {
    fetch(`${API}/sync/last-results`)
      .then(r => r.json())
      .then(data => {
        setLastResults({
          customers: data.customers || { count: 0, error: null, last_sync: null },
          contacts: data.contacts || { count: 0, error: null, last_sync: null },
          tickets: data.tickets || { count: 0, error: null, last_sync: null },
          invoices: data.invoices || { count: 0, error: null, last_sync: null },
          assets: data.assets || { count: 0, error: null, last_sync: null },
          estimates: data.estimates || { count: 0, error: null, last_sync: null },
          purchase_orders: data.purchase_orders || { count: 0, error: null, last_sync: null },
          vendors: data.vendors || { count: 0, error: null, last_sync: null },
        });
      })
      .catch(() => {});
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
    // Capture events before abort — SSE buffer may not flush after abort
    const sync = activeSyncs[key];
    const phase = sync?.phase;
    const isAll = phase === 'all';
    if (sync) {
      const storedEvents = sync.storedEvents || [];
      setCompletedSync({ key, sync: { ...sync, xhr: null, storedEvents } });
    }
    // Tell backend to abort — scope to this specific sync so parallel ones keep running.
    // key format: 'entity:<phase>' or 'entity:<phase>:force' or 'entity:all'[:':force']
    const cancelEntity = phase === 'all' ? 'all' : (phase as string);
    fetch(`${API}/sync/trigger?entity=${encodeURIComponent(cancelEntity)}`, { method: 'DELETE' }).catch(() => {});
    if (sync?.xhr) {
      sync.xhr.abort();
    }
    // XHR abort fires `abort` event, not `error` — onerror never fires.
    // Clean up synchronously so the UI reflects cancel immediately.
    syncsInFlight.current.delete(key);
    syncFinalizedRef.current[key] = true;
    setActiveSyncs(prev => {
      const next = { ...prev };
      delete next[key];
      const newSelectedKey = selectedSyncKey === key ? (Object.keys(next)[0] || null) : selectedSyncKey;
      saveActiveSyncs(next, newSelectedKey);
      return next;
    });
    if (isAll) {
      setSyncAllSyncing(false);
      setSyncAllProgress({ customers: null, contacts: null, tickets: null, invoices: null, assets: null, estimates: null, purchase_orders: null, vendors: null });
      sessionStorage.removeItem('syncProgress');
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
    } else if (phase && phase !== 'all') {
      setEntityStatus(prev => ({ ...prev, [phase as Phase]: { phase: phase as Phase, status: 'cancelled' } }));
    }
    if (selectedSyncKey === key) setSelectedSyncKey(null);
    // Read fresh checkpoint state so UI shows cancel position + resume hint
    setTimeout(() => {
      fetch(`${API}/sync/progress`)
        .then(r => r.json())
        .then(data => {
          if (!isAll && phase && phase !== 'all') {
            const st = data[phase as Phase];
            if (st && st.detail_total) {
              setEntityStatus(prev => ({
                ...prev,
                [phase as Phase]: {
                  phase: phase as Phase,
                  status: 'cancelled',
                  message: `cancelled at ${st.detail_item_index || 0}/${st.detail_total}`,
                },
              }));
            }
          }
          setSyncAllProgress(prev => {
            const next = { ...prev };
            for (const ph of ENTITY_PHASES) {
              const st = data[ph];
              if (st && st.phase && st.phase !== 'idle' && st.phase !== 'error') {
                next[ph] = buildProgressFromState(ph, st);
              }
            }
            saveSyncProgress(next);
            return next;
          });
          fetchLastResults();
        })
        .catch(() => {});
    }, 500);
  }

  function handleEntityProgress(phase: Phase, data: any, key: string) {
    // Ignore events for other entities (backend broadcasts all events to all SSE clients)
    if (data.phase && data.phase !== phase) return;
    // Deduplicate SSE events per phase
    const eventKey = `${data.phase || ''}:${data.status || ''}:${data.current || ''}:${data.count || ''}:${data.error || ''}`;
    if (lastEventRef.current[phase] === eventKey) return;
    lastEventRef.current[phase] = eventKey;

    if (data.type === 'cancelled' || data.status === 'cancelled') {
      syncFinalizedRef.current[key] = true;
      setEntityStatus(prev => ({ ...prev, [phase]: { phase, status: 'cancelled' } }));
      return;
    }
    if (data.phase === 'done') {
      syncFinalizedRef.current[key] = true;
      setEntityStatus(prev => ({ ...prev, [phase]: { phase, status: 'done', count: data.results?.[phase] || 0 } }));
      return;
    }
    if (data.phase === 'error') {
      syncFinalizedRef.current[key] = true;
      setEntityStatus(prev => ({ ...prev, [phase]: { phase, status: 'error', error: data.error } }));
      return;
    }
    if (data.status === 'progress') {
      setEntityStatus(prev => ({
        ...prev,
        [phase]: { phase, status: 'started', message: data.total != null ? `${data.current}/${data.total}` : `${data.current}` },
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
      syncFinalizedRef.current['entity:all'] = true;
      setSyncAllSyncing(false);
      const next = { customers: null, contacts: null, tickets: null, invoices: null, assets: null, estimates: null, purchase_orders: null, vendors: null };
      setSyncAllProgress(next);
      sessionStorage.removeItem('syncProgress');
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
      return;
    }
    if (data.phase === 'done' || data.phase === 'error') {
      syncFinalizedRef.current['entity:all'] = true;
      setSyncAllSyncing(false);
      sessionStorage.removeItem('syncProgress');
      // Persist completed sync terminal to sessionStorage so it survives refresh
      const key = 'entity:all';
      const storedEventsRaw = sessionStorage.getItem(`syncEvents:${key}`);
      const storedEvents: string[] = storedEventsRaw ? JSON.parse(storedEventsRaw) : [];
      sessionStorage.setItem('activeSyncKey', key);
      setCompletedSync({
        key,
        sync: {
          phase: 'all' as const,
          xhr: null,
          buffer: '',
          storedEvents,
        },
      });
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
      fetchStatus();
      return;
    }

    // Progress update
    if (data.phase && data.status === 'progress') {
      const phase = data.phase as Phase;
      let message = '';
      if (phase === 'tickets' && data.subphase === 'catalog') {
        message = `catalog page ${data.current}/${data.total}`;
      } else if (phase === 'tickets' && data.subphase === 'detail') {
        message = `detail ${data.current}/${data.total}`;
      } else {
        message = data.total != null ? `${data.current}/${data.total}` : `${data.current}`;
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
  function handleSyncEntity(phase: Phase, forceAll?: boolean) {
    const key = `entity:${phase}${forceAll ? ':force' : ''}`;
    if (syncsInFlight.current.has(key)) return; // prevent duplicate
    syncsInFlight.current.add(key);
    let buffer = '';
    let storedEvents: string[] = [];

    const xhr = new XMLHttpRequest();
    const url = `${API}/sync/trigger${forceAll ? '?forceAll=true' : ''}`;
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');

    const entry = { phase, xhr, buffer, storedEvents };
    // Merge with any already-running syncs — don't wipe them.
    setActiveSyncs(prev => ({ ...prev, [key]: entry }));
    const storedKeys = JSON.parse(sessionStorage.getItem('activeSyncs') || '[]');
    sessionStorage.setItem('activeSyncs', JSON.stringify(Array.from(new Set([...storedKeys, key]))));
    sessionStorage.setItem('activeSyncKey', key);
    // Do NOT auto-open terminal — only via View Terminal button.
    setCompletedSync(null);
    setEntityStatus(prev => ({ ...prev, [phase]: { phase, status: 'started', message: 'Starting...' } }));

    xhr.onprogress = () => {
      buffer += xhr.responseText.slice(buffer.length);
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            handleEntityProgress(phase, data, key);
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
      // Don't double-process if SSE already finalized and moved the sync
      if (syncFinalizedRef.current[key]) return;
      syncFinalizedRef.current[key] = true;
      setActiveSyncs(prev => {
        const next = { ...prev };
        const completed = next[key];
        if (completed) {
          setCompletedSync({ key, sync: { ...completed, xhr: null } });
          delete next[key];
        }
        const newSelectedKey = selectedSyncKey === key ? (Object.keys(next)[0] || null) : selectedSyncKey;
        saveActiveSyncs(next, newSelectedKey);
        return next;
      });
      setEntityStatus(prev => ({ ...prev, [phase]: { phase, status: 'done', count: prev[phase]?.count || 0 } }));
      if (selectedSyncKey === key) setSelectedSyncKey(null);
      fetchStatus();
    };
    xhr.onerror = () => {
      syncsInFlight.current.delete(key);
      // Don't double-process if SSE already finalized
      if (syncFinalizedRef.current[key]) return;
      syncFinalizedRef.current[key] = true;
      setActiveSyncs(prev => {
        const next = { ...prev };
        const completed = next[key];
        if (completed) {
          setCompletedSync({ key, sync: { ...completed, xhr: null } });
          delete next[key];
        }
        const newSelectedKey = selectedSyncKey === key ? (Object.keys(next)[0] || null) : selectedSyncKey;
        saveActiveSyncs(next, newSelectedKey);
        return next;
      });
      // Don't overwrite done/cancelled state if SSE already finalized it
      setEntityStatus(prev => ({ ...prev, [phase]: { phase, status: 'error', error: 'Network error' } }));
      if (selectedSyncKey === key) setSelectedSyncKey(null);
      fetchStatus();
    };
    xhr.send(JSON.stringify({ entity: phase }));
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

    const entry = { phase: 'all' as const, xhr, buffer, storedEvents };
    setActiveSyncs(prev => ({ ...prev, [key]: entry }));
    const storedKeys = JSON.parse(sessionStorage.getItem('activeSyncs') || '[]');
    sessionStorage.setItem('activeSyncs', JSON.stringify(Array.from(new Set([...storedKeys, key]))));
    sessionStorage.setItem('activeSyncKey', key);
    // Do NOT auto-open terminal — only via View Terminal button.
    setCompletedSync(null);
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
      // Don't double-process if SSE already finalized
      if (!syncFinalizedRef.current[key]) {
        syncFinalizedRef.current[key] = true;
        setActiveSyncs(prev => {
          const next = { ...prev };
          const completed = next[key];
          if (completed) {
            setCompletedSync({ key, sync: { ...completed, xhr: null } });
            delete next[key];
          }
          const newSelectedKey = selectedSyncKey === key ? (Object.keys(next)[0] || null) : selectedSyncKey;
          saveActiveSyncs(next, newSelectedKey);
          return next;
        });
        sessionStorage.removeItem(`syncEvents:${key}`);
      }
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
      setSyncAllSyncing(false);
      if (selectedSyncKey === key) setSelectedSyncKey(null);
      fetchStatus();
    };
    xhr.onerror = () => {
      syncsInFlight.current.delete(key);
      if (syncFinalizedRef.current[key]) return;
      syncFinalizedRef.current[key] = true;
      setActiveSyncs(prev => {
        const next = { ...prev };
        const completed = next[key];
        if (completed) {
          setCompletedSync({ key, sync: { ...completed, xhr: null } });
          delete next[key];
        }
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
                const progress = entityStatus[phase] || syncAllProgress[phase];
                const isRunning = syncing;

                return (
                  <div key={phase} className="flex items-center gap-2">
                    <span className={`text-sm w-4 text-center ${phaseColor(progress)}`}>
                      {phaseIcon(progress)}
                    </span>
                    <span className="text-sm text-gray-700 w-32">{PHASE_LABELS[phase]}</span>
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
                      onClick={() => handleSyncEntity(phase, true)}
                      disabled={!!activeSyncs[`entity:${phase}:force`]}
                      className="px-3 py-1.5 rounded text-sm border border-orange-300 text-orange-700 bg-orange-50 hover:bg-orange-100 disabled:opacity-50"
                      title="Re-sync all records regardless of last sync time"
                    >
                      Re-sync
                    </button>
                    {progress?.status === 'started' && (
                      <span className="text-xs text-blue-600">{progress.message}</span>
                    )}
                    {progress?.status === 'done' && (
                      <span className="text-xs text-gray-500">done ({progress.count})</span>
                    )}
                    {progress?.status === 'error' && (
                      <span className="text-xs text-red-500">{progress.error}</span>
                    )}
                    {progress?.status === 'cancelled' && (
                      <span className="text-xs text-orange-500">Cancelled</span>
                    )}
                    {progress?.status === 'conflict' && (
                      <span className="text-xs text-red-600 font-bold">{progress.message}</span>
                    )}
                    {!progress && lastResults[phase].error === 'cancelled' && (
                      <span className="text-xs text-orange-500">Cancelled ({lastResults[phase].count})</span>
                    )}
                    {!progress && lastResults[phase].error && lastResults[phase].error !== 'cancelled' && (
                      <span className="text-xs text-red-500">✗ {lastResults[phase].error}</span>
                    )}
                    {!progress && !lastResults[phase].error && lastResults[phase].count > 0 && (
                      <span className="text-xs text-green-600">✓ {lastResults[phase].count}</span>
                    )}
                  </div>
                );
              })}
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
                <button
                  onClick={() => {
                    const keyToOpen = anySyncing ? activeSyncList[0]?.[0] : (completedSync?.key || null);
                    if (keyToOpen) {
                      setSelectedSyncKey(selectedSyncKey === keyToOpen ? null : keyToOpen);
                    } else if (completedSync?.key) {
                      setSelectedSyncKey(selectedSyncKey === completedSync.key ? null : completedSync.key);
                    } else if (activeSyncList.length > 0) {
                      setSelectedSyncKey(selectedSyncKey === activeSyncList[0][0] ? null : activeSyncList[0][0]);
                    }
                  }}
                  className="bg-black text-green-400 px-3 py-1 rounded text-xs font-mono border border-green-700 hover:bg-gray-900"
                >
                  View Terminal
                </button>
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
      {/* Completed sync terminal — load events from sessionStorage */}
      {completedSync && selectedSyncKey === completedSync.key ? (
        <SyncTerminal
          key={completedSync.key}
          onClose={() => setSelectedSyncKey(null)}
          xhr={null}
          bufferRef={{ current: '' }}
          storedEvents={completedSync.sync.storedEvents}
          apiUrl={API}
        />
      ) : null}
    </div>
  );
}
