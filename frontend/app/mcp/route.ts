import { NextRequest, NextResponse } from 'next/server';

// Manual proxy: forwards /mcp to the standalone MCP server container on the
// internal Docker network. Mirrors the /api/[...path] backend proxy: headers
// (including Authorization, which carries the LLM client's MCP_API_TOKEN) and
// the request body are forwarded verbatim, and the response body is streamed
// back unchanged so the MCP Streamable HTTP transport's SSE responses pass
// through intact.
//
// The mcp-server enforces its own bearer-token auth (MCP_API_TOKEN), so this
// route is public (see middleware.ts PUBLIC_PATHS) — no NextAuth session
// required. An LLM client authenticates with the MCP token, not a browser
// session.

const MCP_SERVER = process.env.MCP_SERVER_URL || 'http://localhost:3003';

async function proxy(req: NextRequest) {
  const url = `${MCP_SERVER}/mcp${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    // Drop hop-by-hop / Next.js-internal headers
    if (key.startsWith('next-')) return;
    headers.set(key, value);
  });

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: 'manual',
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text();
  }

  try {
    const upstream = await fetch(url, init);
    const respHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
      if (key === 'transfer-encoding' || key === 'content-encoding') return;
      respHeaders.set(key, value);
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: 'MCP server unreachable', detail: e?.message },
      { status: 502 }
    );
  }
}

export { proxy as GET, proxy as POST, proxy as DELETE };
