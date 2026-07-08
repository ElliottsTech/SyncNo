'use client';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react'
import { IS_DEMO } from '../../../app/lib/demo';
import { useRouter } from 'next/navigation';
import CollapsibleSection from '../../../components/CollapsibleSection';
import { usePageTitle } from '../../../lib/usePageTitle';

const API = '/api';
const MASK = '••••••••';

type EnvConfig = {
  resticRepository: string;
  resticPassword: string;
  resticPasswordFile: string;
  rcloneConfig: string;
  keepDaily: string;
  stageDir: string;
  rcloneTransfers: string;
  rcloneTpslimit: string;
};

type RcloneConfig = {
  clientId: string;
  clientSecret: string;
  tenantId: string;
};

type Status = {
  timerEnabled: boolean;
  timerActive: boolean;
  nextRun: string | null;
};

type CmdResult = { ok: boolean; output?: string; error?: string; message?: string };

const EMPTY_ENV: EnvConfig = {
  resticRepository: 'rclone:sharepoint:/SyncNo-Backups/syncno',
  resticPassword: '',
  resticPasswordFile: '/root/.restic-password',
  rcloneConfig: '/root/.config/rclone/rclone.conf',
  keepDaily: '14',
  stageDir: '/mnt/backup-stage',
  rcloneTransfers: '',
  rcloneTpslimit: '',
};

const EMPTY_RCLONE: RcloneConfig = { clientId: '', clientSecret: '', tenantId: '' };

export default function BackupSettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  usePageTitle('Backup Settings — SyncNo');

  const [env, setEnv] = useState<EnvConfig>(EMPTY_ENV);
  const [rclone, setRclone] = useState<RcloneConfig>(EMPTY_RCLONE);
  const [envExists, setEnvExists] = useState(false);
  const [rcloneExists, setRcloneExists] = useState(false);
  const [passwordFileExists, setPasswordFileExists] = useState(false);
  const [statusInfo, setStatusInfo] = useState<Status | null>(null);
  const [saving, setSaving] = useState(false);
  const [cmdRunning, setCmdRunning] = useState<string | null>(null);
  const [cmdResult, setCmdResult] = useState<CmdResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!IS_DEMO && status === 'authenticated' && session?.user?.role !== 'admin') {
      router.replace('/');
      return;
    }
    if (!IS_DEMO && status !== 'authenticated') return;
    refresh();
    refreshStatus();
  }, [status, session, router]);

  const refresh = async () => {
    try {
      const r = await fetch(`${API}/backup-settings`);
      if (!r.ok) throw new Error('Failed to load');
      const d = await r.json();
      if (d.env) setEnv({ ...EMPTY_ENV, ...d.env });
      if (d.rclone) setRclone({ ...EMPTY_RCLONE, ...d.rclone });
      setEnvExists(!!d.envExists);
      setRcloneExists(!!d.rcloneExists);
      setPasswordFileExists(!!d.passwordFileExists);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const refreshStatus = async () => {
    try {
      const r = await fetch(`${API}/backup-settings/status`);
      if (r.ok) setStatusInfo(await r.json());
    } catch { /* ignore */ }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setCmdResult(null);
    try {
      const envToSend: any = { ...env };
      if (env.resticPassword === MASK) delete envToSend.resticPassword;
      const rcloneToSend: any = { ...rclone };
      if (rclone.clientSecret === MASK) delete rcloneToSend.clientSecret;
      const r = await fetch(`${API}/backup-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ env: envToSend, rclone: rcloneToSend }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `Save failed (HTTP ${r.status})`);
      }
      await refresh();
      setCmdResult({ ok: true, message: 'Saved.' });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const runCmd = async (path: string, label: string) => {
    setCmdRunning(label);
    setCmdResult(null);
    setError(null);
    try {
      const r = await fetch(`${API}/backup-settings/${path}`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      setCmdResult(d);
      if (path === 'enable-timer' || path === 'run') refreshStatus();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCmdRunning(null);
    }
  };

  if (!IS_DEMO && status !== 'authenticated') {
    return <div className="p-8 text-gray-500">Loading...</div>;
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Backup Settings</h1>
      <p className="text-sm text-gray-600 mb-4">
        DR backup to SharePoint via rclone + restic. See{' '}
        <code>docs/BACKUP.md</code> for setup prerequisites.
      </p>

      {statusInfo && (
        <div className="bg-white border rounded p-3 text-sm mb-4 flex flex-wrap gap-6">
          <div>
            <span className="text-gray-500">Timer: </span>
            <span className={statusInfo.timerEnabled ? 'text-green-600' : 'text-gray-500'}>
              {statusInfo.timerEnabled ? 'enabled' : 'disabled'}
            </span>
            {' / '}
            <span className={statusInfo.timerActive ? 'text-green-600' : 'text-gray-500'}>
              {statusInfo.timerActive ? 'active' : 'inactive'}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Next run: </span>
            <span className="text-gray-900">{statusInfo.nextRun || '—'}</span>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-300 text-red-800 rounded p-3 text-sm mb-4">
          {error}
        </div>
      )}

      <CollapsibleSection
        title="SharePoint (rclone)"
        containerClassName="bg-white rounded border p-4 mb-4"
        bodyClassName="mt-3 space-y-3"
        headerClassName="w-full flex justify-between items-center text-left -mt-1"
        defaultOpen={!rcloneExists}
      >
        <Field
          label="Client ID"
          value={rclone.clientId}
          onChange={v => setRclone({ ...rclone, clientId: v })}
          placeholder="Azure app registration client_id"
        />
        <Field
          label="Client Secret"
          type="password"
          value={rclone.clientSecret}
          onChange={v => setRclone({ ...rclone, clientSecret: v })}
          placeholder="Azure app secret"
        />
        <Field
          label="Tenant ID"
          value={rclone.tenantId}
          onChange={v => setRclone({ ...rclone, tenantId: v })}
          placeholder="Azure tenant_id (GUID)"
        />
        <p className="text-xs text-gray-500">
          App registration needs Microsoft Graph &gt; Application &gt; Sites.Selected (preferred) or
          Sites.ReadWrite.All, with admin consent granted.
        </p>
      </CollapsibleSection>

      <CollapsibleSection
        title="Restic repository"
        containerClassName="bg-white rounded border p-4 mb-4"
        bodyClassName="mt-3 space-y-3"
        headerClassName="w-full flex justify-between items-center text-left -mt-1"
        defaultOpen={!envExists}
      >
        <Field
          label="Repository"
          value={env.resticRepository}
          onChange={v => setEnv({ ...env, resticRepository: v })}
          placeholder="rclone:sharepoint:/SyncNo-Backups/syncno"
        />
        <Field
          label="Repository password"
          type="password"
          value={env.resticPassword}
          onChange={v => setEnv({ ...env, resticPassword: v })}
          placeholder="Used to encrypt backups — store separately"
        />
        <Field
          label="Keep daily snapshots"
          value={env.keepDaily}
          onChange={v => setEnv({ ...env, keepDaily: v })}
          placeholder="14"
        />
        <p className="text-xs text-gray-500">
          Password also written to <code>{env.resticPasswordFile}</code> for direct CLI use.
          {!passwordFileExists && envExists && (
            <span className="text-yellow-700"> (password file not yet present)</span>
          )}
        </p>
      </CollapsibleSection>

      <CollapsibleSection
        title="Advanced (optional)"
        containerClassName="bg-white rounded border p-4 mb-4"
        bodyClassName="mt-3 space-y-3"
        headerClassName="w-full flex justify-between items-center text-left -mt-1"
        defaultOpen={false}
      >
        <Field
          label="Stage dir"
          value={env.stageDir}
          onChange={v => setEnv({ ...env, stageDir: v })}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Rclone transfers"
            value={env.rcloneTransfers}
            onChange={v => setEnv({ ...env, rcloneTransfers: v })}
            placeholder="(default)"
          />
          <Field
            label="Rclone tpslimit"
            value={env.rcloneTpslimit}
            onChange={v => setEnv({ ...env, rcloneTpslimit: v })}
            placeholder="(default)"
          />
        </div>
      </CollapsibleSection>

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={save}
          disabled={saving}
          className="bg-black text-white px-4 py-2 rounded text-sm hover:bg-gray-800 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={() => runCmd('test', 'test')}
          disabled={!!cmdRunning}
          className="bg-white border px-4 py-2 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {cmdRunning === 'test' ? 'Testing…' : 'Test rclone connection'}
        </button>
        <button
          onClick={() => runCmd('init', 'init')}
          disabled={!!cmdRunning}
          className="bg-white border px-4 py-2 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {cmdRunning === 'init' ? 'Initializing…' : 'Init restic repo'}
        </button>
        <button
          onClick={() => runCmd('enable-timer', 'enable-timer')}
          disabled={!!cmdRunning}
          className="bg-white border px-4 py-2 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          Enable timer
        </button>
        <button
          onClick={() => runCmd('run', 'run')}
          disabled={!!cmdRunning}
          className="bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-500 disabled:opacity-50"
        >
          {cmdRunning === 'run' ? 'Starting…' : 'Run backup now'}
        </button>
      </div>

      <CollapsibleSection
        title="One-time downloads"
        containerClassName="bg-white rounded border p-4 mb-4"
        bodyClassName="mt-3 space-y-3"
        headerClassName="w-full flex justify-between items-center text-left -mt-1"
        defaultOpen={false}
      >
        <p className="text-sm text-gray-600">
          Stream a tar.gz straight to your browser instead of pushing to SharePoint. Stages in
          tmpfs (3G), then deletes after. DB is ~2.9GB so the full backup takes a minute to
          prepare before the download starts — keep the tab open.
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href={`${API}/backup-settings/download`}
            className="bg-black text-white px-4 py-2 rounded text-sm hover:bg-gray-800 inline-block"
          >
            Download full backup (.tar.gz)
          </a>
          <a
            href={`${API}/backup-settings/download-json`}
            className="bg-white border px-4 py-2 rounded text-sm hover:bg-gray-50 inline-block"
          >
            Download JSON export (.tar.gz)
          </a>
        </div>
        <p className="text-xs text-gray-500">
          Full backup contains: SQLite snapshot, attachments, env files. JSON export contains one
          .json per entity endpoint (~19 files, no attachments, no env).
        </p>
      </CollapsibleSection>

      {cmdResult && (
        <div className={`border rounded p-3 text-sm font-mono whitespace-pre-wrap mb-4 ${
          cmdResult.ok ? 'bg-green-50 border-green-300 text-green-900'
                       : 'bg-red-50 border-red-300 text-red-900'
        }`}>
          <div className="font-sans font-medium mb-1">
            {cmdResult.ok ? 'OK' : 'Failed'}
            {cmdResult.message ? ` — ${cmdResult.message}` : ''}
            {cmdResult.error ? ` — ${cmdResult.error}` : ''}
          </div>
          {cmdResult.output && <pre className="text-xs overflow-x-auto">{cmdResult.output}</pre>}
        </div>
      )}

      <div className="text-xs text-gray-500 pt-4 border-t">
        Files written:
        <ul className="list-disc ml-5 mt-1 space-y-0.5">
          <li><code>/root/SyncNo/.backup.env</code> {envExists ? '✓' : '(not yet)'}</li>
          <li><code>/root/.config/rclone/rclone.conf</code> {rcloneExists ? '✓' : '(not yet)'}</li>
          <li><code>{env.resticPasswordFile}</code> {passwordFileExists ? '✓' : '(not yet)'}</li>
        </ul>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, type = 'text', placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
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
    </label>
  );
}
