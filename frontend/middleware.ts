import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import authMiddleware from 'next-auth/middleware';
import { IS_DEMO } from './app/lib/demo';

// In demo mode there is no sign-on — pass every request through unchanged.
// Live mode defers to NextAuth middleware (redirect unauthenticated → /login).
export default function middleware(req: NextRequest) {
  if (IS_DEMO) return NextResponse.next();
  // next-auth/middleware types expect its augmented NextRequest; our requests
  // satisfy it at runtime — cast to satisfy the compiler.
  return authMiddleware(req as Parameters<typeof authMiddleware>[0]);
}

// Exclude everything under /api/* — backend auth middleware handles cookies
// and service keys. Without this, NextAuth middleware redirects unauthenticated
// /api/* requests to /login before the proxy route handler can forward them.
export const config = {
  matcher: ['/((?!login|api|_next/static|_next/image|favicon.ico|SyncNo.png).*)'],
};
