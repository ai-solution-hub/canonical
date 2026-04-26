import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { PUBLIC_ROUTES } from '@/lib/routes';
import { clientEnv } from '@/lib/env-client';

// Public routes from shared constant, plus /.well-known which is an
// API-like route that only needs the proxy bypass (no UI guard needed).
const publicRoutes = [
  ...PUBLIC_ROUTES,
  '/.well-known', // OAuth protected resource metadata (MCP discovery)
];

export async function proxy(request: NextRequest) {
  // URL + PUBLISHABLE_KEY are validated at boot in lib/env-client.ts —
  // missing values fail the build, so no defensive fallback is needed here.

  // Pass pathname to layout so it can render minimal chrome for share routes
  request.headers.set('x-pathname', request.nextUrl.pathname);

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
    // Redirect unauthenticated users to login
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
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
