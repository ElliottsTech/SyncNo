'use client';
import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react'
import { IS_DEMO } from '../../../app/lib/demo';
import { useRouter } from 'next/navigation';
import CollapsibleSection from '../../../components/CollapsibleSection';
import { usePageTitle } from '../../../lib/usePageTitle';

const API = '/api';

type McpSettings = {
  mcpApiToken: string | null;
  mcpApiTokenMasked: string | null;
  mcpApiTokenExists: boolean;
  syncnoApiKeyMasked: string | null;
  syncnoApiKeyExists: boolean;
  mcpPort: number;
  backendUrl: string;
  publicHost: string | null;
  mcpUrl: string | null;
};

export default function McpPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  usePageTitle('MCP — SyncNo');

  const [settings, setSettings] = useState<McpSettings | null>(null);
  // The token freshly returned by generate — shown in full once, then discarded
  // in favor of the masked value from the settings endpoint.
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!IS_DEMO && status === 'authenticated' && session?.user?.role !== 'admin') {
      router.replace('/');
      return;
    }
    if (!IS_DEMO && status !== 'authenticated') return;
    refresh();
  }, [status, session, router]);

  const refresh = async () => {
    try {
      const r = await fetch(`${API}/mcp-settings`);
      if (!r.ok) throw new Error('Failed to load MCP settings');
      const d = await r.json();
      setSettings(d);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    setNotice(null);
    setFreshToken(null);
    try {
      const r = await fetch(`${API}/mcp-settings/generate`, { method: 'POST' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      const d = await r.json();
      setFreshToken(d.mcpApiToken);
      setRevealed(true);
      setNotice(
        d.envWritten
          ? 'Token generated and written to .env. Copy it now — it will only be shown in full until you leave this page. Restart the MCP server for it to take effect.'
          : 'Token generated and saved to the database, but the .env file could not be written (check backend logs). Restart the MCP server for the DB value to be used.',
      );
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1500);
    } catch {
      setError('Clipboard not available in this browser.');
    }
  };

  // ─── Derived connection strings ───────────────────────────────────────────
  // The mcp-server container is NOT published; LLM clients reach it through the
  // frontend's /mcp proxy, so the client-facing URL is <publicHost>/mcp — same
  // host/port as the rest of the app. Falls back to a placeholder when the
  // public host isn't known (NEXTAUTH_URL unset, e.g. local dev).
  const mcpUrl = settings?.mcpUrl || 'http://your-host/mcp';
  const token = freshToken ?? settings?.mcpApiToken ?? '<MCP_API_TOKEN>';

  const claudeConfig = JSON.stringify(
    {
      mcpServers: {
        syncno: {
          url: mcpUrl,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );

  const curlList = `curl -s -X POST ${mcpUrl} \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`;

  const aiInstructions = `You are configuring access to a SyncNo instance over the Model Context Protocol (MCP).

SyncNo is a read-only view over an MSP (Syncro) dataset — customers, tickets,
invoices, assets, products, vendors, contracts, leads, appointments, schedules,
wiki pages, and more.

An MCP server is already running and exposes ~60 tools over the Streamable HTTP
transport. Every request MUST carry this header:

    Authorization: Bearer ${token}

Endpoint URL: ${mcpUrl}

To configure your MCP client, add a server entry pointing at that URL with the
bearer header above. For Claude Desktop / a remote MCP client, the config is:

${claudeConfig}

Available tool categories (call "tools/list" on the endpoint to see all of them):
- search            — cross-entity search across 14 types (START HERE to find records)
- list_<entity>     — paginated list with filters + sort, one per entity
- get_<entity>      — full detail of one record (raw_json stripped unless includeRawJson=true)
- get_<parent>_<relation> — drill-downs (e.g. get_customer_tickets, get_ticket_comments)
- lookup_serial     — find an item by serial number
- get_sync_status / get_sync_last_results / get_system_version — operational status

All tools are READ-ONLY. They cannot modify data, trigger syncs, or read secrets.
Page size is capped at 50 rows (default 25).`;

  if (!IS_DEMO && status !== 'authenticated') {
    return <div className="p-8 text-gray-500">Loading…</div>;
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">MCP Server</h1>
      <p className="text-sm text-gray-600 mb-6">
        Expose SyncNo data to an LLM over the{' '}
        <a
          href="https://modelcontextprotocol.io"
          target="_blank"
          rel="noreferrer"
          className="text-blue-600 hover:underline"
        >
          Model Context Protocol
        </a>
        . Generate a token below, then hand a client the connection details (or
        the “If you are an AI…” block) so it can configure itself. All tools are
        read-only; the MCP server cannot modify data or read secrets.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-300 text-red-800 rounded p-3 text-sm mb-4">
          {error}
        </div>
      )}
      {notice && (
        <div className="bg-green-50 border border-green-300 text-green-800 rounded p-3 text-sm mb-4 whitespace-pre-line">
          {notice}
        </div>
      )}

      {/* ─── Credentials ─────────────────────────────────────────────────── */}
      <CollapsibleSection
        title="Credentials"
        containerClassName="bg-white rounded border p-4 mb-4"
        bodyClassName="mt-3 space-y-4"
        headerClassName="w-full flex justify-between items-center text-left -mt-1"
      >
        {/* MCP_API_TOKEN */}
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600">MCP API Token</span>
            <div className="flex items-center gap-2">
              {settings?.mcpApiTokenExists ? (
                <span className="text-xs text-green-600">✓ Configured</span>
              ) : (
                <span className="text-xs text-gray-500">Not generated</span>
              )}
            </div>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 block bg-gray-50 border border-gray-300 rounded px-3 py-2 text-sm font-mono break-all">
              {revealed && (freshToken ?? settings?.mcpApiToken)
                ? freshToken ?? settings?.mcpApiToken
                : settings?.mcpApiTokenMasked ?? '—'}
            </code>
            {(freshToken ?? settings?.mcpApiToken) && (
              <button
                onClick={() => setRevealed(r => !r)}
                className="bg-white border px-3 py-2 rounded text-sm hover:bg-gray-50 whitespace-nowrap"
              >
                {revealed ? 'Hide' : 'Reveal'}
              </button>
            )}
            {(freshToken ?? settings?.mcpApiToken) && (
              <button
                onClick={() =>
                  copy('token', String(freshToken ?? settings?.mcpApiToken))
                }
                className="bg-white border px-3 py-2 rounded text-sm hover:bg-gray-50 whitespace-nowrap"
              >
                {copied === 'token' ? 'Copied!' : 'Copy'}
              </button>
            )}
          </div>
          <button
            onClick={generate}
            disabled={generating}
            className="mt-2 bg-black text-white px-4 py-2 rounded text-sm hover:bg-gray-800 disabled:opacity-50"
          >
            {generating
              ? 'Generating…'
              : settings?.mcpApiTokenExists
                ? 'Rotate token'
                : 'Generate token'}
          </button>
          {settings?.mcpApiTokenExists && (
            <p className="text-xs text-gray-500 mt-2">
              Rotating invalidates the previous token. The MCP server reads it at
              startup, so restart the <code>mcp-server</code> container after
              rotating:{' '}
              <code>docker compose up -d mcp-server</code>.
            </p>
          )}
        </div>

        {/* SYNCNO_API_KEY (read-only) */}
        <div className="pt-3 border-t">
          <span className="text-xs text-gray-600">
            Backend → MCP server key (SYNCNO_API_KEY)
          </span>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 block bg-gray-50 border border-gray-300 rounded px-3 py-2 text-sm font-mono break-all">
              {settings?.syncnoApiKeyMasked ?? '—'}
            </code>
            <button
              onClick={() =>
                settings?.syncnoApiKeyMasked &&
                copy('syncno', settings.syncnoApiKeyMasked)
              }
              disabled={!settings?.syncnoApiKeyMasked}
              className="bg-white border px-3 py-2 rounded text-sm hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
            >
              {copied === 'syncno' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Read-only. This is the service key the MCP server uses to reach the
            backend; it is already configured in <code>.env</code>. Do not rotate
            it from here.
          </p>
        </div>
      </CollapsibleSection>

      {/* ─── Connect a client ────────────────────────────────────────────── */}
      <CollapsibleSection
        title="Connect a client"
        containerClassName="bg-white rounded border p-4 mb-4"
        bodyClassName="mt-3 space-y-4"
        headerClassName="w-full flex justify-between items-center text-left -mt-1"
      >
        <p className="text-xs text-gray-500">
          MCP server URL:{' '}
          <code className="font-mono">{mcpUrl}</code>
          {!settings?.publicHost && (
            <span className="ml-1">
              (host is a placeholder — set <code>NEXTAUTH_URL</code> so this page
              knows the public address)
            </span>
          )}
        </p>

        <CopyBlock
          label="Claude Desktop / remote MCP config"
          value={claudeConfig}
          copied={copied === 'claude'}
          onCopy={() => copy('claude', claudeConfig)}
        />
        <CopyBlock
          label="curl — list available tools"
          value={curlList}
          copied={copied === 'curl'}
          onCopy={() => copy('curl', curlList)}
        />
      </CollapsibleSection>

      {/* ─── If you are an AI… ───────────────────────────────────────────── */}
      <CollapsibleSection
        title='“If you are an AI…” instructions'
        containerClassName="bg-white rounded border p-4 mb-4"
        bodyClassName="mt-3 space-y-3"
        headerClassName="w-full flex justify-between items-center text-left -mt-1"
      >
        <p className="text-xs text-gray-500">
          A self-contained block written for an LLM. Point an AI at this page
          (or paste the block) and ask it to configure its own MCP client using
          the embedded token and URL.
        </p>
        <CopyBlock
          label="AI self-configuration instructions"
          value={aiInstructions}
          copied={copied === 'ai'}
          onCopy={() => copy('ai', aiInstructions)}
          rows={18}
        />
      </CollapsibleSection>
    </div>
  );
}

/** A labeled, copyable code block. */
function CopyBlock({
  label,
  value,
  copied,
  onCopy,
  rows = 8,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  rows?: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-600">{label}</span>
        <button
          onClick={onCopy}
          data-testid={`copy-${label}`}
          className="bg-white border px-3 py-1 rounded text-xs hover:bg-gray-50"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre
        className="bg-gray-50 border border-gray-300 rounded p-3 text-xs font-mono overflow-auto"
        style={{ maxHeight: `${rows * 1.5}rem` }}
      >
        {value}
      </pre>
    </div>
  );
}
