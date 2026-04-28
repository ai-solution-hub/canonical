import { createServerClient as createSupabaseServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { Database } from '@/supabase/types/database.types';
import { clientEnv } from '@/lib/env-client';
import { serverEnv } from '@/lib/env-server';

/**
 * Server-side Supabase client for API routes and Server Components (with
 * cookie-based auth).
 *
 * Reads `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
 * from `clientEnv`, which is Zod-validated at boot in `lib/env-client.ts` —
 * guarantees non-empty values, so the previous defensive `if (!supabaseUrl)`
 * checks are redundant here.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createSupabaseServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
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
    },
  );
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
 *
 * Reads URL from `clientEnv.NEXT_PUBLIC_SUPABASE_URL` and the service-role
 * key from `serverEnv.SUPABASE_SERVICE_ROLE_KEY` — both validated at boot.
 */
export function createServiceClient() {
  return createSupabaseClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
