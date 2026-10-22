import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/dashboard", "/assignment", "/settings"];
const AUTH_ONLY = ["/login", "/signup"];

// Per-request nonce-based CSP, following Next.js's own documented pattern
// (https://nextjs.org/docs/app/guides/content-security-policy). This
// replaces the old static `script-src 'self' 'unsafe-inline'` in
// next.config.ts, which is exactly what HTTP Observatory and Lighthouse
// flag: 'unsafe-inline' lets ANY inline <script> run, injected or not, so
// it provides no real defence against XSS. A nonce is generated fresh per
// request and only scripts carrying that exact nonce are allowed to run --
// Next.js automatically tags its own generated scripts with it (via the
// `x-nonce` request header below, read in the root layout) as long as the
// same nonce also appears in the CSP response header here. `strict-dynamic`
// lets those nonce'd scripts load further scripts they trust, which is what
// Next.js's own chunking needs, without reopening the door to arbitrary
// inline scripts. `object-src 'none'` and a pinned `base-uri`/`frame-ancestors`
// close the other gaps the scanners called out (overly broad/missing
// object-src, no restriction on <base href> or framing).
function buildCsp(nonce: string): string {
  const directives = [
    "default-src 'self'",
    // webpack's dev server compiles with eval()-based source maps and React
    // Fast Refresh needs it too -- without 'unsafe-eval' here, HMR breaks
    // outright in `next dev`. Production builds don't eval() at runtime, so
    // this stays nonce/strict-dynamic-only there, matching what the
    // scanners actually test against (a production deploy).
    process.env.NODE_ENV === "production"
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`,
    `style-src 'self' 'nonce-${nonce}' 'unsafe-inline' https://fonts.googleapis.com`,
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://*.supabase.co https://api.openai.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ];
  return directives.join("; ");
}

export async function proxy(request: NextRequest) {
  // crypto.randomUUID() isn't itself base64 -- encoding it is just a
  // convenient way to get a compact, header-safe nonce value; its
  // unpredictability (not its encoding) is what makes it unguessable.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  // The nonce has to reach two places: the CSP response header (so the
  // browser knows which nonce to accept) and this x-nonce request header
  // (so the root layout -- and Next's own script-tagging -- can read the
  // same value via next/headers).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request: { headers: requestHeaders } });
          response.headers.set("Content-Security-Policy", csp);
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED.some((p) => pathname.startsWith(p));
  const isAuthOnly = AUTH_ONLY.some((p) => pathname.startsWith(p));

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", pathname);
    const redirect = NextResponse.redirect(url);
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  }

  if (isAuthOnly && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    const redirect = NextResponse.redirect(url);
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  }

  if (pathname === "/" && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    const redirect = NextResponse.redirect(url);
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
