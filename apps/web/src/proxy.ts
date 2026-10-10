import { NextResponse, type NextRequest } from "next/server";

// In production Caddy sends /api/* straight to Express and this never sees it. In dev and e2e runs,
// forward it here: proxy.ts reads API_ORIGIN at request time, unlike next.config rewrites (fixed at build).
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4000";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) return NextResponse.rewrite(new URL(pathname + search, API_ORIGIN));
  return withCsp(request);
}

/** A fresh CSP nonce per page view; Next.js applies it to its own scripts automatically. */
function withCsp(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // React sets style attributes (e.g. progress bar widths); attributes can't carry a nonce.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [{
    source: "/((?!_next/static|_next/image|favicon.ico|icon|og.png|robots.txt|manifest.webmanifest).*)",
    missing: [
      { type: "header", key: "next-router-prefetch" },
      { type: "header", key: "purpose", value: "prefetch" },
    ],
  }, "/api/:path*"],
};
