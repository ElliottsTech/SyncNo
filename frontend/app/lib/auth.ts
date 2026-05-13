import { NextAuthOptions } from 'next-auth';

const API = process.env.NEXT_PUBLIC_API_URL || '/api';

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
    async signIn({ user, account, profile }: any) {
      if (account?.provider === 'azure-ad' && user?.email) {
        try {
          // Upsert user
          await fetch(`${API}/users/upsert`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: user.id,
              email: user.email,
              name: user.name,
            }),
          });

          // Update last login
          await fetch(`${API}/users/${user.id}/last-login`, { method: 'PUT' });
        } catch (e) {
          console.error('Auth callback error:', e);
        }
      }
      return true;
    },
    async jwt({ token, account, user }: any) {
      if (account) {
        token.accessToken = account.access_token;
      }
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }: any) {
      if (session.user) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
};
