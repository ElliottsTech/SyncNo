'use client';
import { useState, useEffect, useRef, useMemo } from 'react';

export type HttpLogEntry = {
  type: 'http_log';
  direction: 'response';
  method: string;
  url: string;
  status: number;
  phase: string;
  duration_ms: number;
  body_preview: string;
};

type LogLine = {
  id: number;
  ts: string;
  method?: string;
  url?: string;
  status?: number;
  phase?: string;
  duration_ms?: number;
  body_preview?: string;
  color: string;
  // Non-http_log fields
  type?: string;
  current?: number;
  total?: number;
  message?: string;
  error?: string;
  count?: number;
  currentTicketNumber?: string;
  currentRecordId?: string;
  currentRecordName?: string;
};

function statusColor(status: number): string {
  if (status >= 500) return 'text-red-400';
  if (status >= 400) return 'text-orange-400';
  if (status >= 300) return 'text-yellow-400';
  if (status >= 200) return 'text-green-400';
  return 'text-gray-400';
}

function truncateUrl(url: string, maxLen = 80): string {
  const base = url.replace('https://', '').replace('http://', '');
  if (base.length <= maxLen) return base;
  return '...' + base.slice(-(maxLen - 3));
}

function phaseTag(phase: string): string {
  const colors: Record<string, string> = {
    customers: 'bg-blue-800 text-blue-200',
    contacts: 'bg-purple-800 text-purple-200',
    tickets: 'bg-green-800 text-green-200',
    invoices: 'bg-yellow-800 text-yellow-200',
    assets: 'bg-orange-800 text-orange-200',
    estimates: 'bg-pink-800 text-pink-200',
    purchase_orders: 'bg-cyan-800 text-cyan-200',
    vendors: 'bg-gray-700 text-gray-200',
    products: 'bg-teal-800 text-teal-200',
  };
  const c = colors[phase] || 'bg-gray-700 text-gray-200';
  return `{phase:${phase}}`;
}

interface SyncTerminalProps {
  onClose: () => void;
  xhr?: XMLHttpRequest | null;
  bufferRef?: React.MutableRefObject<string>;
  storedEvents?: string[];
  apiUrl?: string;
}

export default function SyncTerminal({ onClose, storedEvents = [], apiUrl = '/api' }: SyncTerminalProps) {
  const API = apiUrl;
  const [lines, setLines] = useState<LogLine[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [showHttpLog, setShowHttpLog] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [checkpointOverride, setCheckpointOverride] = useState<{phase: string; current: number; total: number} | null>(null);

  // Compute display lines with checkpoint override applied to the last matching progress line
  const displayLines = useMemo(() => {
    const filtered = showHttpLog
      ? lines
      : lines.filter(l => l.phase !== 'http_log' && l.method === undefined);
    if (!checkpointOverride) return filtered;
    let lastIdx = -1;
    for (let i = filtered.length - 1; i >= 0; i--) {
      if (filtered[i].phase === checkpointOverride.phase && filtered[i].current != null) {
        lastIdx = i;
        break;
      }
    }
    if (lastIdx < 0) return filtered;
    return filtered.map((l, i) => i === lastIdx
      ? { ...l, current: checkpointOverride.current, total: checkpointOverride.total }
      : l
    );
  }, [lines, checkpointOverride, showHttpLog]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);
  const seenLineIds = useRef<Set<number>>(new Set());
  const seenUrls = useRef<Set<string>>(new Set());
  const lastEventIdRef = useRef<number>(0);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Keep addEventLine ref current so interval always calls latest version
  const addEventLineRef = useRef<(data: any) => void>(() => {});
  const pollCountRef = useRef(0);

  function debug(msg: string) {
    setDebugInfo(prev => [...prev.slice(-4), `${new Date().toISOString().slice(11, 19)} ${msg}`]);
  }

  // Restore lines from storedEvents on mount (handles both old SSE string format and new DB object format)
  // Also fetch fresh checkpoint from backend to get accurate resume position
  useEffect(() => {
    debug(`restore: storedEvents.length=${storedEvents.length}`);
    if (storedEvents.length > 0) {
      let processed = 0;
      for (const event of storedEvents) {
        try {
          let data: any;
          if (typeof event === 'string') {
            // Old SSE format: "data: {...}"
            const jsonStr = event.replace(/^data: /, '');
            data = JSON.parse(jsonStr);
          } else {
            data = Array.isArray(event) ? event[0] : event;
          }
          if (!data || !data.id) { debug(`restore: skip no-id event`); continue; }
          if (data.id <= lastEventIdRef.current) { debug(`restore: skip id=${data.id} <= lastId=${lastEventIdRef.current}`); continue; }
          lastEventIdRef.current = data.id;
          addEventLine(data);
          processed++;
        } catch (e: any) { debug(`restore: err ${e.message}`); }
      }
      debug(`restore: processed ${processed}, lastId=${lastEventIdRef.current}`);
    }
    // Fetch fresh checkpoint from backend to get accurate resume position
    fetch(`${API}/sync/progress`)
      .then(r => r.ok ? r.json() : null)
      .then(progressData => {
        if (!progressData) return;
        // Find the entity phase from stored events or default to 'customers'
        let entityPhase = 'customers';
        for (const event of storedEvents) {
          try {
            const data = typeof event === 'string' ? JSON.parse(event.replace(/^data: /, '')) : (Array.isArray(event) ? event[0] : event);
            if (data?.phase && data.phase !== 'done' && data.phase !== 'error' && data.phase !== 'http_log') {
              entityPhase = data.phase;
              break;
            }
          } catch (_) {}
        }
        const state = progressData[entityPhase];
        // Tickets uses detail_synced as its checkpoint (detail_item_index never set);
        // other entities use detail_item_index. Take whichever is non-zero.
        const checkpoint = state && (state.detail_item_index || state.detail_synced || 0);
        if (state && state.phase === 'detail' && checkpoint > 0) {
          debug(`backend checkpoint: ${entityPhase} current=${checkpoint}, total=${state.detail_total}`);
          setCheckpointOverride({ phase: entityPhase, current: checkpoint, total: state.detail_total || 0 });
        }
      })
      .catch(e => debug(`progress fetch err: ${e.message}`));
  }, []);

  // Poll GET /sync/events for live updates
  useEffect(() => {
    if (isPaused) {
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
      return;
    }

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/sync/events`);
        if (!res.ok) { debug(`poll HTTP ${res.status}`); return; }
        const contentType = res.headers.get('content-type');
        if (!contentType?.includes('json')) { debug(`poll content-type: ${contentType}`); return; }
        let events;
        try { events = await res.json(); }
        catch(e: any) { debug(`poll json err: ${e.message}`); return; }
        if (!Array.isArray(events)) { debug(`poll events not array: ${typeof events}`); return; }
        pollCountRef.current++;
        setPollCount(pollCountRef.current);
        let added = 0;
        for (const data of events) {
          if (data.id <= lastEventIdRef.current) continue;
          lastEventIdRef.current = data.id;
          addEventLineRef.current(data);
          added++;
        }
        if (added > 0) debug(`poll #${pollCountRef.current}: +${added} events, hiId=${lastEventIdRef.current}`);
      } catch (e: any) { debug(`poll err: ${e.message}`); }
    }, 1000);

    return () => {
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
    };
  }, [isPaused]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (!isPaused) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [lines, isPaused]);

  const addEventLine = (data: any) => {
    idRef.current++;
    const lineId = idRef.current;
    if (seenLineIds.current.has(lineId)) return;
    seenLineIds.current.add(lineId);
    const tsRaw = data.created_at ? data.created_at.split('T')[1] : null;
    const ts = tsRaw ? tsRaw.slice(0, 12) : new Date().toISOString().split('T')[1].slice(0, 12);

    if (data.type === 'http_log') {
      const urlKey = `${data.method}:${data.url}:${data.status}:${data.duration_ms}`;
      if (seenUrls.current.has(urlKey)) return;
      seenUrls.current.add(urlKey);
      setLines(prev => {
        const next = [...prev, {
          id: lineId,
          ts,
          method: data.method,
          url: data.url,
          status: data.status,
          phase: data.phase,
          duration_ms: data.duration_ms,
          body_preview: data.body_preview,
          color: statusColor(data.status),
        }];
        return next.length > 2000 ? next.slice(-1500) : next;
      });
    } else {
      const phase = data.phase || '';
      const phaseColor: Record<string, string> = {
        customers: 'text-blue-400',
        contacts: 'text-purple-400',
        tickets: 'text-green-400',
        invoices: 'text-yellow-400',
        assets: 'text-orange-400',
        estimates: 'text-pink-400',
        purchase_orders: 'text-cyan-400',
        vendors: 'text-gray-400',
        products: 'text-teal-400',
      };
      setLines(prev => {
        const next = [...prev, {
          id: lineId,
          ts,
          phase,
          color: phaseColor[phase] || 'text-gray-400',
          type: data.status || data.type,
          current: data.current,
          total: data.total,
          message: data.message,
          error: data.error,
          count: data.count,
          currentTicketNumber: data.currentTicketNumber,
          currentRecordId: data.currentRecordId,
          currentRecordName: data.currentRecordName,
        }];
        return next.length > 2000 ? next.slice(-1500) : next;
      });
    }
  };
  // Keep ref current so interval always calls latest addEventLine
  addEventLineRef.current = addEventLine;

  const phaseColor = (phase: string) => {
    const colors: Record<string, string> = {
      customers: 'text-blue-400',
      contacts: 'text-purple-400',
      tickets: 'text-green-400',
      invoices: 'text-yellow-400',
      assets: 'text-orange-400',
      estimates: 'text-pink-400',
      purchase_orders: 'text-cyan-400',
      vendors: 'text-gray-400',
      products: 'text-teal-400',
    };
    return colors[phase] || 'text-gray-400';
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-[#0d1117] rounded-lg border border-[#30363d] w-full max-w-5xl h-[80vh] flex flex-col shadow-2xl">
        {/* Terminal title bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363d] bg-[#161b22] rounded-t-lg">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div className="w-3 h-3 rounded-full bg-green-500" />
            </div>
            <span className="text-gray-400 text-sm ml-2 font-mono">sync-terminal — live HTTP stream</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-gray-500 text-xs" title="Poll count (resets on mount)">{lines.length} lines · poll #{pollCount}</span>
            <button
              onClick={() => setShowHttpLog(v => !v)}
              className={`text-xs px-2 py-1 rounded border ${showHttpLog ? 'border-cyan-700 text-cyan-300 bg-cyan-950' : 'border-[#30363d] text-gray-400 hover:text-white hover:border-gray-500'}`}
              title="Toggle HTTP request log lines"
            >
              {showHttpLog ? 'HTTP ✓' : 'HTTP'}
            </button>
            <button
              onClick={() => setIsPaused(p => !p)}
              className="text-xs px-2 py-1 rounded border border-[#30363d] text-gray-400 hover:text-white hover:border-gray-500"
            >
              {isPaused ? 'Resume' : 'Pause'}
            </button>
            <button
              onClick={() => setLines([])}
              className="text-xs px-2 py-1 rounded border border-[#30363d] text-gray-400 hover:text-white hover:border-gray-500"
            >
              Clear
            </button>
            <button
              onClick={onClose}
              className="text-xs px-2 py-1 rounded bg-red-900 text-red-300 hover:bg-red-800"
            >
              Close
            </button>
          </div>
        </div>

        {/* Terminal body */}
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto p-4 font-mono text-sm"
        >
          {debugInfo.length > 0 && (
            <div className="text-yellow-500 text-xs mb-2 border border-yellow-900 rounded p-1">
              {debugInfo.map((d, i) => <div key={i}>{d}</div>)}
            </div>
          )}
          {lines.length === 0 && storedEvents.length === 0 && (
            <div className="text-gray-500">Waiting for HTTP requests...</div>
          )}
          {lines.length === 0 && storedEvents.length > 0 && (
            <div className="text-gray-500">Restoring events...</div>
          )}
          {checkpointOverride && (
            <div className="text-yellow-400 text-xs mb-2 border border-yellow-900 rounded p-1">
              ⚠ Backend checkpoint: {checkpointOverride.phase} @ {checkpointOverride.current}/{checkpointOverride.total}
            </div>
          )}
          {displayLines.map(line => (
            <div key={line.id} className="flex flex-col gap-0.5 mb-2 group">
              {/* Line header: timestamp method status phase duration */}
              <div className="flex items-center gap-3">
                <span className="text-gray-600 text-xs shrink-0">{line.ts}</span>
                {line.method ? (
                  <>
                    <span className={`text-xs font-bold shrink-0 ${line.method === 'GET' ? 'text-cyan-400' : 'text-yellow-400'}`}>
                      {line.method}
                    </span>
                    <span className={`text-xs font-bold shrink-0 ${line.color}`}>
                      {line.status}
                    </span>
                  </>
                ) : (
                  <>
                    <span className={`text-xs font-bold shrink-0 ${line.color}`}>
                      {line.type || line.phase}
                    </span>
                  </>
                )}
                <span className={`text-xs shrink-0 ${phaseColor(line.phase || '')}`}>
                  [{line.phase || '—'}]
                </span>
                {line.method ? (
                  <span className="text-gray-600 text-xs shrink-0">
                    {line.duration_ms}ms
                  </span>
                ) : (
                  <span className="text-gray-400 text-xs shrink-0 truncate">
                    {line.currentTicketNumber ? (
                      <span>
                        <span className="text-orange-400">#{line.currentTicketNumber}</span>
                        {line.message ? ` ${line.message}` : ''}
                      </span>
                    ) : line.currentRecordName ? (
                      <span>
                        <span className="text-orange-400">{line.currentRecordName}</span>
                        {line.currentRecordId ? <span className="text-gray-600"> ({line.currentRecordId})</span> : null}
                        {line.current != null && line.total != null ? ` ${line.current}/${line.total}` : line.current != null ? ` ${line.current}` : ''}
                      </span>
                    ) : (
                      line.message || (line.current != null && line.total != null ? `${line.current}/${line.total}` : line.current != null ? `${line.current}` : line.count != null ? `count: ${line.count}` : line.error || '')
                    )}
                  </span>
                )}
                {line.url && (
                  <span className="text-gray-400 text-xs truncate">
                    {truncateUrl(line.url)}
                  </span>
                )}
              </div>
              {/* Body preview */}
              {line.body_preview && (
                <div className="text-gray-600 text-xs ml-24 truncate max-w-xl">
                  {line.body_preview.replace(/\n/g, ' ').slice(0, 200)}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
