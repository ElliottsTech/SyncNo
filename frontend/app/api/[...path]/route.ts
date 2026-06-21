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
      { error: 'Backend unreachable', detail: e?.message },
      { status: 502 }
    );
  }
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE, proxy as PATCH };
