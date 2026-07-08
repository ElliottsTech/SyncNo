import { NextAuthOptions } from 'next-auth';
import { IS_DEMO, DEMO_USER } from './demo';

// Browser code uses NEXT_PUBLIC_API_URL (relative '/api' → Next.js rewrite → backend).
// This file runs server-side only (NextAuth handler + middleware), so fetches need
// an absolute URL — use BACKEND_URL to hit the backend directly inside the Docker
// network with the service key.
const SERVER_API = process.env.BACKEND_URL
  ? `${process.env.BACKEND_URL}/api`
  : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002/api';
const SERVICE_KEY = process.env.SYNCNO_API_KEY;
const ROLE_REFRESH_MS = 5 * 60 * 1000;

// Server-side calls from NextAuth callbacks run before/independent of a user
// session. Authenticate to the backend via the shared service key.
function serviceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  if (SERVICE_KEY) h['Authorization'] = `Bearer ${SERVICE_KEY}`;
  return h;
}

async function fetchRole(userId: string): Promise<'admin' | 'user' | null> {
  try {
    const r = await fetch(`${SERVER_API}/users/${encodeURIComponent(userId)}/role`, {
      headers: serviceHeaders(),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.role === 'admin' ? 'admin' : 'user';
  } catch {
    return null;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    {
      id: 'azure-ad',
      name: 'Microsoft',
      type: 'oauth',
      version: '2.0',
      wellKnown: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/v2.0/.well-known/openid-configuration`,
      clientId: process.env.AZURE_CLIENT_ID!,
      clientSecret: process.env.AZURE_CLIENT_SECRET!,
      authorization: { params: { scope: 'openid profile email' } },
      idToken: true,
      checks: ['pkce', 'state'],
      profile(profile: any) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: null,
        };
      },
    },
    // NOTE: The demo credentials provider was removed — it caused a NextAuth
    // Configuration error because credentials providers require NEXTAUTH_SECRET
    // to initialize. Demo mode doesn't need a session: the middleware (DEMO_MODE=1)
    // bypasses page auth, the backend (DEMO=yes) bypasses API auth, and the
    // Sidebar/DemoBanner use IS_DEMO for UI (banner + admin links).
  ],
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: { strategy: 'jwt' },
  callbacks: {
    async signIn({ user, account }: any) {
      if (IS_DEMO) return true;
      if (account?.provider === 'azure-ad' && user?.email) {
        try {
          await fetch(`${SERVER_API}/users/upsert`, {
            method: 'POST',
            headers: serviceHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              id: user.id,
              email: user.email,
              name: user.name,
            }),
          });
        } catch (e) {
          console.error('Auth upsert error:', e);
        }
      }
      return true;
    },
    async jwt({ token, account, user, trigger }: any) {
      if (IS_DEMO) {
        token.id = DEMO_USER.id;
        token.role = DEMO_USER.role;
        token.roleCheckedAt = Date.now();
        return token;
      }
      if (account && user) {
        token.id = user.id;
        const role = await fetchRole(user.id);
        token.role = role || 'user';
        token.roleCheckedAt = Date.now();
      } else {
        const now = Date.now();
        const last = token.roleCheckedAt || 0;
        if (!token.role || now - last > ROLE_REFRESH_MS) {
          const role = token.id ? await fetchRole(token.id as string) : null;
          if (role) token.role = role;
          token.roleCheckedAt = now;
        }
      }
      if (trigger === 'update') {
        const role = token.id ? await fetchRole(token.id as string) : null;
        if (role) token.role = role;
        token.roleCheckedAt = Date.now();
      }
      return token;
    },
    async session({ session, token }: any) {
      if (IS_DEMO) {
        session.user = { ...DEMO_USER };
        return session;
      }
      if (session.user) {
        session.user.id = token.sub;
        session.user.role = token.role || 'user';
      }
      return session;
    },
  },
};
