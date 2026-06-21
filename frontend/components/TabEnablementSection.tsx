'use client';
import { useState, useEffect } from 'react';
import CollapsibleSection from './CollapsibleSection';

const API = '/api';

type Phase = 'customers' | 'contacts' | 'tickets' | 'invoices' | 'assets' | 'estimates' | 'purchase_orders' | 'vendors' | 'products' | 'payments' | 'product_serials' | 'appointments' | 'contracts' | 'leads' | 'policy_folders' | 'portal_users' | 'schedules' | 'syncro_users' | 'wiki_pages' | 'worksheet_results';

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

export default function TabEnablementSection() {
  const [enabled, setEnabled] = useState<Set<Phase>>(new Set());
  const [available, setAvailable] = useState<Phase[]>(ENTITY_PHASES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/sync/enabled`)
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.entities)) setEnabled(new Set(d.entities as Phase[]));
        if (Array.isArray(d.available)) setAvailable(d.available as Phase[]);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  async function toggle(phase: Phase, on: boolean) {
    const next = new Set(enabled);
    if (on) next.add(phase); else next.delete(phase);
    setEnabled(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/sync/enabled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entities: Array.from(next) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'save failed');
      setSavedAt(Date.now());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function setAll(on: boolean) {
    const next = on ? new Set(available) : new Set<Phase>();
    setEnabled(next);
    setSaving(true);
    fetch(`${API}/sync/enabled`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entities: Array.from(next) }),
    })
      .then(r => r.json())
      .then(() => { setSaving(false); setSavedAt(Date.now()); })
      .catch(e => { setError(e.message); setSaving(false); });
  }

  return (
    <CollapsibleSection
      title="Tab Enablement"
      containerClassName="bg-white rounded border p-4 mb-4"
      bodyClassName="mt-3"
      headerClassName="w-full flex justify-between items-center text-left -mt-1"
      defaultOpen={false}
    >
      <p className="text-xs text-gray-500 mb-3">
        Unchecked entities hide from the sidebar, sync UI, and scheduler. Use to disable parts you don&apos;t use.
      </p>
      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            {available.map(phase => (
              <label key={phase} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-2 py-1 rounded">
                <input
                  type="checkbox"
                  checked={enabled.has(phase)}
                  onChange={e => toggle(phase, e.target.checked)}
                  className="w-4 h-4 cursor-pointer"
                />
                <span>{PHASE_LABELS[phase]}</span>
                <span className="text-xs text-gray-400 font-mono">{phase}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={() => setAll(true)}
              className="px-3 py-1.5 rounded text-xs border border-gray-300 hover:bg-gray-50"
            >Enable All</button>
            <button
              onClick={() => setAll(false)}
              className="px-3 py-1.5 rounded text-xs border border-gray-300 hover:bg-gray-50"
            >Disable All</button>
            {saving && <span className="text-xs text-gray-500">Saving...</span>}
            {savedAt && !error && !saving && <span className="text-xs text-green-600">Saved</span>}
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
        </>
      )}
    </CollapsibleSection>
  );
}
