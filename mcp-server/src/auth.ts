/**
 * Constant-time string comparison for bearer-token checks.
 *
 * We do NOT use `crypto.timingSafeEqual` directly because it requires equal-
 * length Buffers and would throw (and leak length) on mismatched inputs. This
 * variant normalizes length first.
 */

export function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Extract a bearer token from an Authorization header, or null if absent/malformed. */
export function extractBearer(authHeader: string | undefined | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}
