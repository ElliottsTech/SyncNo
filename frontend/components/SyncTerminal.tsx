'use client';
import { useState, useEffect, useRef } from 'react';

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
  method: string;
  url: string;
  status: number;
  phase: string;
  duration_ms: number;
  body_preview: string;
  color: string;
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
  };
  const c = colors[phase] || 'bg-gray-700 text-gray-200';
  return `{phase:${phase}}`;
}

interface SyncTerminalProps {
  onClose: () => void;
  xhr: XMLHttpRequest | null;
  bufferRef: React.MutableRefObject<string>;
}

export default function SyncTerminal({ onClose, xhr, bufferRef }: SyncTerminalProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);
  const seenUrls = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!xhr) return;

    const handleProgress = () => {
      if (isPaused) return;
      const bufferedLen = bufferRef.current.length;
      const newData = xhr.responseText.slice(bufferedLen);
      bufferRef.current = xhr.responseText;

      const chunks = newData.split('\n');
      for (const chunk of chunks) {
        if (!chunk.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(chunk.slice(6)) as HttpLogEntry;
          if (data.type !== 'http_log') continue;
          // Deduplicate by URL — prevents double-rendering same event from dual XHR
          const urlKey = `${data.method}:${data.url}:${data.status}:${data.duration_ms}`;
          if (seenUrls.current.has(urlKey)) continue;
          seenUrls.current.add(urlKey);
          idRef.current++;
          setLines(prev => {
            const ts = new Date().toISOString().split('T')[1].slice(0, 12);
            const color = statusColor(data.status);
            const newLine: LogLine = {
              id: idRef.current,
              ts,
              method: data.method,
              url: data.url,
              status: data.status,
              phase: data.phase,
              duration_ms: data.duration_ms,
              body_preview: data.body_preview,
              color,
            };
            const next = [...prev, newLine];
            // Keep max 2000 lines to avoid memory bloat
            if (next.length > 2000) return next.slice(-1500);
            return next;
          });
        } catch (_) {}
      }
    };

    xhr.addEventListener('progress', handleProgress);
    return () => xhr.removeEventListener('progress', handleProgress);
  }, [xhr, isPaused, bufferRef]);

  useEffect(() => {
    if (!isPaused) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [lines, isPaused]);

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
            <span className="text-gray-500 text-xs">{lines.length} requests</span>
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
          {lines.length === 0 && (
            <div className="text-gray-500">Waiting for HTTP requests...</div>
          )}
          {lines.map(line => (
            <div key={line.id} className="flex flex-col gap-0.5 mb-2 group">
              {/* Line header: timestamp method status phase duration */}
              <div className="flex items-center gap-3">
                <span className="text-gray-600 text-xs shrink-0">{line.ts}</span>
                <span className={`text-xs font-bold shrink-0 ${line.method === 'GET' ? 'text-cyan-400' : 'text-yellow-400'}`}>
                  {line.method}
                </span>
                <span className={`text-xs font-bold shrink-0 ${line.color}`}>
                  {line.status}
                </span>
                <span className={`text-xs shrink-0 ${phaseColor(line.phase)}`}>
                  [{line.phase}]
                </span>
                <span className="text-gray-600 text-xs shrink-0">
                  {line.duration_ms}ms
                </span>
                <span className="text-gray-400 text-xs truncate">
                  {truncateUrl(line.url)}
                </span>
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
