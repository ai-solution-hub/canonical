/**
 * Routes that do not require authentication.
 *
 * Shared between proxy.ts (server-side redirect) and client components
 * (conditional chrome rendering). Keep both consumers in sync by importing
 * from this module.
 *
 * Note: /.well-known is an API-like route handled separately in proxy.ts
 * and does not need UI-level guards.
 */
export const PUBLIC_ROUTES = [
  '/login',
  '/auth/callback',
  '/oauth/consent',
] as const;

/** Check whether a pathname matches a public (unauthenticated) route. */
export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname.startsWith(route));
}
