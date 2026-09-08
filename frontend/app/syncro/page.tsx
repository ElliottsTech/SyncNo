'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SyncTerminal from '@/components/SyncTerminal';
import type { HttpLogEntry } from '@/components/SyncTerminal';
import CollapsibleSection from '../../components/CollapsibleSection';
import { usePageTitle } from '../../lib/usePageTitle';

// All API calls go through the Next.js rewrite proxy (/api → backend).
const API = '/api';

type Phase = 'customers' | 'contacts' | 'tickets' | 'invoices' | 'assets' | 'estimates' | 'purchase_orders' | 'vendors' | 'products' | 'payments' | 'product_serials' | 'appointments' | 'contracts' | 'leads' | 'policy_folders' | 'portal_users' | 'schedules' | 'syncro_users' | 'wiki_pages' | 'worksheet_results';

type PhaseProgress = {
  phase: Phase;
  status: 'started' | 'done' | 'error' | 'cancelled' | 'conflict' | 'resuming' | 'building_catalog' | 'paused' | 'rate_limited';
  count?: number;
  error?: string;
  message?: string;
  pause_attempt?: number;
  pause_minutes?: number;
  resume_at?: string;
};

type LastResult = {
  count: number;
  error: string | null;
  last_sync: string | null;
  total_to_sync: number;
  db_count: number;
  pause_attempt: number;
  last_pause_until: string | null;
};

const ENTITY_PHASES: Phase[] = ['customers', 'contacts', 'tickets', 'invoices', 'assets', 'estimates', 'purchase_orders', 'vendors', 'products', 'payments', 'product_serials', 'appointments', 'contracts', 'leads', 'policy_folders', 'portal_users', 'schedules', 'syncro_users', 'wiki_pages', 'worksheet_results'];

const PHASE_LABELS: Record<Phase, string> = {
  customers: 'Customers',
  contacts: 'Contacts',
  tickets: 'Tickets',
  invoices: 'Invoices',
  assets: 'Assets',
  estimates: 'Estimates',
  purchase_orders: 'Purchase Orders',
  vendors: 'Vendors',
  products: 'Products',
  payments: 'Payments',
  product_serials: 'Product Serials',
  appointments: 'Appointments',
  contracts: 'Contracts',
  leads: 'Leads',
  policy_folders: 'Policy Folders',
  portal_users: 'Portal Users',
  schedules: 'Schedules',
  syncro_users: 'Syncro Users',
  wiki_pages: 'Wiki Pages',
  worksheet_results: 'Worksheet Results',
};

type ActiveSync = {
  phase: Phase | 'all';
  xhr: XMLHttpRequest | null;
  buffer: string;
  storedEvents: string[];  // SSE event lines persisted to sessionStorage
};

function SchedulerSection({ visiblePhases }: { visiblePhases: Phase[] }) {
  const [schedule, setSchedule] = useState<Record<string, { time: string; enabled: boolean; last_fired: string | null }>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/sync/schedule`)
      .then(r => r.json())
      .then(data => {
        const s = data.schedule || {};
        setSchedule(s);
        const d: Record<string, string> = {};
        for (const ent of visiblePhases) {
          d[ent] = s[ent]?.time || '';
        }
        setDraft(d);
      })
      .catch(e => setError(e.message));
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, string> = {};
      for (const ent of visiblePhases) {
        payload[ent] = (draft[ent] || '').trim();
      }
      const res = await fetch(`${API}/sync/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'save failed');
      setSchedule(data.schedule || {});
      setSavedAt(Date.now());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function fmtLastFired(s: string | null) {
    if (!s) return 'never';
    return s;
  }

  return (
    <CollapsibleSection
      title="Scheduler"
      containerClassName="bg-white rounded border p-4 mb-4 border-t-0"
      bodyClassName="mt-3"
      headerClassName="w-full flex justify-between items-center text-left -mt-1 mb-3"
      defaultOpen={false}
    >
      <div className="text-xs text-gray-500 -mt-2 mb-3">Daily delta sync per entity (server local time)</div>
      <div className="grid grid-cols-1 gap-2">
        {visiblePhases.map(phase => {
          const cfg = schedule[phase] || { time: '', enabled: false, last_fired: null };
          const draftVal = draft[phase] ?? '';
          return (
            <div key={phase} className="flex items-center gap-3 text-sm">
              <span className="text-gray-700 w-32">{PHASE_LABELS[phase]}</span>
              <input
                type="time"
                value={draftVal}
                onChange={e => setDraft(prev => ({ ...prev, [phase]: e.target.value }))}
                className="px-2 py-1 border rounded font-mono text-sm"
              />
              {cfg.enabled ? (
                <span className="text-xs text-green-600">scheduled {cfg.time}</span>
              ) : (
                <span className="text-xs text-gray-400">disabled</span>
              )}
              <span className="text-xs text-gray-400">last: {fmtLastFired(cfg.last_fired)}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 mt-4">
        <button
          onClick={save}
          disabled={saving}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Schedule'}
        </button>
        {savedAt && !error && (
          <span className="text-xs text-green-600">Saved ✓</span>
        )}
        {error && (
          <span className="text-xs text-red-600">{error}</span>
        )}
        <span className="text-xs text-gray-500 ml-auto">
          Empty time = disabled. Scheduler checks every minute; fires once per day per entity.
        </span>
      </div>
    </CollapsibleSection>
  );
}

export default function SyncroPage() {
  usePageTitle('Syncro Sync — Syncno');
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (authStatus === 'authenticated' && session?.user?.role !== 'admin') {
      router.replace('/');
    }
  }, [authStatus, session, router]);

  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Enabled entities drives visibility in SchedulerSection + Sync Data section.
  // Default = all enabled until fetch completes (matches pre-feature behavior).
  const [enabledEntities, setEnabledEntities] = useState<Set<Phase>>(() => new Set(ENTITY_PHASES));
  useEffect(() => {
    fetch(`${API}/sync/enabled`)
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.entities)) setEnabledEntities(new Set(d.entities as Phase[]));
      })
      .catch(() => {});
  }, []);
  const visiblePhases = ENTITY_PHASES.filter(p => enabledEntities.has(p));

  const [entityStatus, setEntityStatus] = useState<Record<Phase, PhaseProgress | null>>(
    () => Object.fromEntries(ENTITY_PHASES.map(p => [p, null])) as Record<Phase, PhaseProgress | null>
  );

  const [lastResults, setLastResults] = useState<Record<Phase, LastResult>>(
    () => Object.fromEntries(ENTITY_PHASES.map(p => [p, { count: 0, error: null, last_sync: null, total_to_sync: 0, db_count: 0, pause_attempt: 0, last_pause_until: null }])) as Record<Phase, LastResult>
  );

  const [syncAllSyncing, setSyncAllSyncing] = useState(false);
  const [syncAllProgress, setSyncAllProgress] = useState<Record<Phase, PhaseProgress | null>>(
    () => Object.fromEntries(ENTITY_PHASES.map(p => [p, null])) as Record<Phase, PhaseProgress | null>
  );

  // Optional date range for sync runs. Currently applied to appointments only
  // (Syncro /appointments supports date_from/date_to; other endpoints ignore).
  // Empty = use backend defaults (appointments = 10y back / 2y forward).
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showDatePanel, setShowDatePanel] = useState(false);
  const datePanelRef = useRef<HTMLDivElement>(null);

  // Close date panel on outside click
  useEffect(() => {
    if (!showDatePanel) return;
    function onDown(e: MouseEvent) {
      if (datePanelRef.current && !datePanelRef.current.contains(e.target as Node)) {
        setShowDatePanel(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showDatePanel]);

  const [previewing, setPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<any>(null);

  // Serial → PO link job (standalone, not part of the entity grid).
  const [linkingPos, setLinkingPos] = useState(false);
  const [linkPosProgress, setLinkPosProgress] = useState<string | null>(null);
  type LinkStats = { current?: number; total?: number; linked?: number; noPo?: number; errors?: number; remaining?: number; etaMs?: number | null; elapsedMs?: number };
  const [linkPosStats, setLinkPosStats] = useState<LinkStats | null>(null);
  const [linkPosResult, setLinkPosResult] = useState<{ ok: boolean; message?: string; error?: string; count?: number } | null>(null);
  const [linkPosForceAll, setLinkPosForceAll] = useState(false);
  const [webSessionConfigured, setWebSessionConfigured] = useState<boolean | null>(null);
  const linkPosXhrRef = useRef<XMLHttpRequest | null>(null);
  const linkPosPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // PO Attachments sync job (Syncro web-cookie scrape, standalone).
  const [syncingPoAtts, setSyncingPoAtts] = useState(false);
  const [poAttProgress, setPoAttProgress] = useState<string | null>(null);
  const [poAttStats, setPoAttStats] = useState<LinkStats | null>(null);
  const [poAttResult, setPoAttResult] = useState<{ ok: boolean; message?: string; error?: string; count?: number } | null>(null);
  const [poAttForceAll, setPoAttForceAll] = useState(false);
  const poAttXhrRef = useRef<XMLHttpRequest | null>(null);
  const poAttPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // QBO attachment sync (standalone, not part of the entity grid).
  const [qboSyncing, setQboSyncing] = useState(false);
  type QboSyncStats = { current?: number; total?: number; currentRecordName?: string | null; matched?: number; downloaded?: number; skipped?: number; errors?: string[] };
  const [qboSyncStats, setQboSyncStats] = useState<QboSyncStats | null>(null);
  const [qboSyncResult, setQboSyncResult] = useState<{ ok: boolean; message?: string; error?: string } | null>(null);
  const [qboConnected, setQboConnected] = useState<boolean | null>(null);
  const qboSyncXhrRef = useRef<XMLHttpRequest | null>(null);

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
        const states = ENTITY_PHASES.map(p => data[p]);
        const anyRunning = states.some(s => s && s.phase && s.phase !== 'idle' && s.phase !== 'error');

        if (anyRunning) {
          // Sync is running on backend — show its state, do NOT restart
          // Restore syncAllProgress from sessionStorage (survives refresh),
          // then overlay with fresh backend state for accuracy
          const storedProgress = loadSyncProgress();
          const backendProgress = Object.fromEntries(
            ENTITY_PHASES.map(p => [p, buildProgressFromState(p, data[p])])
          ) as Record<Phase, PhaseProgress>;
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
        setSyncAllProgress(Object.fromEntries(ENTITY_PHASES.map(p => [p, null])) as Record<Phase, PhaseProgress | null>);
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

  // Check whether the Syncro web-session cookie is configured (gates the
  // serial→PO link job button).
  useEffect(() => {
    fetch(`${API}/sync/web-session`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setWebSessionConfigured(!!d.configured); })
      .catch(() => {});
  }, []);

  // Check whether QuickBooks Online is connected (gates the QBO attachment
  // sync button).
  useEffect(() => {
    fetch(`${API}/qbo-settings`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setQboConnected(!!d.connected); })
      .catch(() => {});
  }, []);

  // If the serial→PO link job is already running on the backend (e.g. page was
  // refreshed mid-run), resume showing its progress via polling.
  useEffect(() => {
    fetch(`${API}/sync/progress`)
      .then(r => r.json())
      .then(d => {
        const st = d['serial_po_links'];
        if (st && st.phase && st.phase !== 'idle' && st.phase !== 'error') {
          setLinkingPos(true);
          setLinkPosStats({ current: st.detail_synced, total: st.detail_total });
          setLinkPosProgress(`Resumed — ${st.detail_synced}/${st.detail_total}`);
          // Start polling for live updates.
          if (!linkPosPollRef.current) {
            linkPosPollRef.current = setInterval(() => {
              fetch(`${API}/sync/progress`)
                .then(r => r.json())
                .then(d2 => {
                  const s2 = d2['serial_po_links'];
                  if (!s2) return;
                  if (s2.phase === 'idle' || s2.phase === 'error') {
                    if (linkPosPollRef.current) { clearInterval(linkPosPollRef.current); linkPosPollRef.current = null; }
                    setLinkingPos(false);
                    setLinkPosProgress(null);
                    if (s2.phase === 'error' && s2.last_result_error) {
                      setLinkPosResult({ ok: false, error: s2.last_result_error });
                    } else {
                      setLinkPosResult({ ok: true, message: `Linked ${s2.last_result_count || 0} serials to POs`, count: s2.last_result_count });
                    }
                  } else {
                    setLinkPosStats({ current: s2.detail_synced, total: s2.detail_total });
                  }
                })
                .catch(() => {});
            }, 3000);
          }
        }
      })
      .catch(() => {});
  }, []);

  // If the PO attachments sync job is already running, resume showing progress.
  useEffect(() => {
    fetch(`${API}/sync/progress`)
      .then(r => r.json())
      .then(d => {
        const st = d['po_attachments_syncro'];
        if (st && st.phase && st.phase !== 'idle' && st.phase !== 'error') {
          setSyncingPoAtts(true);
          setPoAttStats({ current: st.detail_synced, total: st.detail_total });
          setPoAttProgress(`Resumed — ${st.detail_synced}/${st.detail_total}`);
          if (!poAttPollRef.current) {
            poAttPollRef.current = setInterval(() => {
              fetch(`${API}/sync/progress`)
                .then(r => r.json())
                .then(d2 => {
                  const s2 = d2['po_attachments_syncro'];
                  if (!s2) return;
                  if (s2.phase === 'idle' || s2.phase === 'error') {
                    if (poAttPollRef.current) { clearInterval(poAttPollRef.current); poAttPollRef.current = null; }
                    setSyncingPoAtts(false);
                    setPoAttProgress(null);
                    if (s2.phase === 'error' && s2.last_result_error) {
                      setPoAttResult({ ok: false, error: s2.last_result_error });
                    } else {
                      setPoAttResult({ ok: true, message: `Downloaded ${s2.last_result_count || 0} attachments`, count: s2.last_result_count });
                    }
                  } else {
                    setPoAttStats({ current: s2.detail_synced, total: s2.detail_total });
                  }
                })
                .catch(() => {});
            }, 3000);
          }
        }
      })
      .catch(() => {});
  }, []);

  function buildProgressFromState(phase: Phase, state: any): PhaseProgress {
    if (!state || state.phase === 'idle' || state.phase === 'error') return null;
    const p: PhaseProgress = { phase: phase as Phase, status: 'started' };
    if (state.phase === 'catalog') {
      p.message = `catalog page ${state.last_page_synced || 0}/${state.total_pages || '?'}`;
    } else if (state.phase === 'detail') {
      // detail_item_index is the actual DB checkpoint for most entities; detail_synced
      // is SSE-cached and can lag. Tickets uses detail_synced as its checkpoint instead
      // (detail_item_index never updated for tickets), so fall back to it.
      const synced = state.detail_item_index || state.detail_synced || 0;
      p.message = `detail ${synced}/${state.detail_total || 0}`;
    } else if (state.phase === 'paused') {
      p.status = 'paused';
      p.pause_attempt = state.pause_attempt;
      p.resume_at = state.last_pause_until;
      const mins = state.last_pause_until
        ? Math.max(1, Math.round((new Date(state.last_pause_until).getTime() - Date.now()) / 60000))
        : '?';
      p.message = `Paused ${mins}min (attempt #${state.pause_attempt || '?'})`;
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
        const states = [data.tickets, data.customers, data.contacts, data.invoices, data.assets, data.estimates, data.purchase_orders, data.vendors, data.products, data.payments, data.product_serials];
        const anyRunning = states.some(s => s && s.phase && s.phase !== 'idle' && s.phase !== 'error');
        if (!anyRunning) {
          clearInterval(pollIntervalRef.current!);
          pollIntervalRef.current = null;
          setSyncAllSyncing(false);
          setSyncAllProgress(Object.fromEntries(ENTITY_PHASES.map(p => [p, null])) as Record<Phase, PhaseProgress | null>);
          setActiveSyncs({});
          fetchStatus();
          return;
        }
        setSyncAllProgress(
          Object.fromEntries(ENTITY_PHASES.map(p => [p, buildProgressFromState(p, data[p])])) as Record<Phase, PhaseProgress>
        );
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
        setLastResults(
          Object.fromEntries(ENTITY_PHASES.map(p => [p, data[p] || { count: 0, error: null, last_sync: null, total_to_sync: 0, db_count: 0, pause_attempt: 0, last_pause_until: null }])) as Record<Phase, LastResult>
        );
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

  // Serial → PO link job — streams progress via XHR+SSE (same pattern as
  // handleSyncEntity, but a standalone action, not an entity-grid sync).
  function handleLinkPos() {
    if (linkingPos) return;
    setLinkingPos(true);
    setLinkPosResult(null);
    setLinkPosStats(null);
    setLinkPosProgress('Starting…');

    const xhr = new XMLHttpRequest();
    linkPosXhrRef.current = xhr;
    const url = `${API}/sync/link-serial-pos${linkPosForceAll ? '?forceAll=true' : ''}`;
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');

    // Helper to apply the structured stats fields from any event.
    const applyStats = (data: any) => {
      if (data.current != null || data.total != null || data.linked != null || data.etaMs != null) {
        setLinkPosStats({
          current: data.current, total: data.total,
          linked: data.linked, noPo: data.noPo, errors: data.errors,
          remaining: data.remaining, etaMs: data.etaMs, elapsedMs: data.elapsedMs,
        });
      }
    };

    let buffer = '';
    xhr.onprogress = () => {
      buffer += xhr.responseText.slice(buffer.length);
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            // Filter: only process THIS job's events. The backend fans out all
            // SSE events to all connected clients, so without this filter the
            // two jobs' stats would cross-contaminate when run simultaneously.
            if (data.phase && data.phase !== 'serial_po_links') continue;
            applyStats(data);
            if (data.message) setLinkPosProgress(data.message);
            if (data.status === 'done') {
              setLinkPosResult({ ok: true, message: data.message, count: data.count });
            } else if (data.status === 'cancelled') {
              setLinkPosResult({ ok: true, message: data.message || 'Cancelled — progress saved. Re-run to resume.' });
            } else if (data.status === 'error') {
              setLinkPosResult({ ok: false, error: data.error, message: data.message, count: data.count });
            }
          } catch (_) {}
        }
      }
    };

    // Polling fallback: if the page is refreshed mid-run, the SSE stream is lost.
    // Poll /progress to keep the stats live until the job finishes.
    const startPolling = () => {
      if (linkPosPollRef.current) return;
      linkPosPollRef.current = setInterval(() => {
        fetch(`${API}/sync/progress`)
          .then(r => r.json())
          .then(d => {
            const st = d['serial_po_links'];
            if (!st) return;
            if (st.phase === 'idle' || st.phase === 'error') {
              // Job ended (completed or errored) — stop polling.
              if (linkPosPollRef.current) { clearInterval(linkPosPollRef.current); linkPosPollRef.current = null; }
              if (!linkingPos) return;
              setLinkingPos(false);
              if (st.phase === 'error' && st.last_result_error && !linkPosResult) {
                setLinkPosResult({ ok: false, error: st.last_result_error });
              } else if (!linkPosResult) {
                setLinkPosResult({ ok: true, message: `Linked ${st.last_result_count || 0} serials to POs`, count: st.last_result_count });
              }
            } else {
              setLinkPosStats(prev => ({
                ...prev,
                current: st.detail_synced ?? prev?.current,
                total: st.detail_total ?? prev?.total,
              }));
            }
          })
          .catch(() => {});
      }, 3000);
    };

    xhr.onload = () => {
      setLinkingPos(false);
      linkPosXhrRef.current = null;
      if (linkPosPollRef.current) { clearInterval(linkPosPollRef.current); linkPosPollRef.current = null; }
      // Refresh web-session status in case the cookie expired during the run.
      fetch(`${API}/sync/web-session`).then(r => r.ok ? r.json() : null).then(d => { if (d) setWebSessionConfigured(!!d.configured); }).catch(() => {});
    };
    xhr.onerror = () => {
      setLinkingPos(false);
      linkPosXhrRef.current = null;
      if (linkPosPollRef.current) { clearInterval(linkPosPollRef.current); linkPosPollRef.current = null; }
      if (!linkPosResult) setLinkPosResult({ ok: false, error: 'Network error' });
    };
    xhr.send(JSON.stringify({}));
    startPolling();
  }

  function cancelLinkPos() {
    const xhr = linkPosXhrRef.current;
    if (xhr) {
      try { xhr.abort(); } catch (_) {}
      linkPosXhrRef.current = null;
    }
    if (linkPosPollRef.current) { clearInterval(linkPosPollRef.current); linkPosPollRef.current = null; }
    // Optimistically clear local state so the UI responds immediately, then
    // verify the backend actually dropped to idle. The backend DELETE handler
    // always reconciles DB state (even if no live runner exists), so this
    // fetch should normally succeed and confirm cancellation.
    setLinkingPos(false);
    setLinkPosProgress(null);
    setLinkPosResult(prev => prev ? prev : { ok: true, message: 'Cancelled — progress saved. Re-run to resume.' });
    fetch(`${API}/sync/link-serial-pos`, { method: 'DELETE' })
      .then(async r => {
        const body = await r.json().catch(() => ({}));
        // Re-read /progress to confirm backend state matches our local UI.
        // If the backend still reports running (shouldn't happen now that the
        // DELETE always reconciles), surface that to the user instead of
        // silently leaving the button greyed out.
        return fetch(`${API}/sync/progress`).then(r2 => r2.json()).then(d => {
          const st = d['serial_po_links'];
          if (st && st.phase && st.phase !== 'idle' && st.phase !== 'error') {
            setLinkPosResult({ ok: false, error: 'Backend still reports running — try refreshing the page' });
          } else if (body && body.cancelled === false) {
            // No live runner to cancel (e.g. backend was restarted); the job
            // simply wasn't running on the server anymore.
            setLinkPosResult(prev => prev && prev.error === 'Cancelled' ? prev : { ok: false, error: 'Job was no longer running on the server' });
          }
        });
      })
      .catch(() => { /* network error — optimistic state already cleared */ });
  }

  // PO Attachments sync (Syncro web-cookie scrape) — same XHR+SSE pattern.
  function handleSyncPoAtts() {
    if (syncingPoAtts) return;
    setSyncingPoAtts(true);
    setPoAttResult(null);
    setPoAttStats(null);
    setPoAttProgress('Starting…');

    const xhr = new XMLHttpRequest();
    poAttXhrRef.current = xhr;
    const url = `${API}/sync/sync-po-attachments${poAttForceAll ? '?forceAll=true' : ''}`;
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');

    const applyStats = (data: any) => {
      if (data.current != null || data.total != null || data.downloaded != null || data.etaMs != null) {
        setPoAttStats({
          current: data.current, total: data.total,
          linked: data.downloaded, noPo: data.skipped, errors: data.errors,
          remaining: data.remaining, etaMs: data.etaMs, elapsedMs: data.elapsedMs,
        });
      }
    };

    let buffer = '';
    xhr.onprogress = () => {
      buffer += xhr.responseText.slice(buffer.length);
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            // Filter: only process THIS job's events (see handleLinkPos for why).
            if (data.phase && data.phase !== 'po_attachments_syncro') continue;
            applyStats(data);
            if (data.message) setPoAttProgress(data.message);
            if (data.status === 'done') {
              setPoAttResult({ ok: true, message: data.message, count: data.count });
            } else if (data.status === 'cancelled') {
              setPoAttResult({ ok: true, message: data.message || 'Cancelled — progress saved. Re-run to resume.' });
            } else if (data.status === 'error') {
              setPoAttResult({ ok: false, error: data.error, message: data.message, count: data.count });
            }
          } catch (_) {}
        }
      }
    };

    const startPolling = () => {
      if (poAttPollRef.current) return;
      poAttPollRef.current = setInterval(() => {
        fetch(`${API}/sync/progress`)
          .then(r => r.json())
          .then(d => {
            const st = d['po_attachments_syncro'];
            if (!st) return;
            if (st.phase === 'idle' || st.phase === 'error') {
              if (poAttPollRef.current) { clearInterval(poAttPollRef.current); poAttPollRef.current = null; }
              if (!syncingPoAtts) return;
              setSyncingPoAtts(false);
              if (st.phase === 'error' && st.last_result_error && !poAttResult) {
                setPoAttResult({ ok: false, error: st.last_result_error });
              } else if (!poAttResult) {
                setPoAttResult({ ok: true, message: `Downloaded ${st.last_result_count || 0} attachments`, count: st.last_result_count });
              }
            } else {
              setPoAttStats(prev => ({ ...prev, current: st.detail_synced ?? prev?.current, total: st.detail_total ?? prev?.total }));
            }
          })
          .catch(() => {});
      }, 3000);
    };

    xhr.onload = () => {
      setSyncingPoAtts(false);
      poAttXhrRef.current = null;
      if (poAttPollRef.current) { clearInterval(poAttPollRef.current); poAttPollRef.current = null; }
    };
    xhr.onerror = () => {
      setSyncingPoAtts(false);
      poAttXhrRef.current = null;
      if (poAttPollRef.current) { clearInterval(poAttPollRef.current); poAttPollRef.current = null; }
      if (!poAttResult) setPoAttResult({ ok: false, error: 'Network error' });
    };
    xhr.send(JSON.stringify({}));
    startPolling();
  }

  function cancelSyncPoAtts() {
    const xhr = poAttXhrRef.current;
    if (xhr) {
      try { xhr.abort(); } catch (_) {}
      poAttXhrRef.current = null;
    }
    if (poAttPollRef.current) { clearInterval(poAttPollRef.current); poAttPollRef.current = null; }
    // Optimistic local clear; verify with backend below.
    setSyncingPoAtts(false);
    setPoAttProgress(null);
    setPoAttResult(prev => prev ? prev : { ok: true, message: 'Cancelled — progress saved. Re-run to resume.' });
    fetch(`${API}/sync/sync-po-attachments`, { method: 'DELETE' })
      .then(async r => {
        const body = await r.json().catch(() => ({}));
        return fetch(`${API}/sync/progress`).then(r2 => r2.json()).then(d => {
          const st = d['po_attachments_syncro'];
          if (st && st.phase && st.phase !== 'idle' && st.phase !== 'error') {
            setPoAttResult({ ok: false, error: 'Backend still reports running — try refreshing the page' });
          } else if (body && body.cancelled === false) {
            setPoAttResult(prev => prev && prev.error === 'Cancelled' ? prev : { ok: false, error: 'Job was no longer running on the server' });
          }
        });
      })
      .catch(() => {});
  }

  // QBO attachment sync — streams progress via XHR+SSE (same pattern as
  // handleLinkPos). Pulls file attachments from QuickBooks Online POs.
  function handleQboSync() {
    if (qboSyncing) return;
    setQboSyncing(true);
    setQboSyncResult(null);
    setQboSyncStats(null);

    const xhr = new XMLHttpRequest();
    qboSyncXhrRef.current = xhr;
    xhr.open('POST', `${API}/qbo-attachments/sync`, true);
    xhr.setRequestHeader('Content-Type', 'application/json');

    let buffer = '';
    xhr.onprogress = () => {
      buffer += xhr.responseText.slice(buffer.length);
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.status === 'progress') {
              setQboSyncStats({
                current: data.current, total: data.total,
                currentRecordName: data.currentRecordName,
                matched: data.matched, downloaded: data.downloaded,
                skipped: data.skipped, errors: data.errors,
              });
            } else if (data.status === 'done') {
              setQboSyncStats({
                matched: data.matched, downloaded: data.downloaded,
                skipped: data.skipped, errors: data.errors,
                total: data.total,
              });
              setQboSyncResult({
                ok: true,
                message: `${data.downloaded || 0} downloaded, ${data.skipped || 0} skipped across ${data.matched || 0} matched POs`,
              });
            } else if (data.status === 'error') {
              setQboSyncResult({ ok: false, error: data.error });
            }
            // 'complete' is the terminal marker — no action needed beyond what
            // 'done'/'error' already set.
          } catch (_) {}
        }
      }
    };
    xhr.onload = () => {
      setQboSyncing(false);
      qboSyncXhrRef.current = null;
    };
    xhr.onerror = () => {
      setQboSyncing(false);
      qboSyncXhrRef.current = null;
      if (!qboSyncResult) setQboSyncResult({ ok: false, error: 'Network error' });
    };
    xhr.send(JSON.stringify({}));
  }

  function cancelQboSync() {
    const xhr = qboSyncXhrRef.current;
    if (xhr) {
      try { xhr.abort(); } catch (_) {}
      qboSyncXhrRef.current = null;
    }
    setQboSyncing(false);
    setQboSyncResult(prev => prev ? prev : { ok: false, error: 'Cancelled' });
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
      setSyncAllProgress(Object.fromEntries(ENTITY_PHASES.map(p => [p, null])) as Record<Phase, PhaseProgress | null>);
      sessionStorage.removeItem('syncProgress');
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
    } else if (phase) {
      setEntityStatus(prev => ({ ...prev, [phase as Phase]: { phase: phase as Phase, status: 'cancelled' } }));
    }
    if (selectedSyncKey === key) setSelectedSyncKey(null);
    // Read fresh checkpoint state so UI shows cancel position + resume hint
    setTimeout(() => {
      fetch(`${API}/sync/progress`)
        .then(r => r.json())
        .then(data => {
          if (!isAll && phase) {
            const st = data[phase as Phase];
            if (st && st.detail_total) {
              setEntityStatus(prev => ({
                ...prev,
                [phase as Phase]: {
                  phase: phase as Phase,
                  status: 'cancelled',
                  message: `cancelled at ${st.detail_item_index || st.detail_synced || 0}/${st.detail_total}`,
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
    if (data.type === 'pause' || data.type === 'rate_limit' || data.status === 'paused' || data.status === 'rate_limited') {
      const mins = data.pause_minutes || Math.max(1, Math.round((data.pause_seconds || 60) / 60));
      const resumeStr = data.resume_at ? new Date(data.resume_at).toLocaleTimeString() : '?';
      setEntityStatus(prev => ({
        ...prev,
        [phase]: {
          phase,
          status: data.status === 'rate_limited' ? 'rate_limited' : 'paused',
          pause_attempt: data.pause_attempt,
          pause_minutes: mins,
          resume_at: data.resume_at,
          message: data.message || `Paused ${mins}min — resume ${resumeStr}`,
        } as PhaseProgress,
      }));
      return;
    }
    if (data.type === 'resume' || data.status === 'resuming') {
      setEntityStatus(prev => ({
        ...prev,
        [phase]: { phase, status: 'started', message: data.message || `Resuming after attempt #${data.pause_attempt || ''}` },
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
      const next = Object.fromEntries(ENTITY_PHASES.map(p => [p, null])) as Record<Phase, PhaseProgress | null>;
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
      } else if (data.subphase) {
        message = `${data.subphase} ${data.current}/${data.total}`;
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

    // Pause / rate-limit / resume events from fetchWithRetry backoff
    if (data.type === 'pause' || data.type === 'rate_limit' || data.status === 'paused' || data.status === 'rate_limited') {
      const phase = (data.phase as Phase) || 'tickets';
      const mins = data.pause_minutes || Math.max(1, Math.round((data.pause_seconds || 60) / 60));
      const resumeStr = data.resume_at ? new Date(data.resume_at).toLocaleTimeString() : '?';
      setSyncAllProgress(prev => {
        const next = {
          ...prev,
          [phase]: {
            phase,
            status: (data.status === 'rate_limited' ? 'rate_limited' : 'paused') as PhaseProgress['status'],
            pause_attempt: data.pause_attempt,
            pause_minutes: mins,
            resume_at: data.resume_at,
            message: data.message || `Paused ${mins}min — resume ${resumeStr}`,
          },
        };
        saveSyncProgress(next);
        return next;
      });
      return;
    }
    if (data.type === 'resume' || data.status === 'resuming') {
      const phase = (data.phase as Phase) || 'tickets';
      setSyncAllProgress(prev => {
        const existing = prev[phase];
        const next = {
          ...prev,
          [phase]: {
            phase,
            status: 'started' as const,
            message: data.message || `Resuming after attempt #${data.pause_attempt || ''}`,
            pause_attempt: existing?.pause_attempt,
            resume_at: existing?.resume_at,
          },
        };
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
    xhr.send(JSON.stringify({
      entity: phase,
      ...(phase === 'appointments' && dateFrom ? { date_from: dateFrom } : {}),
      ...(phase === 'appointments' && dateTo ? { date_to: dateTo } : {}),
    }));
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
    setSyncAllProgress(Object.fromEntries(ENTITY_PHASES.map(p => [p, null])) as Record<Phase, PhaseProgress | null>);

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
    xhr.send(JSON.stringify({
      entity: 'all',
      ...(dateFrom ? { date_from: dateFrom } : {}),
      ...(dateTo ? { date_to: dateTo } : {}),
    }));
  }

  function phaseIcon(p: PhaseProgress | null) {
    if (!p) return '○';
    if (p.status === 'done') return '✓';
    if (p.status === 'error') return '✗';
    if (p.status === 'cancelled') return '⊘';
    if (p.status === 'conflict') return '⚠';
    if (p.status === 'paused' || p.status === 'rate_limited') return '⏸';
    if (p.status === 'resuming' || p.status === 'building_catalog') return '◐';
    return '◐';
  }

  function phaseColor(p: PhaseProgress | null) {
    if (!p) return 'text-gray-400';
    if (p.status === 'done') return 'text-green-600';
    if (p.status === 'error') return 'text-red-600';
    if (p.status === 'cancelled') return 'text-orange-600';
    if (p.status === 'conflict') return 'text-red-600 font-bold';
    if (p.status === 'paused' || p.status === 'rate_limited') return 'text-yellow-600';
    if (p.status === 'resuming' || p.status === 'building_catalog') return 'text-blue-600';
    return 'text-blue-600';
  }

  if (loading) return <p className="text-gray-500">Loading...</p>;

  const s = status?.syncro;

  const activeSyncList = Object.entries(activeSyncs);
  const anySyncing = activeSyncList.length > 0;

  return (
    <div>
      <Link href="/tickets" className="text-blue-600 hover:underline text-sm">← Back to Tickets</Link>

      <div className="mt-4 max-w-xl">
        <h1 className="text-xl font-bold mb-6">Settings</h1>

        {/* Syncro status — credentials live in Config page now */}
        <CollapsibleSection
          title="Syncro"
          containerClassName="bg-white rounded border p-4 mb-4"
          bodyClassName="mt-3"
          headerClassName="w-full flex justify-between items-center text-left -mt-1"
          defaultOpen={!s?.configured}
        >
          {s?.configured ? (
            <div className="text-sm space-y-1">
              <p className="text-green-600">✓ Configured</p>
              <p>Last Sync: {s.lastSync ? new Date(s.lastSync).toLocaleString() : 'Never'}</p>
              <p className="pt-1">
                <Link href="/settings/config" className="text-blue-600 hover:underline">
                  Edit credentials in Config →
                </Link>
              </p>
            </div>
          ) : (
            <p className="text-red-600 text-sm">
              Not configured —{' '}
              <Link href="/settings/config" className="text-blue-600 hover:underline">
                set Syncro API credentials in Config →
              </Link>
            </p>
          )}
        </CollapsibleSection>

        {/* Scheduler */}
        {s?.configured && (
          <SchedulerSection visiblePhases={visiblePhases} />
        )}

        {/* Sync Data */}
        {s?.configured && (
          <CollapsibleSection
            title="Sync Data"
            containerClassName="bg-white rounded border p-4 border-t-0"
            bodyClassName="mt-3"
            headerClassName="w-full flex justify-between items-center text-left -mt-1 mb-3"
            defaultOpen
          >
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
              {visiblePhases.map(phase => {
                const syncing = !!activeSyncs[`entity:${phase}`];
                const progress = entityStatus[phase] || syncAllProgress[phase];
                const isRunning = syncing;

                return (
                  <div key={phase} className="flex flex-wrap items-center gap-2">
                    <span className={`text-sm w-4 text-center ${phaseColor(progress)}`}>
                      {phaseIcon(progress)}
                    </span>
                    <span className="text-sm text-gray-700 w-40">
                      {PHASE_LABELS[phase]}
                      {lastResults[phase].total_to_sync > 0 && (
                        <span className="text-gray-400 font-mono ml-1">({lastResults[phase].total_to_sync.toLocaleString()})</span>
                      )}
                    </span>
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
                    {phase === 'appointments' && (
                      <div className="relative ml-auto" ref={showDatePanel ? datePanelRef : undefined}>
                        <button
                          type="button"
                          onClick={() => setShowDatePanel(o => !o)}
                          className={`px-2 py-1 rounded text-xs border ${dateFrom || dateTo
                            ? 'bg-blue-50 border-blue-300 text-blue-700'
                            : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                          }`}
                          title="Filter by appointment date range"
                        >
                          📅 {(dateFrom || dateTo)
                            ? `${dateFrom || '…'} → ${dateTo || '…'}`
                            : 'Date range'}
                        </button>
                        {showDatePanel && (
                          <div className="absolute z-20 top-full right-0 mt-1 bg-white border rounded shadow-lg p-3 flex flex-col gap-2 text-xs" style={{ minWidth: 220 }}>
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-gray-700">Appointment date range</span>
                              <button
                                type="button"
                                onClick={() => setShowDatePanel(false)}
                                className="text-gray-400 hover:text-gray-600"
                                title="Close"
                              >×</button>
                            </div>
                            <label className="flex items-center gap-2">
                              <span className="text-gray-500 w-8">From</span>
                              <input
                                type="date"
                                value={dateFrom}
                                onChange={e => setDateFrom(e.target.value)}
                                className="px-1.5 py-1 border rounded font-mono text-xs flex-1"
                              />
                            </label>
                            <label className="flex items-center gap-2">
                              <span className="text-gray-500 w-8">To</span>
                              <input
                                type="date"
                                value={dateTo}
                                onChange={e => setDateTo(e.target.value)}
                                className="px-1.5 py-1 border rounded font-mono text-xs flex-1"
                              />
                            </label>
                            <div className="flex justify-between gap-2 mt-1">
                              <button
                                type="button"
                                onClick={() => { setDateFrom(''); setDateTo(''); }}
                                disabled={!dateFrom && !dateTo}
                                className="text-gray-500 hover:text-gray-700 underline disabled:opacity-30 disabled:no-underline"
                              >
                                Reset to default
                              </button>
                              <button
                                type="button"
                                onClick={() => setShowDatePanel(false)}
                                className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
                              >
                                Done
                              </button>
                            </div>
                            <p className="text-gray-400 text-[10px] leading-tight">
                              Empty = 10y back / 2y forward (full history).
                              Applies to appointments sync only.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
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
                    {(progress?.status === 'paused' || progress?.status === 'rate_limited') && (
                      <span className="text-xs text-yellow-600 font-medium" title={progress.resume_at ? `Resume: ${new Date(progress.resume_at).toLocaleString()}` : ''}>
                        ⏸ {progress.message}
                      </span>
                    )}
                    {/* Right-aligned group: [DB count] [last-sync count] */}
                    <div className="ml-auto flex items-center gap-2">
                      {/* DB count — total records of this type currently in DB (left of last-sync) */}
                      {lastResults[phase].db_count > 0 && (
                        <span className="text-xs text-gray-500 font-mono" title="Records in DB">
                          DB:{lastResults[phase].db_count.toLocaleString()}
                        </span>
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

              {/* Serial → PO link job */}
              <div className="border-t pt-4 mt-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={handleLinkPos}
                    disabled={linkingPos || !webSessionConfigured || anySyncing}
                    className="bg-gray-100 border text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-200 disabled:opacity-50"
                    title={!webSessionConfigured ? 'Configure the Syncro Web Session cookie first (Config → Syncro Web Session)' : ''}
                  >
                    {linkingPos ? 'Linking…' : 'Link Serials to POs'}
                  </button>
                  {linkingPos && (
                    <button
                      onClick={cancelLinkPos}
                      className="text-red-500 hover:text-red-700 text-sm font-medium"
                    >
                      Cancel
                    </button>
                  )}
                  <label className="flex items-center gap-1.5 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={linkPosForceAll}
                      onChange={e => setLinkPosForceAll(e.target.checked)}
                      disabled={linkingPos}
                    />
                    Re-link all (overwrite existing)
                  </label>
                </div>
                <p className="text-xs text-gray-500 mt-1.5">
                  Resolves the PO each serial was received on via the Syncro web session and saves it permanently to the DB. Only serials not yet linked are processed (unless &ldquo;Re-link all&rdquo;).{' '}
                  {!webSessionConfigured && (
                    <a href="/settings/config" className="text-blue-600 hover:underline">Configure the cookie first →</a>
                  )}
                </p>

                {linkingPos && linkPosStats && (() => {
                  const pct = linkPosStats.total && linkPosStats.total > 0
                    ? Math.min(100, Math.round(((linkPosStats.current || 0) / linkPosStats.total) * 100))
                    : 0;
                  const fmtEta = (ms: number | null | undefined) => {
                    if (ms == null || ms <= 0) return '—';
                    const s = Math.round(ms / 1000);
                    if (s < 60) return `${s}s`;
                    const m = Math.floor(s / 60);
                    const rs = s % 60;
                    if (m < 60) return `${m}m ${rs}s`;
                    const h = Math.floor(m / 60);
                    const rm = m % 60;
                    return `${h}h ${rm}m`;
                  };
                  return (
                    <div className="mt-2 space-y-1.5">
                      {/* Progress bar */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                          <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-mono text-gray-700 shrink-0">{pct}%</span>
                      </div>
                      {/* Stats line */}
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-600 font-mono">
                        <span><span className="text-gray-400">Processed:</span> {linkPosStats.current || 0} / {linkPosStats.total || 0}</span>
                        <span className="text-green-700"><span className="text-gray-400">Linked:</span> {linkPosStats.linked ?? 0}</span>
                        <span className="text-gray-500"><span className="text-gray-400">No PO:</span> {linkPosStats.noPo ?? 0}</span>
                        {linkPosStats.errors ? <span className="text-red-600"><span className="text-gray-400">Errors:</span> {linkPosStats.errors}</span> : null}
                        <span><span className="text-gray-400">ETA:</span> {fmtEta(linkPosStats.etaMs)}</span>
                      </div>
                      {linkPosProgress && (
                        <p className="text-xs text-gray-500 font-mono truncate">{linkPosProgress}</p>
                      )}
                    </div>
                  );
                })()}

                {linkingPos && !linkPosStats && linkPosProgress && (
                  <p className="text-xs text-gray-700 mt-2 font-mono">{linkPosProgress}</p>
                )}

                {linkPosResult && (
                  <div className={`mt-2 border rounded p-2.5 text-sm ${
                    linkPosResult.ok ? 'bg-green-50 border-green-300 text-green-900'
                                   : 'bg-red-50 border-red-300 text-red-900'
                  }`}>
                    <span className="font-medium">{linkPosResult.ok ? 'Done' : 'Failed'}</span>
                    {linkPosResult.message ? ` — ${linkPosResult.message}` : ''}
                    {linkPosResult.error ? ` — ${linkPosResult.error}` : ''}
                  </div>
                )}
              </div>

              {/* Syncro PO Attachments sync job */}
              <div className="border-t pt-4 mt-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={handleSyncPoAtts}
                    disabled={syncingPoAtts || !webSessionConfigured || anySyncing}
                    className="bg-gray-100 border text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-200 disabled:opacity-50"
                    title={!webSessionConfigured ? 'Configure the Syncro Web Session cookie first (Config → Syncro Web Session)' : ''}
                  >
                    {syncingPoAtts ? 'Syncing…' : 'Sync PO Attachments (Syncro)'}
                  </button>
                  {syncingPoAtts && (
                    <button
                      onClick={cancelSyncPoAtts}
                      className="text-red-500 hover:text-red-700 text-sm font-medium"
                    >
                      Cancel
                    </button>
                  )}
                  <label className="flex items-center gap-1.5 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={poAttForceAll}
                      onChange={e => setPoAttForceAll(e.target.checked)}
                      disabled={syncingPoAtts}
                    />
                    Re-sync all (overwrite existing)
                  </label>
                </div>
                <p className="text-xs text-gray-500 mt-1.5">
                  Downloads attachments from Syncro&rsquo;s web PO pages (via the session cookie) to local disk. Only POs not yet synced are processed (unless &ldquo;Re-sync all&rdquo;).{' '}
                  {!webSessionConfigured && (
                    <a href="/settings/config" className="text-blue-600 hover:underline">Configure the cookie first →</a>
                  )}
                </p>

                {syncingPoAtts && poAttStats && (() => {
                  const pct = poAttStats.total && poAttStats.total > 0
                    ? Math.min(100, Math.round(((poAttStats.current || 0) / poAttStats.total) * 100))
                    : 0;
                  const fmtEta = (ms: number | null | undefined) => {
                    if (ms == null || ms <= 0) return '—';
                    const s = Math.round(ms / 1000);
                    if (s < 60) return `${s}s`;
                    const m = Math.floor(s / 60);
                    const rs = s % 60;
                    if (m < 60) return `${m}m ${rs}s`;
                    const h = Math.floor(m / 60);
                    const rm = m % 60;
                    return `${h}h ${rm}m`;
                  };
                  return (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                          <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-mono text-gray-700 shrink-0">{pct}%</span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-600 font-mono">
                        <span><span className="text-gray-400">POs:</span> {poAttStats.current || 0} / {poAttStats.total || 0}</span>
                        <span className="text-green-700"><span className="text-gray-400">Downloaded:</span> {poAttStats.linked ?? 0}</span>
                        <span className="text-gray-500"><span className="text-gray-400">Skipped:</span> {poAttStats.noPo ?? 0}</span>
                        {poAttStats.errors ? <span className="text-red-600"><span className="text-gray-400">Errors:</span> {poAttStats.errors}</span> : null}
                        <span><span className="text-gray-400">ETA:</span> {fmtEta(poAttStats.etaMs)}</span>
                      </div>
                      {poAttProgress && (
                        <p className="text-xs text-gray-500 font-mono truncate">{poAttProgress}</p>
                      )}
                    </div>
                  );
                })()}

                {syncingPoAtts && !poAttStats && poAttProgress && (
                  <p className="text-xs text-gray-700 mt-2 font-mono">{poAttProgress}</p>
                )}

                {poAttResult && (
                  <div className={`mt-2 border rounded p-2.5 text-sm ${
                    poAttResult.ok ? 'bg-green-50 border-green-300 text-green-900'
                                 : 'bg-red-50 border-red-300 text-red-900'
                  }`}>
                    <span className="font-medium">{poAttResult.ok ? 'Done' : 'Failed'}</span>
                    {poAttResult.message ? ` — ${poAttResult.message}` : ''}
                    {poAttResult.error ? ` — ${poAttResult.error}` : ''}
                  </div>
                )}
              </div>

              {/* QuickBooks Online PO attachments */}
              <div className="border-t pt-4 mt-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={handleQboSync}
                    disabled={qboSyncing || !qboConnected}
                    className="bg-gray-100 border text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-200 disabled:opacity-50"
                    title={!qboConnected ? 'Connect QuickBooks Online first (Config → QuickBooks Online)' : ''}
                  >
                    {qboSyncing ? 'Syncing…' : 'Sync PO Attachments (QBO)'}
                  </button>
                  {qboSyncing && (
                    <button
                      onClick={cancelQboSync}
                      className="text-red-500 hover:text-red-700 text-sm font-medium"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1.5">
                  Pulls file attachments from matching QuickBooks Online purchase orders (matched by PO number).
                  {!qboConnected && (
                    <> <a href="/settings/config" className="text-blue-600 hover:underline">Connect QuickBooks Online first →</a></>
                  )}
                </p>

                {qboSyncing && qboSyncStats && (qboSyncStats.total != null) && (() => {
                  const pct = qboSyncStats.total && qboSyncStats.total > 0
                    ? Math.min(100, Math.round(((qboSyncStats.current || 0) / qboSyncStats.total) * 100))
                    : 0;
                  return (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                          <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-mono text-gray-700 shrink-0">{pct}%</span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-600 font-mono">
                        <span><span className="text-gray-400">PO:</span> {qboSyncStats.current || 0} / {qboSyncStats.total || 0}{qboSyncStats.currentRecordName ? ` — ${qboSyncStats.currentRecordName}` : ''}</span>
                      </div>
                    </div>
                  );
                })()}

                {qboSyncing && !qboSyncStats && (
                  <p className="text-xs text-gray-700 mt-2 font-mono">Starting…</p>
                )}

                {qboSyncResult && (
                  <div className={`mt-2 border rounded p-2.5 text-sm ${
                    qboSyncResult.ok ? 'bg-green-50 border-green-300 text-green-900'
                                   : 'bg-red-50 border-red-300 text-red-900'
                  }`}>
                    <span className="font-medium">{qboSyncResult.ok ? 'Done' : 'Failed'}</span>
                    {qboSyncResult.message ? ` — ${qboSyncResult.message}` : ''}
                    {qboSyncResult.error ? ` — ${qboSyncResult.error}` : ''}
                  </div>
                )}
              </div>
            </div>
          </CollapsibleSection>
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
