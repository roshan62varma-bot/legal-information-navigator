/**
 * Pure security policy helpers used by proxy.ts (and unit-tested directly).
 */

export function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    // Nonce + strict-dynamic: only scripts carrying this request's nonce (and what they load) may run.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // React and Radix set element styles at runtime; inline styles cannot execute code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' blob:${isDev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
    "media-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * API calls spend the server's Gemini quota, so only this site may make them.
 * Browsers send Sec-Fetch-Site and Origin on cross-site requests; either one
 * disagreeing with our own origin rejects the call. Non-browser clients that
 * send neither header are still subject to validation and rate limits.
 */
export function isCrossSiteRequest(headers: Headers, ownOrigin: string): boolean {
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = headers.get("origin");
  if (origin && origin !== ownOrigin) return true;
  return false;
}
