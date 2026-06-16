import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DB_OPTION } from '@/lib/supabase/schema';

/**
 * Create a Supabase client using the service role key.
 * This bypasses RLS entirely, allowing direct DB operations for test data
 * seeding and cleanup without needing an authenticated user session.
 */
export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars. ' +
        'Ensure .env.local is loaded or these are set in the environment.',
    );
  }

  // ID-115 (S9): route to the exposed `api` schema (public is unexposed post-cutover).
  return createClient(url, key, { ...DB_OPTION });
}
