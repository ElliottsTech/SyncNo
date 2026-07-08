'use client';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react'
import { IS_DEMO } from '../../../app/lib/demo';
import { useRouter } from 'next/navigation';
import CollapsibleSection from '../../../components/CollapsibleSection';
import TabEnablementSection from '../../../components/TabEnablementSection';
import { usePageTitle } from '../../../lib/usePageTitle';

const API = '/api';

type SyncroStatus = { configured: boolean; lastSync: string | null };
type EntraStatus = { configured: boolean };
type UrlStatus = { nextAuth: string | null; api: string | null };
type Status = {
  syncro: SyncroStatus;
  entra: EntraStatus;
  urls: UrlStatus;
};

type Credentials = {
  syncro: {
    apiKey: string | null;
    subdomain: string | null;
    apiKeyMasked: string | null;
  };
  entra: {
    clientId: string | null;
    clientSecret: string | null;
    tenantId: string | null;
    clientSecretMasked: string | null;
  };
};

export default function ConfigPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  usePageTitle('Config — SyncNo');

  const [statusData, setStatusData] = useState<Status | null>(null);
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [syncroForm, setSyncroForm] = useState({ apiKey: '', subdomain: '' });
  const [entraForm, setEntraForm] = useState({ clientId: '', clientSecret: '', tenantId: '' });
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!IS_DEMO && status === 'authenticated' && session?.user?.role !== 'admin') {
      router.replace('/');
      return;
    }
    if (!IS_DEMO && status !== 'authenticated') return;
    refresh();
    refreshCreds();
  }, [status, session, router]);

  const refresh = async () => {
    try {
      const r = await fetch(`${API}/sync/status`);
      if (!r.ok) throw new Error('Failed to load status');
      const d = await r.json();
      setStatusData(d);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const refreshCreds = async () => {
    try {
      const r = await fetch(`${API}/sync/credentials`);
      if (!r.ok) return;
      const d = await r.json();
      setCreds(d);
      setSyncroForm({
        apiKey: d.syncro.apiKey || '',
        subdomain: d.syncro.subdomain || '',
      });
      setEntraForm({
        clientId: d.entra.clientId || '',
        clientSecret: d.entra.clientSecret || '',
        tenantId: d.entra.tenantId || '',
      });
    } catch (_) {}
  };

  const saveSyncro = async () => {
    setSaving('syncro');
    setError(null); setNotice(null);
    try {
      if (!syncroForm.apiKey || !syncroForm.subdomain) {
        throw new Error('API Key + Subdomain required');
      }
      const r = await fetch(`${API}/sync/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: syncroForm.apiKey, subdomain: syncroForm.subdomain }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      setNotice('Syncro credentials saved.');
      refresh();
      refreshCreds();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  };

  const saveEntra = async () => {
    setSaving('entra');
    setError(null); setNotice(null);
    try {
      if (!entraForm.clientId || !entraForm.tenantId) {
        throw new Error('Client ID + Tenant ID required');
      }
      const r = await fetch(`${API}/sync/save-azure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entraForm),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      setNotice('Entra ID credentials saved. Frontend restart required for Next.js to pick up new env values.');
      refresh();
      refreshCreds();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  };

  if (!IS_DEMO && status !== 'authenticated') {
    return <div className="p-8 text-gray-500">Loading...</div>;
  }

  const s = statusData?.syncro;
  const e = statusData?.entra;
  const u = statusData?.urls;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Configuration</h1>
      <p className="text-sm text-gray-600 mb-6">
        Fields are pre-populated from <code>.env</code>. Sensitive values (API key, client secret)
        are masked in the UI. Edit a field and save to write the new value back to{' '}
        <code>.env</code> (and <code>frontend/.env.local</code> for Entra).
      </p>

      {error && (
        <div className="bg-red-50 border border-red-300 text-red-800 rounded p-3 text-sm mb-4">
          {error}
        </div>
      )}
      {notice && (
        <div className="bg-green-50 border border-green-300 text-green-800 rounded p-3 text-sm mb-4">
          {notice}
        </div>
      )}

      {/* Tab Enablement */}
      <TabEnablementSection />

      {/* Syncro API */}
      <CollapsibleSection
        title="Syncro API"
        containerClassName="bg-white rounded border p-4 mb-4"
        bodyClassName="mt-3 space-y-3"
        headerClassName="w-full flex justify-between items-center text-left -mt-1"
        defaultOpen={!s?.configured}
      >
        {s?.configured ? (
          <div className="text-sm space-y-1">
            <p className="text-green-600">✓ Configured</p>
            <p>Last Sync: {s.lastSync ? new Date(s.lastSync).toLocaleString() : 'Never'}</p>
          </div>
        ) : (
          <p className="text-red-600 text-sm">Not configured</p>
        )}
        <div className="grid grid-cols-1 gap-3 pt-2 border-t">
          <Field
            label="Subdomain"
            value={syncroForm.subdomain}
            onChange={v => setSyncroForm({ ...syncroForm, subdomain: v })}
            placeholder="yourcompany"
            hint="https://&lt;subdomain&gt;.syncromsp.com"
          />
          <Field
            label="API Key"
            type="password"
            value={syncroForm.apiKey}
            onChange={v => setSyncroForm({ ...syncroForm, apiKey: v })}
            placeholder="Syncro API key"
            hint={creds?.syncro.apiKeyMasked ? `Current: <code>${creds.syncro.apiKeyMasked}</code>` : undefined}
          />
          <button
            onClick={saveSyncro}
            disabled={saving === 'syncro'}
            className="bg-black text-white px-4 py-2 rounded text-sm hover:bg-gray-800 disabled:opacity-50"
          >
            {saving === 'syncro' ? 'Saving…' : 'Save Syncro credentials'}
          </button>
        </div>
      </CollapsibleSection>

      {/* Entra ID */}
      <CollapsibleSection
        title="Entra ID (Azure AD)"
        containerClassName="bg-white rounded border p-4 mb-4"
        bodyClassName="mt-3 space-y-3"
        headerClassName="w-full flex justify-between items-center text-left -mt-1"
        defaultOpen={!e?.configured}
      >
        {e?.configured ? (
          <p className="text-green-600 text-sm">✓ Configured</p>
        ) : (
          <p className="text-red-600 text-sm">Not configured</p>
        )}
        <div className="grid grid-cols-1 gap-3 pt-2 border-t">
          <Field
            label="Client ID"
            value={entraForm.clientId}
            onChange={v => setEntraForm({ ...entraForm, clientId: v })}
            placeholder="Azure app registration client_id"
          />
          <Field
            label="Client Secret"
            type="password"
            value={entraForm.clientSecret}
            onChange={v => setEntraForm({ ...entraForm, clientSecret: v })}
            placeholder="Azure app registration client_secret"
            hint={creds?.entra.clientSecretMasked ? `Current: <code>${creds.entra.clientSecretMasked}</code>` : 'Leave blank to keep existing'}
          />
          <Field
            label="Tenant ID"
            value={entraForm.tenantId}
            onChange={v => setEntraForm({ ...entraForm, tenantId: v })}
            placeholder="Azure tenant_id (GUID)"
          />
          <button
            onClick={saveEntra}
            disabled={saving === 'entra'}
            className="bg-black text-white px-4 py-2 rounded text-sm hover:bg-gray-800 disabled:opacity-50"
          >
            {saving === 'entra' ? 'Saving…' : 'Save Entra credentials'}
          </button>
        </div>
      </CollapsibleSection>

      {/* URLs */}
      <CollapsibleSection
        title="URLs"
        containerClassName="bg-white rounded border p-4 mb-4"
        bodyClassName="mt-3"
        headerClassName="w-full flex justify-between items-center text-left -mt-1"
        defaultOpen={false}
      >
        <div className="text-sm space-y-1">
          <p>NEXTAUTH_URL: <span className="font-mono">{u?.nextAuth || '—'}</span></p>
          <p>API URL: <span className="font-mono">{u?.api || '—'}</span></p>
          <p className="text-xs text-gray-500 pt-2">
            Set via <code>NEXTAUTH_URL</code> in backend <code>.env</code>. Restart backend after change.
          </p>
        </div>
      </CollapsibleSection>
    </div>
  );
}

function Field({
  label, value, onChange, type = 'text', placeholder, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 block w-full bg-white border border-gray-300 rounded px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      />
      {hint && <span className="text-xs text-gray-500 mt-1 block" dangerouslySetInnerHTML={{ __html: hint }} />}
    </label>
  );
}
