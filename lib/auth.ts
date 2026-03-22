import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { User, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import type { UserRole } from '@/lib/roles';

interface AuthenticatedClient {
  user: User;
  supabase: SupabaseClient<Database>;
}

interface AuthorisedClient extends AuthenticatedClient {
  role: UserRole;
}

/** Discriminated result from getAuthorisedClient — success or typed failure */
export type AuthorisedResult =
  | ({ success: true } & AuthorisedClient)
  | { success: false; reason: 'unauthenticated' | 'forbidden' };

/**
 * Returns an authenticated Supabase client and user in a single operation.
 * Creates a single cookie-based client used for both auth verification
 * and subsequent data operations. Use this for routes that need Supabase
 * data access after authentication.
 */
export async function getAuthenticatedClient(): Promise<AuthenticatedClient | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { user, supabase };
}

/**
 * Returns an authenticated + authorised client with the user's role.
 * Checks authentication first, then verifies the user has one of the required roles.
 * Defaults to 'viewer' if no user_roles entry exists (matches RLS behaviour).
 *
 * Returns a discriminated result:
 * - `{ success: true, user, supabase, role }` — authenticated and authorised
 * - `{ success: false, reason: 'unauthenticated' }` — no valid session (401)
 * - `{ success: false, reason: 'forbidden' }` — wrong role for this route (403)
 */
export async function getAuthorisedClient(
  requiredRoles: UserRole[] = ['admin', 'editor', 'viewer'],
): Promise<AuthorisedResult> {
  const auth = await getAuthenticatedClient();
  if (!auth) return { success: false, reason: 'unauthenticated' };

  const { data } = await auth.supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', auth.user.id)
    .single();

  const role = (data?.role as UserRole) ?? 'viewer';
  if (!requiredRoles.includes(role)) return { success: false, reason: 'forbidden' };

  return { success: true, ...auth, role };
}

/**
 * Returns the correct HTTP error response for an authorisation failure.
 * - `unauthenticated` → 401 Unauthorised (no valid session)
 * - `forbidden` → 403 Forbidden (authenticated but wrong role)
 */
export function authFailureResponse(result: { reason: 'unauthenticated' | 'forbidden' }) {
  if (result.reason === 'unauthenticated') {
    return unauthorisedResponse();
  }
  return forbiddenResponse();
}

/** Standard 401 response for unauthorised requests */
export function unauthorisedResponse() {
  return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
}

/** Standard 403 response for forbidden requests (authenticated but wrong role) */
export function forbiddenResponse() {
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
