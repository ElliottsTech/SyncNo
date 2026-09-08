'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

const API = '/api';

type Step = {
  id: string;
  label: string;
  done: boolean;
  hint?: string;
  link?: string;
};

export default function Home() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    fetch(`${API}/pdf-settings/checklist`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setSteps(d.steps);
          setEnabled(d.enabled);
        }
      })
      .catch(() => { /* ignore — checklist is optional */ });
  }, [isAdmin]);

  const dismiss = async () => {
    setDismissing(true);
    try {
      await fetch(`${API}/pdf-settings/checklist/dismiss`, { method: 'POST' });
      setEnabled(false);
    } finally {
      setDismissing(false);
    }
  };

  const showChecklist = isAdmin && enabled && steps && steps.length > 0;
  const completedCount = steps?.filter(s => s.done).length ?? 0;
  const totalCount = steps?.length ?? 0;
  const allDone = totalCount > 0 && completedCount === totalCount;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Syncno</h1>
      <p className="text-gray-600 mb-6">Syncro MSP Data Viewer</p>

      {showChecklist && (
        <div className="mb-8 bg-white rounded-lg border max-w-2xl">
          <div className="p-5 border-b flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Getting started</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {allDone
                  ? 'All set — everything below is configured.'
                  : `${completedCount} of ${totalCount} complete`}
              </p>
            </div>
            {allDone && (
              <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800">Complete</span>
            )}
          </div>
          <ul>
            {steps!.map((step, i) => (
              <li key={step.id} className={`flex items-start gap-3 px-5 py-3 ${i < steps!.length - 1 ? 'border-b' : ''}`}>
                <span className={`mt-0.5 flex-none w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                  step.done
                    ? 'bg-green-500 text-white'
                    : 'border-2 border-gray-300 text-transparent'
                }`}>
                  {step.done ? '✓' : '·'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm ${step.done ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                    {step.label}
                  </div>
                  {step.hint && !step.done && (
                    <p className="text-xs text-gray-500 mt-1">{step.hint}</p>
                  )}
                </div>
                {!step.done && step.link && (
                  <Link href={step.link} className="text-xs text-blue-600 hover:underline whitespace-nowrap">
                    Open →
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <div className="px-5 py-3 border-t bg-gray-50 rounded-b-lg flex justify-end">
            <button
              onClick={dismiss}
              disabled={dismissing}
              className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50"
            >
              {dismissing ? 'Dismissing…' : 'Dismiss'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 max-w-2xl">
        <Link href="/customers" className="p-4 bg-white rounded-lg border hover:border-blue-500">
          <h2 className="font-semibold">Customers</h2>
          <p className="text-sm text-gray-500">View all customers</p>
        </Link>
        <Link href="/tickets" className="p-4 bg-white rounded-lg border hover:border-blue-500">
          <h2 className="font-semibold">Tickets</h2>
          <p className="text-sm text-gray-500">View all tickets</p>
        </Link>
        <Link href="/invoices" className="p-4 bg-white rounded-lg border hover:border-blue-500">
          <h2 className="font-semibold">Invoices</h2>
          <p className="text-sm text-gray-500">View all invoices</p>
        </Link>
        <Link href="/vendors" className="p-4 bg-white rounded-lg border hover:border-blue-500">
          <h2 className="font-semibold">Vendors</h2>
          <p className="text-sm text-gray-500">View vendors & POs</p>
        </Link>
        <Link href="/estimates" className="p-4 bg-white rounded-lg border hover:border-blue-500">
          <h2 className="font-semibold">Estimates</h2>
          <p className="text-sm text-gray-500">View all estimates</p>
        </Link>
        <Link href="/search" className="p-4 bg-white rounded-lg border hover:border-blue-500">
          <h2 className="font-semibold">Search</h2>
          <p className="text-sm text-gray-500">Search everything</p>
        </Link>
      </div>
    </div>
  );
}