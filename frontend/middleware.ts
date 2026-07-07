import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

// In DEMO_MODE=1 the public demo bypasses auth entirely — no redirect, no
// session check. In a managed (per-customer) build, every authenticated page
// requires a valid NextAuth session token; unauthenticated visitors are sent to
// /login. The /api/* proxy and NextAuth's own handlers handle auth themselves,
// and static assets are always public.

const SECRET = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;

// Paths that never trigger a login redirect.
//   - /login          : the sign-in page itself
//   - /api/*          : the backend proxy returns its own 401 (and /api/auth/*
//                       is NextAuth's own handler)
//   - /_next/*        : Next.js framework assets (chunks, static, image)
//   - common static   : favicon + brand image
const PUBLIC_PATHS = ['/login', '/api'];
const PUBLIC_EXACT = new Set(['/', '/favicon.ico', '/SyncNo.png']);

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  // Demo build: auth is bypassed everywhere.
  if (process.env.DEMO_MODE === '1' || process.env.NEXT_PUBLIC_DEMO_MODE === '1') {
    return NextResponse.next();
  }

  // Never redirect public paths / static assets.
  if (isPublic(req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  // Managed build: require a NextAuth session token.
  // getToken reads the `next-auth.session-token` (or `__Secure-` variant under
  // https) cookie and validates it against NEXTAUTH_SECRET.
  const token = await getToken({ req, secret: SECRET });

  if (token) {
    return NextResponse.next();
  }

  // Unauthenticated: redirect to /login, preserving the original URL.
  const loginUrl = new URL('/login', req.url);
  loginUrl.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Match everything except framework internals. isPublic() above does the
  // fine-grained public-path filtering; matching broadly here keeps newly added
  // routes protected by default.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|SyncNo.png).*)'],
};
