/**
 * MCP server authentication and Supabase client helpers.
 *
 * Creates per-user Supabase clients from OAuth bearer tokens so that
 * RLS policies apply to MCP tool operations. Auth is required — if no
 * token is available, tools will throw rather than silently bypassing RLS.
 */
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Database } from '@/supabase/types/database.types';
import { sb } from '@/lib/supabase/safe';
import { clientEnv } from '@/lib/env-client';
import { DB_OPTION } from '@/lib/supabase/schema';

/**
 * Creates a per-user Supabase client from an OAuth bearer token.
 * The token is passed in the Authorization header so that RLS policies
 * are applied based on the authenticated user.
 *
 * URL + PUBLISHABLE_KEY are validated at boot in `lib/env-client.ts` —
 * the previous defensive `if (!supabaseUrl) throw` checks are unreachable.
 */
export function createMcpUserClient(bearerToken: string) {
  return createSupabaseClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      ...DB_OPTION,
      global: {
        headers: { Authorization: `Bearer ${bearerToken}` },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

/**
 * Creates a per-user Supabase client for MCP tool operations.
 * Requires a valid authInfo with a bearer token — throws if missing.
 */
export function createMcpClient(authInfo?: AuthInfo) {
  if (!authInfo?.token) {
    throw new Error('MCP authentication required: no bearer token provided');
  }
  return createMcpUserClient(authInfo.token);
}

/**
 * Extracts the user ID from authInfo.
 * Throws if no authenticated user — all MCP tools require authentication.
 */
export function getMcpUserId(authInfo?: AuthInfo): string {
  const userId = authInfo?.extra?.userId as string | undefined;
  if (!userId) {
    throw new Error('MCP authentication required: no user ID in auth context');
  }
  return userId;
}

/**
 * Gets the authenticated user's application role (admin/editor/viewer).
 * Returns the role string, defaulting to 'viewer' if no user_roles entry exists.
 */
export async function getMcpUserRole(authInfo: AuthInfo): Promise<string> {
  // Use cached role from verifyToken if available
  if (authInfo.extra?.role && typeof authInfo.extra.role === 'string') {
    return authInfo.extra.role;
  }
  // Fallback: query the database. In production this branch is currently
  // dead code because verifyToken always caches authInfo.extra.role above —
  // but we still must NOT silently downgrade to 'viewer' on a transient DB
  // error. PGRST116 (no rows) is the legitimate "no role entry → viewer"
  // case; any other error must throw so the caller can reject auth rather
  // than handing back a stripped role.
  const userId = getMcpUserId(authInfo);
  const supabase = createMcpClient(authInfo);
  // sb() throws SupabaseError on any PostgREST failure (transient DB error
  // → 5xx upstream), satisfying the S151 rule that we never silently
  // downgrade to 'viewer' on a lookup error. .maybeSingle() returns null
  // for the legitimate "no row" case, which falls through to the
  // 'viewer' default below.
  const data = await sb(
    supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle(),
    'mcp.auth.role.read',
  );

  return (data?.role as string) ?? 'viewer';
}

/**
 * Checks that the authenticated user has one of the required roles.
 * Returns the role string if authorised, or null if the user lacks permission.
 */
export async function checkMcpRole(
  authInfo: AuthInfo | undefined,
  requiredRoles: string[] = ['admin', 'editor'],
): Promise<string | null> {
  if (!authInfo) return null;
  const role = await getMcpUserRole(authInfo);
  return requiredRoles.includes(role) ? role : null;
}
