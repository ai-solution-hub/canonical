import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { PUBLIC_ROUTES } from '@/lib/routes';
import { clientEnv } from '@/lib/env-client';
// Direct imports (not via @/lib/logger barrel) — proxy runs on every
// request matched by the matcher, so avoid pulling pino's module-load
// cost into the proxy hot path. CLAUDE.md "no barrel re-exports" rule.
import { runWithRequestContext } from '@/lib/logger/request-context';
import type { RequestContext } from '@/lib/logger/types';

// Public routes from shared constant, plus /.well-known which is an
// API-like route that only needs the proxy bypass (no UI guard needed).
const publicRoutes = [
  ...PUBLIC_ROUTES,
  '/.well-known', // OAuth protected resource metadata (MCP discovery)
];

/**
 * `x-request-id` header name — the canonical correlation ID surface that
 * carries through to route handlers (request header), Vercel access logs
 * (response header), and Sentry events (tag, applied by the logger
 * Sentry bridge).
 *
 * Per structured-logging-spec.md §4.3:
 *  - Proxy mints (crypto.randomUUID()).
 *  - Forwards on the REQUEST header so route handlers / withRequestContext
 *    can read and seed the AsyncLocalStorage scope inside the handler's
 *    execution context (proxy and handler run in separate contexts in
 *    Next.js — scope set here does not propagate to handlers).
 *  - Echoed back on the RESPONSE header so the caller / browser devtools
 *    can paste the same ID into a Sentry / Axiom search later.
 *
 * If a caller already supplied `x-request-id` (e.g. an upstream gateway
 * tagged the request), we honour it rather than mint a fresh one — keeps
 * end-to-end traceability across multi-hop calls. Bare-uuid validation
 * keeps the surface untrusted-input safe.
 */
const REQUEST_ID_HEADER = 'x-request-id';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveRequestId(request: NextRequest): string {
  const supplied = request.headers.get(REQUEST_ID_HEADER);
  if (supplied && UUID_RE.test(supplied)) return supplied.toLowerCase();
  return crypto.randomUUID();
}

export async function proxy(request: NextRequest) {
  // URL + PUBLISHABLE_KEY are validated at boot in lib/env-client.ts —
  // missing values fail the build, so no defensive fallback is needed here.

  // Pass pathname to layout so it can render minimal chrome for share routes
  request.headers.set('x-pathname', request.nextUrl.pathname);

  // Mint (or honour) the per-request correlation ID and put it on the
  // REQUEST headers so route handlers can read it, plus the RESPONSE
  // headers so the caller can correlate with logs/Sentry/Axiom.
  const requestId = resolveRequestId(request);
  request.headers.set(REQUEST_ID_HEADER, requestId);

  const ctx: RequestContext = {
    requestId,
    route: request.nextUrl.pathname,
    method: request.method,
    startedAt: Date.now(),
  };

  // Establish an AsyncLocalStorage scope around the proxy body so any
  // log lines emitted from inside the proxy (Supabase auth resolution,
  // redirects, etc.) carry the requestId. NOTE: this scope does NOT
  // propagate to route handlers — Next.js runs them in a separate
  // execution context. Phase 2 introduces a per-route `withRequestContext`
  // wrapper that re-seeds the scope inside the handler from the
  // `x-request-id` request header set above (spec §4.3).
  return runWithRequestContext(ctx, async () => {
    let supabaseResponse = NextResponse.next({ request });

    const supabase = createServerClient(
      clientEnv.NEXT_PUBLIC_SUPABASE_URL,
      clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value),
            );
            supabaseResponse = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options),
            );
          },
        },
      },
    );

    // IMPORTANT: Do NOT use supabase.auth.getSession() — it reads from cookies
    // without validation. Use getUser() which contacts the auth server.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { pathname } = request.nextUrl;

    // Allow public routes and API routes through without auth check
    const isPublicRoute = publicRoutes.some((route) =>
      pathname.startsWith(route),
    );
    const isApiRoute = pathname.startsWith('/api/');

    if (!user && !isPublicRoute && !isApiRoute) {
      // Redirect unauthenticated users to login. Echo the request ID on
      // the redirect response so the caller can still correlate.
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      const redirect = NextResponse.redirect(url);
      redirect.headers.set(REQUEST_ID_HEADER, requestId);
      return redirect;
    }

    // Echo the request ID on the response so callers / devtools / Vercel
    // logs share the same correlation surface.
    supabaseResponse.headers.set(REQUEST_ID_HEADER, requestId);
    return supabaseResponse;
  });
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimisation)
     * - favicon.ico (favicon)
     * - public assets
     */
    '/((?!_next/static|_next/image|favicon.ico|fonts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2)$).*)',
  ],
};
