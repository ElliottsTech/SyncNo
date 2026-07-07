import { NextRequest, NextResponse } from 'next/server';

// Manual proxy: forwards every /api/* request (except /api/auth/*, handled by
// the more specific [...nextauth] route) to the backend. Using a route handler
// instead of next.config.js rewrites because afterFiles rewrites run before
// dynamic routes — so a /api/:path* rewrite would shadow NextAuth's
// [...nextauth] catch-all and proxy /api/auth/* to the backend.
//
// Next.js dynamic-route precedence: the more specific /api/auth/[...nextauth]
// wins over this /api/[...path] catch-all for paths under /api/auth/.
//
// Headers and body are forwarded verbatim so the NextAuth session cookie and
// any Authorization header reach the backend intact.

const BACKEND = process.env.BACKEND_URL || 'http://localhost:3002';

async function proxy(req: NextRequest, ctx: { params: { path: string[] } }) {
  const path = ctx.params.path.join('/');
  const url = `${BACKEND}/api/${path}${req.nextUrl.search}`;

  const headers = new Headers();
  // Hop-by-hop headers must not be forwarded (RFC 7230 §6.1). The tenant nginx
  // sets Connection: upgrade for WebSocket support, and forwarding it into the
  // outbound fetch makes undici reject the request (502 "fetch failed").
  const HOP_BY_HOP = new Set([
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailers', 'transfer-encoding', 'upgrade', 'host', 'content-length',
  ]);
  req.headers.forEach((value, key) => {
    if (key.startsWith('next-')) return;
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
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
      { error: 'Backend unreachable', detail: e?.message },
      { status: 502 }
    );
  }
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE, proxy as PATCH };

// Force dynamic rendering — never cache this route's output (Next.js 14 caches
// fetch-based route handlers by default, which would serve stale API responses).
export const dynamic = 'force-dynamic';
