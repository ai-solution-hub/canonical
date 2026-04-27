/**
 * Supabase Client Helper for Integration Tests
 *
 * Provides a service role client for integration tests that need to bypass RLS.
 * Uses SUPABASE_SERVICE_ROLE_KEY for full access.
 *
 * For mock-based tests, re-exports the mock client factory from the shared helpers.
 * For live DB tests (when env vars are available), provides a real Supabase client.
 */
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '../../helpers/mock-supabase';

// Re-export mock helpers for use in integration tests
export { createMockSupabaseClient, type MockSupabaseClient };

/**
 * Check whether live DB credentials are available.
 * Integration tests that require a live DB should skip when this returns false.
 */
export function hasLiveDbCredentials(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/**
 * Create a live Supabase service client for integration tests.
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.
 *
 * WARNING: This client bypasses RLS. Only use in test environments.
 * All test data created via this client must be cleaned up in afterEach.
 */
export async function createLiveServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Live DB integration tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars',
    );
  }

  // Dynamic import to avoid requiring @supabase/supabase-js when only running mock tests
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key);
}
