export { default } from 'next-auth/middleware';

// Exclude everything under /api/* — backend auth middleware handles cookies
// and service keys. Without this, NextAuth middleware redirects unauthenticated
// /api/* requests to /login before the proxy route handler can forward them.
export const config = {
  matcher: ['/((?!login|api|_next/static|_next/image|favicon.ico|SyncNo.png).*)'],
};
