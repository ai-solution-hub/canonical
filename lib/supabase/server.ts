import { createServerClient as createSupabaseServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { Database } from '@/supabase/types/database.types';

/** Server-side Supabase client for API routes and Server Components (with cookie-based auth) */
export async function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL environment variable is not set');
  }
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseAnonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY environment variable is not set',
    );
  }

  const cookieStore = await cookies();

  return createSupabaseServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // The `setAll` method is called from a Server Component.
          // This is safe — proxy.ts refreshes sessions on every request.
        }
      },
    },
  });
}

/**
 * Service client that bypasses RLS entirely via SUPABASE_SERVICE_ROLE_KEY.
 *
 * **When to use:** Admin-only routes (after `getAuthorisedClient(['admin'])`),
 * cron jobs (after `verifyCronAuth()`), pipeline operations, storage uploads,
 * and `auth.admin.*` calls (display name resolution, user management).
 *
 * **When NOT to use:** User-facing data queries — use `getAuthorisedClient()`
 * from `lib/auth.ts` instead, which respects RLS.
 *
 * Audited S102: all 17 call sites verified as properly guarded.
 */
export function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL environment variable is not set');
  }
  const supabaseSecretKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseSecretKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is not set');
  }

  return createSupabaseClient<Database>(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
