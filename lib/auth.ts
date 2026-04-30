import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { User, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import type { UserRole } from '@/lib/roles';
import { logger } from '@/lib/logger';

interface AuthenticatedClient {
  user: User;
  supabase: SupabaseClient<Database>;
}

interface AuthorisedClient extends AuthenticatedClient {
  role: UserRole;
}

/** Discriminated result from getAuthenticatedClient — success or typed failure */
export type AuthenticatedResult =
  | ({ success: true } & AuthenticatedClient)
  | {
      success: false;
      reason: 'unauthenticated' | 'auth_service_failed';
    };

/** Discriminated result from getAuthorisedClient — success or typed failure */
export type AuthorisedResult =
  | ({ success: true } & AuthorisedClient)
  | {
      success: false;
      reason:
        | 'unauthenticated'
        | 'auth_service_failed'
        | 'forbidden'
        | 'role_lookup_failed';
    };

/**
 * Returns an authenticated Supabase client and user in a single operation.
 * Creates a single cookie-based client used for both auth verification
 * and subsequent data operations. Use this for routes that need Supabase
 * data access after authentication.
 *
 * Returns a discriminated result:
 * - `{ success: true, user, supabase }` — authenticated
 * - `{ success: false, reason: 'unauthenticated' }` — no valid session (401)
 * - `{ success: false, reason: 'auth_service_failed' }` — Supabase Auth service
 *   error (transient refresh-token failure, network error to auth endpoint).
 *   Surfaces as 500 so ops alerting fires; do NOT silently downgrade to 401.
 */
export async function getAuthenticatedClient(): Promise<AuthenticatedResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  // A real auth-service error must NOT be silently surfaced as "no user".
  // 401 is expected traffic that does not page; 500 is what alerts ops to a
  // transient Supabase Auth outage. Note: AuthSessionMissingError is the
  // normal "not logged in" case, treat as unauthenticated.
  if (error && error.name !== 'AuthSessionMissingError') {
    logger.error({ err: error }, '[auth] supabase.auth.getUser() failed');
    return { success: false, reason: 'auth_service_failed' };
  }

  if (!user) return { success: false, reason: 'unauthenticated' };
  return { success: true, user, supabase };
}

/**
 * Returns an authenticated + authorised client with the user's role.
 * Checks authentication first, then verifies the user has one of the required roles.
 * Defaults to 'viewer' if no user_roles entry exists (matches RLS behaviour).
 *
 * Returns a discriminated result:
 * - `{ success: true, user, supabase, role }` — authenticated and authorised
 * - `{ success: false, reason: 'unauthenticated' }` — no valid session (401)
 * - `{ success: false, reason: 'auth_service_failed' }` — Supabase Auth
 *   service error (500 — surfaces via inherited result from
 *   `getAuthenticatedClient`)
 * - `{ success: false, reason: 'forbidden' }` — wrong role for this route (403)
 * - `{ success: false, reason: 'role_lookup_failed' }` — DB failure on
 *   `user_roles` read (500 — do not silently downgrade to 'viewer')
 */
export async function getAuthorisedClient(
  requiredRoles: UserRole[] = ['admin', 'editor', 'viewer'],
): Promise<AuthorisedResult> {
  const auth = await getAuthenticatedClient();
  if (!auth.success) return auth;

  const { data, error } = await auth.supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', auth.user.id)
    .single();

  // PGRST116 = "no rows" — the user has no explicit role entry, default
  // to 'viewer' (matches RLS behaviour). Any other error is a real DB
  // failure and must NOT silently downgrade an admin to 'viewer' — that
  // would strip privileges on a transient glitch. Return a typed failure
  // so the caller can surface a 500 instead of 403.
  if (error && error.code !== 'PGRST116') {
    logger.error({ err: error }, '[auth] user_roles lookup failed');
    return { success: false, reason: 'role_lookup_failed' };
  }

  const role = (data?.role as UserRole) ?? 'viewer';
  if (!requiredRoles.includes(role))
    return { success: false, reason: 'forbidden' };

  return { success: true, user: auth.user, supabase: auth.supabase, role };
}

/**
 * Returns the correct HTTP error response for an auth/authorisation failure.
 * - `unauthenticated` → 401 Unauthorised (no valid session)
 * - `auth_service_failed` → 500 Internal Server Error (Supabase Auth service
 *   error — do not silently surface as 401)
 * - `forbidden` → 403 Forbidden (authenticated but wrong role)
 * - `role_lookup_failed` → 500 Internal Server Error (DB failure on the
 *   `user_roles` read — do not silently downgrade to 'viewer')
 */
export function authFailureResponse(result: {
  reason:
    | 'unauthenticated'
    | 'auth_service_failed'
    | 'forbidden'
    | 'role_lookup_failed';
}) {
  if (result.reason === 'unauthenticated') {
    return unauthorisedResponse();
  }
  if (result.reason === 'auth_service_failed') {
    return NextResponse.json(
      { error: 'Authentication service unavailable. Please retry shortly.' },
      { status: 500 },
    );
  }
  if (result.reason === 'role_lookup_failed') {
    return NextResponse.json(
      { error: 'Failed to verify user role. Please retry shortly.' },
      { status: 500 },
    );
  }
  return forbiddenResponse();
}

/** Standard 401 response for unauthorised requests */
export function unauthorisedResponse() {
  return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
}

/** Standard 403 response for forbidden requests (authenticated but wrong role) */
function forbiddenResponse() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/** Standard 429 response for rate-limited requests */
export function rateLimitResponse(resetAt?: number) {
  const headers: Record<string, string> = {};
  if (resetAt) {
    const retryAfterSecs = Math.ceil((resetAt - Date.now()) / 1000);
    if (retryAfterSecs > 0) {
      headers['Retry-After'] = String(retryAfterSecs);
    }
  }
  return NextResponse.json(
    { error: 'Rate limit exceeded. Please try again shortly.' },
    { status: 429, headers },
  );
}
