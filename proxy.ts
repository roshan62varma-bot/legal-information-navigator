import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, createNonce, isCrossSiteRequest } from "@/lib/security";

/**
 * Runs before every page and API request.
 *  - Pages: a fresh CSP nonce per request (Next.js applies it to its own scripts).
 *  - API:   rejects cross-site calls and non-POST methods before any work is done.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (request.method !== "POST") {
      return NextResponse.json({ error: "Method not allowed.", code: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST" } });
    }
    if (isCrossSiteRequest(request.headers, request.nextUrl.origin)) {
      return NextResponse.json({ error: "Cross-site requests are not allowed.", code: "FORBIDDEN_ORIGIN" }, { status: 403 });
    }
    return NextResponse.next();
  }

  const nonce = createNonce();
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and prefetches (they do not need a nonce).
    {
      source: "/((?!_next/static|_next/image|favicon.ico|pdf.worker.min.mjs).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
