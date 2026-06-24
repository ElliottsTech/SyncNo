'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { IS_DEMO } from '../lib/demo';

function LoginContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const error = searchParams.get('error');
  const [loading, setLoading] = useState(false);

  // Demo mode: skip Microsoft button entirely. Fire the demo credentials
  // provider once on mount — it auto-authorizes and redirects to /.
  useEffect(() => {
    if (!IS_DEMO) return;
    signIn('demo', { callbackUrl: '/' });
  }, []);

  if (IS_DEMO) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
        <div className="text-white/80 text-lg">Entering demo…</div>
      </div>
    );
  }

  const handleSignIn = () => {
    setLoading(true);
    signIn('azure-ad', { callbackUrl: '/' });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-600/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md px-6">
        <div className="text-center mb-8">
          <img src="/SyncNo.png" alt="SyncNo" className="h-16 mx-auto mb-4" />
          <h1 className="text-4xl font-bold text-white mb-2">SyncNo</h1>
        </div>

        <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 shadow-2xl border border-white/20">
          <h2 className="text-2xl font-semibold text-white mb-6 text-center">Sign In</h2>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl mb-6 text-sm text-center">
              {error === 'AccessDenied' ? 'Access denied. Contact your administrator.' : 'Sign in failed. Please try again.'}
            </div>
          )}

          <button
            onClick={handleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-[#2B579A] hover:bg-[#1e4378] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
          >
            {loading ? (
              <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-6 h-6" viewBox="0 0 21 21" fill="currentColor">
                <path d="M0 0h10v10H0V0zm11 0h10v10H11V0zM0 11h10v10H0V11zm11 0h10v10H11V11z"/>
              </svg>
            )}
            <span>{loading ? 'Signing in...' : 'Sign in with Microsoft'}</span>
          </button>

          <p className="text-xs text-slate-400 text-center mt-8">
            Protected by Azure Active Directory
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900" />}>
      <LoginContent />
    </Suspense>
  );
}
