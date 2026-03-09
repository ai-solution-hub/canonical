import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Create a Supabase client using the service role key.
 * This bypasses RLS entirely, allowing direct DB operations for test data
 * seeding and cleanup without needing an authenticated user session.
 */
export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY env vars. ' +
        'Ensure .env.local is loaded or these are set in the environment.'
    );
  }

  return createClient(url, key);
}
