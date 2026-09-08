'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSession } from 'next-auth/react'
import { IS_DEMO } from '../../../app/lib/demo';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
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

type WebSessionStatus = {
  configured: boolean;
  subdomain: string | null;
  cookieMasked: string | null;
  cookieExists: boolean;
};

type QboStatus = {
  appConfigured: boolean;
  configured: boolean;
  connected: boolean;
  environment: string;
  clientId: string | null;
  clientIdMasked: string | null;
  clientSecretExists: boolean;
  realmId: string | null;
  refreshTokenExists: boolean;
  refreshTokenMasked: string | null;
  redirectUri: string | null;
};

type TestResult = { ok: boolean; message?: string; error?: string; output?: string };

export default function ConfigPage() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-500">Loading...</div>}>
      <ConfigPageInner />
    </Suspense>
  );
}

function ConfigPageInner() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  usePageTitle('Config — SyncNo');

  const [statusData, setStatusData] = useState<Status | null>(null);
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [syncroForm, setSyncroForm] = useState({ apiKey: '', subdomain: '' });
  const [entraForm, setEntraForm] = useState({ clientId: '', clientSecret: '', tenantId: '' });
  const [webSessionCookie, setWebSessionCookie] = useState('');
  const [webSessionStatus, setWebSessionStatus] = useState<WebSessionStatus | null>(null);
  const [qboStatus, setQboStatus] = useState<QboStatus | null>(null);
  const [qboForm, setQboForm] = useState({ clientId: '', clientSecret: '', environment: 'sandbox', realmId: '', refreshToken: '' });
  const [qboTestResult, setQboTestResult] = useState<TestResult | null>(null);
  const [testingQbo, setTestingQbo] = useState(false);
  const [testingLogin, setTestingLogin] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
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
    refreshWebSession();
    refreshQbo();
    // OAuth Connect callback lands here with ?qbo_ok=1 or ?qbo_error=...
    const ok = searchParams.get('qbo_ok');
    const err = searchParams.get('qbo_error');
    if (ok) {
      setNotice('Connected to QuickBooks Online successfully.');
      router.replace('/settings/config');
    } else if (err) {
      setError(`QuickBooks Connect failed: ${err}`);
      router.replace('/settings/config');
    }
  }, [status, session, router, searchParams]);

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

  const refreshWebSession = async () => {
    try {
      const r = await fetch(`${API}/sync/web-session`);
      if (!r.ok) return;
      const d = await r.json();
      setWebSessionStatus(d);
      // The cookie itself is never returned — clear the textarea so the masked
      // preview is shown and the admin doesn't see a stale pasted value.
      setWebSessionCookie('');
    } catch (_) {}
  };

  const saveWebSession = async () => {
    setSaving('web-session');
    setError(null); setNotice(null);
    try {
      const r = await fetch(`${API}/sync/web-session/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie: webSessionCookie }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      setNotice('Syncro web-session cookie saved.');
      setWebSessionCookie('');
      refreshWebSession();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  };

  const testLogin = async () => {
    setTestingLogin(true);
    setTestResult(null);
    setError(null);
    try {
      const r = await fetch(`${API}/sync/web-session/test`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      setTestResult(d);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTestingLogin(false);
    }
  };

  const refreshQbo = async () => {
    try {
      const r = await fetch(`${API}/qbo-settings`);
      if (!r.ok) return;
      const d = await r.json();
      setQboStatus(d);
      setQboForm(f => ({
        ...f,
        clientId: d.clientId || '',
        clientSecret: '',
        environment: d.environment || 'sandbox',
        realmId: d.realmId || f.realmId || '',
        refreshToken: '',
      }));
    } catch (_) {}
  };

  const saveQbo = async () => {
    setSaving('qbo');
    setError(null); setNotice(null);
    try {
      const r = await fetch(`${API}/qbo-settings/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(qboForm),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      setNotice('QuickBooks Online app credentials saved. Click Connect to authorize.');
      setQboForm(f => ({ ...f, clientSecret: '' }));
      refreshQbo();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  };

  const connectQbo = () => {
    // /connect redirects the browser to Intuit's consent screen. It's a GET the
    // proxy forwards; using window.location so the redirect happens top-level
    // (Intuit needs a full browser navigation, not a fetch).
    window.location.href = `${API}/qbo-settings/connect`;
  };

  const disconnectQbo = async () => {
    setSaving('qbo-disconnect');
    setError(null); setNotice(null);
    try {
      const r = await fetch(`${API}/qbo-settings/disconnect`, { method: 'POST' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      setNotice('Disconnected from QuickBooks Online. App credentials retained.');
      refreshQbo();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  };

  const testQbo = async () => {
    setTestingQbo(true);
    setQboTestResult(null);
    setError(null);
    try {
      const r = await fetch(`${API}/qbo-settings/test`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      setQboTestResult(d);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTestingQbo(false);
    }
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

      {/* Syncro Web Session (for serial → PO lookup) */}
      <CollapsibleSection
        title="Syncro Web Session"
        containerClassName="bg-white rounded border p-4 mb-4"
        bodyClassName="mt-3 space-y-3"
        headerClassName="w-full flex justify-between items-center text-left -mt-1"
        defaultOpen={!webSessionStatus?.configured}
      >
        <p className="text-xs text-gray-600">
          Used only to look up the <strong>Purchase Order</strong> a serial was received on — the
          public API can&rsquo;t do this. Syncro&rsquo;s web app is behind Cloudflare, which blocks
          server-side login, so instead you export a session cookie from your own browser and paste
          it here. The backend uses that cookie to read the internal serial-history page; the PO
          then appears on the serial detail page.
        </p>
        <details className="text-xs text-gray-600">
          <summary className="cursor-pointer text-gray-700">How to get the cookie</summary>
          <ol className="list-decimal ml-5 mt-1 space-y-0.5">
            <li>Log in to <code>{webSessionStatus?.subdomain ? `${webSessionStatus.subdomain}.syncromsp.com` : 'yoursubdomain.syncromsp.com'}</code> in your browser.</li>
            <li>Open DevTools → Application (or Storage) → Cookies → the syncromsp.com site.</li>
            <li>Copy the <code>Cookie</code> request header value, or copy all cookie pairs. The session cookie (often <code>_session_id</code> or similar) plus <code>cf_clearance</code> are what matter.</li>
            <li>Paste it below and Save, then click Test.</li>
          </ol>
          <p className="mt-1">The cookie expires (hours-to-days). When it does, the serial page will say &ldquo;session expired&rdquo; — just re-export and re-paste.</p>
        </details>
        {webSessionStatus?.configured ? (
          <p className="text-green-600 text-sm">
            ✓ Cookie stored{webSessionStatus.cookieMasked ? ` — ${webSessionStatus.cookieMasked}` : ''}
          </p>
        ) : (
          <p className="text-red-600 text-sm">Not configured</p>
        )}
        {testResult && (
          <div className={`border rounded p-3 text-sm font-mono whitespace-pre-wrap ${
            testResult.ok ? 'bg-green-50 border-green-300 text-green-900'
                         : 'bg-red-50 border-red-300 text-red-900'
          }`}>
            <div className="font-sans font-medium mb-1">
              {testResult.ok ? 'OK' : 'Failed'}
              {testResult.message ? ` — ${testResult.message}` : ''}
              {testResult.error ? ` — ${testResult.error}` : ''}
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 pt-2 border-t">
          <label className="block">
            <span className="text-xs text-gray-600">Session Cookie</span>
            <textarea
              value={webSessionCookie}
              onChange={e => setWebSessionCookie(e.target.value)}
              placeholder="Paste the Cookie header value from your logged-in Syncro browser session (e.g. _session_id=...; cf_clearance=...)"
              rows={3}
              className="mt-1 block w-full bg-white border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none"
            />
            <span className="text-xs text-gray-500 mt-1 block">
              Leave blank and Save to clear the stored cookie. The cookie is stored masked and never sent back to the UI.
            </span>
          </label>
          <div className="flex gap-2">
            <button
              onClick={saveWebSession}
              disabled={saving === 'web-session'}
              className="bg-black text-white px-4 py-2 rounded text-sm hover:bg-gray-800 disabled:opacity-50"
            >
              {saving === 'web-session' ? 'Saving…' : 'Save cookie'}
            </button>
            <button
              onClick={testLogin}
              disabled={testingLogin || !webSessionStatus?.configured}
              className="border border-gray-400 px-4 py-2 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              {testingLogin ? 'Testing…' : 'Test cookie'}
            </button>
          </div>
        </div>
      </CollapsibleSection>

      {/* QuickBooks Online (PO attachment sync) */}
      <CollapsibleSection
        title="QuickBooks Online"
        containerClassName="bg-white rounded border p-4 mb-4"
        bodyClassName="mt-3 space-y-3"
        headerClassName="w-full flex justify-between items-center text-left -mt-1"
        defaultOpen={!qboStatus?.configured}
      >
        <p className="text-xs text-gray-600">
          Pulls <strong>file attachments</strong> from QuickBooks Online purchase orders into SyncNo.
          Each SyncNo PO (synced from SyncroMSP) is matched to its QBO counterpart by PO number, then
          QBO&rsquo;s <code>Attachable</code> records are downloaded and served on the PO detail page.
        </p>
        <details className="text-xs text-gray-600">
          <summary className="cursor-pointer text-gray-700">How to set up</summary>
          <ol className="list-decimal ml-5 mt-1 space-y-0.5">
            <li>Create an Intuit app at <code>developer.intuit.com</code> with the <code>com.intuit.quickbooks.accounting</code> scope.</li>
            <li>Add the redirect URI shown below to the app&rsquo;s allowed redirect URLs.</li>
            <li>Paste the app&rsquo;s Client ID + Secret below and Save.</li>
            <li>Click <strong>Connect to QuickBooks</strong> — you&rsquo;ll be sent to Intuit to pick a company and authorize. After consent you&rsquo;re returned here, connected. The backend self-refreshes tokens after — you only Connect once.</li>
          </ol>
        </details>
        {qboStatus?.redirectUri && (
          <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded p-2">
            <span className="font-medium">Redirect URI to register on your Intuit app:</span>
            <code className="block mt-1 break-all text-gray-800">{qboStatus.redirectUri}</code>
          </div>
        )}
        {qboStatus?.connected ? (
          <p className="text-green-600 text-sm">
            ✓ Connected — {qboStatus.environment}{qboStatus.realmId ? ` · realm ${qboStatus.realmId}` : ''}
            {qboStatus.refreshTokenMasked ? ` · token ${qboStatus.refreshTokenMasked}` : ''}
          </p>
        ) : qboStatus?.appConfigured ? (
          <p className="text-amber-600 text-sm">App credentials saved — click Connect to authorize a company.</p>
        ) : (
          <p className="text-red-600 text-sm">Not configured</p>
        )}
        {qboTestResult && (
          <div className={`border rounded p-3 text-sm font-mono whitespace-pre-wrap ${
            qboTestResult.ok ? 'bg-green-50 border-green-300 text-green-900'
                             : 'bg-red-50 border-red-300 text-red-900'
          }`}>
            <div className="font-sans font-medium mb-1">
              {qboTestResult.ok ? 'OK' : 'Failed'}
              {qboTestResult.message ? ` — ${qboTestResult.message}` : ''}
              {qboTestResult.error ? ` — ${qboTestResult.error}` : ''}
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 pt-2 border-t">
          <Field
            label="Client ID"
            value={qboForm.clientId}
            onChange={v => setQboForm({ ...qboForm, clientId: v })}
            placeholder="Intuit app client_id"
            hint={qboStatus?.clientIdMasked ? `Current: <code>${qboStatus.clientIdMasked}</code>` : undefined}
          />
          <Field
            label="Client Secret"
            type="password"
            value={qboForm.clientSecret}
            onChange={v => setQboForm({ ...qboForm, clientSecret: v })}
            placeholder="Leave blank to keep existing"
            hint={qboStatus?.clientSecretExists ? 'Current client secret is stored' : undefined}
          />
          <label className="block">
            <span className="text-xs text-gray-600">Environment</span>
            <select
              value={qboForm.environment}
              onChange={e => setQboForm({ ...qboForm, environment: e.target.value })}
              className="mt-1 block w-full bg-white border border-gray-300 rounded px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="sandbox">Sandbox</option>
              <option value="production">Production</option>
            </select>
          </label>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={saveQbo}
              disabled={saving === 'qbo'}
              className="bg-black text-white px-4 py-2 rounded text-sm hover:bg-gray-800 disabled:opacity-50"
            >
              {saving === 'qbo' ? 'Saving…' : 'Save app credentials'}
            </button>
            {qboStatus?.connected ? (
              <button
                onClick={disconnectQbo}
                disabled={saving === 'qbo-disconnect'}
                className="border border-red-400 text-red-700 px-4 py-2 rounded text-sm hover:bg-red-50 disabled:opacity-50"
              >
                {saving === 'qbo-disconnect' ? 'Disconnecting…' : 'Disconnect'}
              </button>
            ) : (
              <button
                onClick={connectQbo}
                disabled={!qboStatus?.appConfigured}
                className="border border-gray-400 px-4 py-2 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
                title={qboStatus?.appConfigured ? 'Authorize SyncNo to access your QuickBooks company' : 'Save app credentials first'}
              >
                Connect to QuickBooks
              </button>
            )}
            <button
              onClick={testQbo}
              disabled={testingQbo || !qboStatus?.connected}
              className="border border-gray-400 px-4 py-2 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              {testingQbo ? 'Testing…' : 'Test connection'}
            </button>
          </div>
          {qboStatus?.connected && (
            <p className="text-xs text-gray-500">
              Pull attachments from <Link href="/syncro" className="text-blue-600 hover:underline">Sync → Sync PO Attachments (QBO)</Link>.
            </p>
          )}
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
