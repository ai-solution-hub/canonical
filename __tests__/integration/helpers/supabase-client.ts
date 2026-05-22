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
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/**
 * Tighter live-DB gate: skip when the URL is the dummy default from
 * `__tests__/setup.ts` (`test.supabase.co`) OR when credentials look
 * like the test placeholders. The dummy URL fails DNS resolution
 * rather than returning meaningful PostgREST errors — tests that
 * intend to assert real DB state should skip cleanly when this is the
 * case.
 *
 * Use this in `describe.skipIf(!hasRealLiveDbCredentials())` for any
 * test that reads live DB content and asserts on the rows / errors
 * returned. Tests that only need to PROBE for table existence (and
 * accept a generic error) can use the looser `hasLiveDbCredentials()`.
 */
export function hasRealLiveDbCredentials(): boolean {
  if (!hasLiveDbCredentials()) return false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  // Dummy default from __tests__/setup.ts is `https://test.supabase.co`.
  // CI default values share the `test.supabase.co` hostname.
  if (url.includes('test.supabase.co')) return false;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  // Dummy default from __tests__/setup.ts is `sb_secret_test_service_key`.
  if (key.includes('test_service_key')) return false;
  return true;
}

/**
 * Detect when a Supabase error is a network-level failure (DNS lookup,
 * fetch abort) rather than a PostgREST application-level error.
 *
 * In sandbox / network-isolated environments (e.g. Claude Code sandbox
 * mode), outbound DNS to *.supabase.co fails with `ENOTFOUND`. Live-DB
 * integration tests should treat this as a clean skip rather than a
 * test-content failure — the SQL contract is unverifiable from a
 * network-isolated environment.
 *
 * Usage in tests:
 *   const { data, error } = await client.from('...').select('...');
 *   if (isNetworkIsolationError(error)) {
 *     // eslint-disable-next-line no-console
 *     console.warn('Skipping: network-isolated environment');
 *     return;
 *   }
 *   expect(error).toBeNull();
 *   // ... assertions
 */
export function isNetworkIsolationError(
  error: { message?: string | null; details?: string | null; code?: string | null } | null,
): boolean {
  if (!error) return false;
  const probe = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();
  return (
    probe.includes('fetch failed') ||
    probe.includes('enotfound') ||
    probe.includes('getaddrinfo') ||
    probe.includes('network request failed')
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
