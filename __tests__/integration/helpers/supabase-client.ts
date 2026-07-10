/**
 * Supabase Client Helper for Integration Tests
 *
 * Provides a service role client for integration tests that need to bypass RLS.
 * Uses SUPABASE_SERVICE_ROLE_KEY for full access.
 *
 * For mock-based tests, re-exports the mock client factory from the shared helpers.
 * For live DB tests (when env vars are available), provides a real Supabase client.
 *
 * bl-424: eagerly self-loads .env/.env.local at import time — mirrors
 * service-client.ts. Without this, `vitest.integration.config.ts`'s
 * `pool: 'forks'` workers never see `.env.local` (only the top-level `bun
 * run` process auto-loads it; forked workers do not inherit that load), so
 * `hasLiveDbCredentials()`/`hasRealLiveDbCredentials()` fell back to
 * `__tests__/setup.ts`'s dummy `test.supabase.co` defaults and every
 * live-DB-gated suite skipped silently — `bun run test:integration` passed
 * in ~130ms having exercised nothing, an easy-to-miss false green.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '../../helpers/mock-supabase';
import { DB_OPTION } from '@/lib/supabase/schema';
import { findProjectRoot } from './find-project-root';

// Re-export mock helpers for use in integration tests
export { createMockSupabaseClient, type MockSupabaseClient };

// Resolve the project root from a dotenv marker file. In CI the env vars are
// injected directly into the process environment (no .env/.env.local on
// disk), so findProjectRoot() throws — fall back to the ambient process.env
// in that case (mirrors service-client.ts's guard).
let projectRoot: string | null = null;
try {
  projectRoot = findProjectRoot();
} catch {
  projectRoot = null;
}
if (projectRoot) {
  // Load .env then .env.local with override (Next.js convention — .env.local
  // wins). Without override:true the second load is a no-op for keys already
  // set by .env, so stale .env values would silently win.
  config({ path: resolve(projectRoot, '.env') });
  config({ path: resolve(projectRoot, '.env.local'), override: true });
}

/**
 * Check whether live DB credentials are available.
 * Integration tests that require a live DB should skip when this returns false.
 *
 * Logs an explicit, named reason on a `false` result (never the credential
 * VALUES themselves) so a skipped suite is a loud, diagnosable skip rather
 * than a silent one.
 */
export function hasLiveDbCredentials(): boolean {
  const hasUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  const hasKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (hasUrl && hasKey) return true;

  const missing = [
    !hasUrl && 'NEXT_PUBLIC_SUPABASE_URL',
    !hasKey && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter((v): v is string => !!v);
  console.warn(
    `hasLiveDbCredentials: skipping live-DB suite — missing env var(s): ${missing.join(', ')}. ` +
      'Ensure .env.local is present at the project root, or set these directly in the environment.',
  );
  return false;
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
  if (url.includes('test.supabase.co')) {
    console.warn(
      'hasRealLiveDbCredentials: skipping live-DB suite — NEXT_PUBLIC_SUPABASE_URL ' +
        'still resolves to the __tests__/setup.ts dummy (test.supabase.co); ' +
        '.env.local was not found/loaded for this worker. Ensure .env.local exists ' +
        'at the project root with a real Supabase URL.',
    );
    return false;
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  // Dummy default from __tests__/setup.ts is `sb_secret_test_service_key`.
  if (key.includes('test_service_key')) {
    console.warn(
      'hasRealLiveDbCredentials: skipping live-DB suite — SUPABASE_SERVICE_ROLE_KEY ' +
        'still resolves to the __tests__/setup.ts dummy placeholder; .env.local was ' +
        'not found/loaded for this worker. Ensure .env.local exists at the project ' +
        'root with a real service-role key.',
    );
    return false;
  }
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
  error: {
    message?: string | null;
    details?: string | null;
    code?: string | null;
  } | null,
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
  // ID-115 (S9): route to the exposed `api` schema (public is unexposed post-cutover).
  return createClient(url, key, { ...DB_OPTION });
}
