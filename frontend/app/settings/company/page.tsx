'use client';
import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import CollapsibleSection from '../../../components/CollapsibleSection';
import { usePageTitle } from '../../../lib/usePageTitle';

const API = '/api';

type Company = {
  companyName: string;
  contactBlock: string;
  abnLabel: string;
  abn: string;
  taxLabel: string;
};

export default function CompanyPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  usePageTitle('Company — SyncNo');

  const [form, setForm] = useState<Company | null>(null);
  const [logoPresent, setLogoPresent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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
      if (!r.ok) throw new Error('Failed to load company settings');
      const d = await r.json();
      setForm(d.company);
      setLogoPresent(d.logoPresent);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fetch(`${API}/pdf-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      setNotice('Company settings saved.');
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const onLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const r = await fetch(`${API}/pdf-settings/logo`, { method: 'POST', body: fd });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      setNotice('Logo uploaded.');
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const removeLogo = async () => {
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fetch(`${API}/pdf-settings/logo`, { method: 'DELETE' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      setNotice('Logo removed.');
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  if (status !== 'authenticated') {
    return <div className="p-8 text-gray-500">Loading…</div>;
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Company</h1>
      <p className="text-sm text-gray-600 mb-6">
        Branding shown on every generated PDF — the logo, company details, and
        tax label. These appear on <strong>Invoice</strong>, <strong>Estimate</strong>,
        <strong> Purchase Order</strong>, and <strong>Ticket</strong> PDFs.
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

      {/* ─── Logo ─────────────────────────────────────────────────────── */}
      <CollapsibleSection
        title="Logo"
        containerClassName="bg-white rounded border p-4 mb-4"
        bodyClassName="mt-3 space-y-3"
        headerClassName="w-full flex justify-between items-center text-left -mt-1"
      >
        <p className="text-xs text-gray-500">
          Shown at the top of every PDF. PNG, JPEG, GIF, SVG, or WebP up to
          5&nbsp;MB. Recommended aspect ratio ~4:1.
        </p>
        <div className="flex items-center gap-4">
          <div className="w-48 h-16 border rounded flex items-center justify-center bg-gray-50 overflow-hidden">
            {logoPresent ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${API}/pdf-settings/logo?t=${Date.now()}`}
                alt="Company logo"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-xs text-gray-400">No logo</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp"
              onChange={onLogoChange}
              disabled={uploading}
              className="text-sm"
            />
            {logoPresent && (
              <button
                onClick={removeLogo}
                disabled={uploading}
                className="bg-white border border-red-300 text-red-700 px-3 py-1.5 rounded text-sm hover:bg-red-50 disabled:opacity-50"
              >
                Remove logo
              </button>
            )}
          </div>
        </div>
      </CollapsibleSection>

      {/* ─── Company details ──────────────────────────────────────────── */}
      <CollapsibleSection
        title="Company details"
        containerClassName="bg-white rounded border p-4 mb-4"
        bodyClassName="mt-3 space-y-4"
        headerClassName="w-full flex justify-between items-center text-left -mt-1"
      >
        <Field
          label="Company name"
          value={form?.companyName ?? ''}
          onChange={v => setForm(f => f ? { ...f, companyName: v } : f)}
          placeholder="e.g. Elliotts Tech"
        />
        <div>
          <label className="block text-xs text-gray-600 mb-1">
            Contact block (phone/email — printed under the logo)
          </label>
          <textarea
            value={form?.contactBlock ?? ''}
            onChange={e => setForm(f => f ? { ...f, contactBlock: e.target.value } : f)}
            placeholder={'e.g.\nPhone: 08 9756 7273\nE-mail: help@elliotts.tech'}
            rows={3}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Tax ID label"
            value={form?.abnLabel ?? ''}
            onChange={v => setForm(f => f ? { ...f, abnLabel: v } : f)}
            placeholder="ABN"
          />
          <Field
            label="Tax ID number"
            value={form?.abn ?? ''}
            onChange={v => setForm(f => f ? { ...f, abn: v } : f)}
            placeholder="e.g. 12 345 678 901"
          />
        </div>
        <Field
          label="Tax line label (e.g. “Tax”, “GST”)"
          value={form?.taxLabel ?? ''}
          onChange={v => setForm(f => f ? { ...f, taxLabel: v } : f)}
          placeholder="Tax"
        />
      </CollapsibleSection>

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving || !form}
          className="bg-black text-white px-4 py-2 rounded text-sm hover:bg-gray-800 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-600 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
      />
    </div>
  );
}