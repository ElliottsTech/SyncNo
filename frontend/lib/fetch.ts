// Centralized fetch wrapper for client-side data calls.
//
// The backend (apps/demo-backend auth middleware) rejects unauthenticated
// requests with 401 { error: 'Authentication required' }. The old pattern
// `fetch().then(r => r.json()).then(setX)` fed that error object straight into
// state, and DataTable's `[...data]` then threw "TypeError: r is not iterable".
//
// fetchJson makes every client call safe:
//   - sends credentials (the NextAuth session cookie) on every request,
//   - on 401 redirects the browser to /login and throws a sentinel so callers
//     never try to render the error body,
//   - on other non-OK throws an Error the caller can catch into an empty state,
//   - on OK returns the parsed JSON.

// Sentinel thrown on 401. Callers can swallow it; the page is navigating away.
export class UnauthorizedError extends Error {
  constructor() {
    super('Authentication required');
    this.name = 'UnauthorizedError';
  }
}

// Redirect to /login, preserving the current location as callbackUrl.
// Guarded for SSR / non-browser environments (fetchJson can be imported server-
// side too, e.g. from route handlers, where window is undefined).
function redirectToLogin() {
  if (typeof window !== 'undefined') {
    const callbackUrl = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?callbackUrl=${callbackUrl}`;
  }
}

export async function fetchJson<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init });

  if (res.status === 401) {
    redirectToLogin();
    throw new UnauthorizedError();
  }

  if (!res.ok) {
    // Best-effort message extraction; never let parsing failure mask the status.
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body && typeof body.error === 'string') message = body.error;
    } catch {
      /* non-JSON error body — keep the status message */
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}
