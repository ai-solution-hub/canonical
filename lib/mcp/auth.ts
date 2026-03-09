/**
 * MCP server authentication and Supabase client helpers.
 *
 * Creates per-user Supabase clients from OAuth bearer tokens so that
 * RLS policies apply to MCP tool operations. Falls back to a service-role
 * client when no token is available (e.g. during local development or
 * when auth is not required).
 */
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Database } from '@/supabase/types/database.types';

/**
 * Creates a per-user Supabase client from an OAuth bearer token.
 * The token is passed in the Authorization header so that RLS policies
 * are applied based on the authenticated user.
 */
export function createMcpUserClient(bearerToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL environment variable is not set');
  }
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseAnonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable is not set',
    );
  }

  return createSupabaseClient<Database>(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: `Bearer ${bearerToken}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Creates a Supabase client for MCP tool operations.
 *
 * If authInfo is provided (authenticated request), creates a per-user client
 * with the bearer token so RLS applies. Otherwise falls back to the
 * service-role client (no RLS).
 */
export function createMcpClient(authInfo?: AuthInfo) {
  if (authInfo?.token) {
    return createMcpUserClient(authInfo.token);
  }
  return createMcpServiceClient();
}

/**
 * Creates a Supabase service client for MCP tool operations.
 * Uses the service role key to bypass RLS — suitable for admin-level queries.
 *
 * @deprecated Prefer `createMcpClient(authInfo)` for per-user access with RLS.
 */
export function createMcpServiceClient() {
  return createServiceClient();
}

/**
 * Extracts the user ID from authInfo, falling back to a placeholder.
 * The placeholder is used for service-role queries where no user is authenticated.
 */
export function getMcpUserId(authInfo?: AuthInfo): string {
  return (authInfo?.extra?.userId as string) ?? '00000000-0000-0000-0000-000000000000';
}

/**
 * Checks that the authenticated user has one of the required roles.
 * Returns the role string if authorised, or null if the user lacks permission.
 */
export async function checkMcpRole(
  authInfo: AuthInfo | undefined,
  requiredRoles: string[] = ['admin', 'editor'],
): Promise<string | null> {
  const userId = getMcpUserId(authInfo);
  if (userId === '00000000-0000-0000-0000-000000000000') return null;

  const supabase = createMcpClient(authInfo);
  const { data } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .single();

  const role = (data?.role as string) ?? 'viewer';
  return requiredRoles.includes(role) ? role : null;
}
