'use client';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { usePageTitle } from '../../../lib/usePageTitle';

const API = '/api';

type TemplateEntry = {
  custom: boolean;
  html: string;
  message: string;
  disclaimer: string;
};

type Templates = Record<'invoice' | 'estimate' | 'purchase_order' | 'ticket', TemplateEntry>;

const TABS: { key: keyof Templates; label: string }[] = [
  { key: 'invoice',        label: 'Invoice' },
  { key: 'estimate',       label: 'Estimate' },
  { key: 'purchase_order', label: 'Purchase Order' },
  { key: 'ticket',         label: 'Ticket' },
];

export default function PdfTemplatesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  usePageTitle('PDF Templates — SyncNo');

  const [templates, setTemplates] = useState<Templates | null>(null);
  const [activeTab, setActiveTab] = useState<keyof Templates>('invoice');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.role !== 'admin') {
      router.replace('/');
      return;
    }
    if (status !== 'authenticated') return;
    refresh();
  }, [status, session, router]);

  const refresh = async () => {
    try {
      const r = await fetch(`${API}/pdf-settings`);
      if (!r.ok) throw new Error('Failed to load PDF templates');
      const d = await r.json();
      setTemplates(d.templates);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const save = async () => {
    if (!templates) return;
    const t = templates[activeTab];
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fetch(`${API}/pdf-settings/template/${activeTab}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: t.html, message: t.message, disclaimer: t.disclaimer }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      setNotice('Template saved.');
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!confirm('Revert this template to the default file? Your customizations will be lost.')) return;
    setResetting(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fetch(`${API}/pdf-settings/template/${activeTab}/reset`, { method: 'POST' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      const d = await r.json();
      // Update the local state with the reverted HTML
      setTemplates(prev => prev ? {
        ...prev,
        [activeTab]: { ...prev[activeTab], html: d.html, custom: false },
      } : prev);
      setNotice('Reverted to default template.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setResetting(false);
    }
  };

  const update = (patch: Partial<TemplateEntry>) => {
    setTemplates(prev => prev ? { ...prev, [activeTab]: { ...prev[activeTab], ...patch } } : prev);
  };

  if (status !== 'authenticated') {
    return <div className="p-8 text-gray-500">Loading…</div>;
  }

  const t = templates?.[activeTab];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">PDF Templates</h1>
      <p className="text-sm text-gray-600 mb-6">
        The HTML SyncNo uses to generate each type of PDF. Paste your own
        template verbatim — the same <code>{'{{tag}}'}</code> placeholders
        Syncro uses are substituted with real data at render time. Tags that
        have no value (or aren't relevant) are replaced with empty strings.
        Company-wide branding (logo, company details, tax label) is set on the{' '}
        <strong>Settings → Company</strong> page.
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

      {/* ─── Tabs ─────────────────────────────────────────────────────── */}
      <div className="border-b mb-4 flex gap-1">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setError(null); setNotice(null); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'border-black text-black'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {tab.label}
            {templates?.[tab.key].custom && (
              <span className="ml-2 inline-block w-2 h-2 rounded-full bg-blue-500 align-middle" title="Customized" />
            )}
          </button>
        ))}
      </div>

      {t && (
        <div className="space-y-4">
          {/* ─── HTML template ──────────────────────────────────────── */}
          <div className="bg-white rounded border p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold">HTML template</h2>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">
                  {t.custom ? 'Customized' : 'Using default file'}
                </span>
                {t.custom && (
                  <button
                    onClick={reset}
                    disabled={resetting}
                    className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                  >
                    {resetting ? 'Resetting…' : 'Reset to default'}
                  </button>
                )}
              </div>
            </div>
            <textarea
              value={t.html}
              onChange={e => update({ html: e.target.value })}
              spellCheck={false}
              rows={24}
              className="w-full border border-gray-300 rounded px-3 py-2 text-xs font-mono"
            />
            <p className="text-xs text-gray-500 mt-2">
              Tags: <code className="font-mono">{'{{invoice_number}}'}</code>,{' '}
              <code className="font-mono">{'{{invoice_date}}'}</code>,{' '}
              <code className="font-mono">{'{{customer_business_name_and_full_name}}'}</code>,{' '}
              <code className="font-mono">{'{{logo_url}}'}</code>, and many more —
              see <code>samples/tags.txt</code> in the repo for a full list per type.
            </p>
          </div>

          {/* ─── Message + disclaimer ────────────────────────────────── */}
          <div className="bg-white rounded border p-4 space-y-4">
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                Message (printed above the disclaimer; HTML allowed)
              </label>
              <textarea
                value={t.message}
                onChange={e => update({ message: e.target.value })}
                placeholder="e.g. Thank you for your business. Payment due within 7 days."
                rows={3}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                Disclaimer (HTML allowed — paste from your existing template)
              </label>
              <textarea
                value={t.disclaimer}
                onChange={e => update({ disclaimer: e.target.value })}
                placeholder="e.g.<br /><br />BSB: 086-082<br />ACC: 31-820-0862"
                rows={5}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={save}
              disabled={saving}
              className="bg-black text-white px-4 py-2 rounded text-sm hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save template'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}