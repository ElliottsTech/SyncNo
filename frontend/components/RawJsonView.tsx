'use client';
import { useState } from 'react';

interface RawJsonViewProps {
  rawJson: any;
  label?: string;
}

export default function RawJsonView({ rawJson, label = 'Raw JSON' }: RawJsonViewProps) {
  const [open, setOpen] = useState(false);
  if (!rawJson) return null;

  let parsed: any;
  if (typeof rawJson === 'string') {
    try { parsed = JSON.parse(rawJson); } catch { parsed = rawJson; }
  } else {
    parsed = rawJson;
  }

  return (
    <div className="mt-6 border rounded">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex justify-between items-center px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
      >
        <span className="font-medium">{label}</span>
        <span className="text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <pre className="px-4 pb-4 text-xs text-gray-700 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-all">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      )}
    </div>
  );
}
