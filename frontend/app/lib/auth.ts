import { NextAuthOptions } from 'next-auth';

const API = process.env.NEXT_PUBLIC_API_URL || '/api';
const ROLE_REFRESH_MS = 5 * 60 * 1000;

async function fetchRole(userId: string): Promise<'admin' | 'user' | null> {
  try {
    const r = await fetch(`${API}/users/${encodeURIComponent(userId)}/role`);
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
  ],
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: { strategy: 'jwt' },
  callbacks: {
    async signIn({ user, account }: any) {
      if (account?.provider === 'azure-ad' && user?.email) {
        try {
          await fetch(`${API}/users/upsert`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
      if (session.user) {
        session.user.id = token.sub;
        session.user.role = token.role || 'user';
      }
      return session;
    },
  },
};
