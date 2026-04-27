/**
 * Vitest global setup file.
 *
 * Sets deterministic defaults for required env vars so `lib/env.ts`
 * boot-time validation passes in any test environment (CI, local, sandbox)
 * without depending on `.env.local`. Tests that need to override these
 * (e.g. __tests__/lib/env.test.ts itself) use `vi.stubEnv` per-test.
 *
 * `process.env.X = ...` does NOT replace existing values — preserves any
 * value already set by the shell (CI secrets, integration runs, etc.).
 *
 * NEXT_PUBLIC_CLIENT_ID defaults to 'default' here so unit tests get the
 * fallback "Knowledge Hub" branding rather than a per-developer value
 * from `.env.local` (which would make assertions on alt text / product
 * name flaky across machines).
 *
 * Class C tests (integration / e2e tests that read env values directly to
 * construct fixtures) intentionally stay on `process.env.X` rather than
 * routing through `clientEnv` / `serverEnv` — see WP-S5.1 spec §13.9 for
 * the reasoning (Zod parses at module load; `vi.stubEnv` after import has
 * no retroactive effect; integration tests reading values for fixtures
 * gain nothing from the boundary). Production runtime uses
 * `clientEnv` / `serverEnv` to enforce the type-system boundary; test
 * setup uses `process.env` for flexibility.
 *
 * Registers jest-dom matchers and provides polyfills for jsdom.
 * Skips browser polyfills when running in node environment (e.g. real DB
 * integration tests).
 */
const TEST_ENV_DEFAULTS: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_anon_key',
  NEXT_PUBLIC_APP_URL: 'https://test.vercel.app',
  NEXT_PUBLIC_CLIENT_ID: 'default',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_service_key',
  POSTGRES_PASSWORD: 'test-db-password',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  OPENAI_API_KEY: 'sk-test',
  CRON_SECRET: 'test-cron-secret',
};
for (const [k, v] of Object.entries(TEST_ENV_DEFAULTS)) {
  if (!process.env[k]) {
    process.env[k] = v;
  }
}

import '@testing-library/jest-dom/vitest';

// Skip browser polyfills in node environment (real DB integration tests use @vitest-environment node)
if (typeof window === 'undefined') {
  // Nothing to polyfill in node
} else {
  // Polyfill matchMedia (not provided by jsdom)
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });

  // Stub IntersectionObserver (not provided by jsdom)
  class MockIntersectionObserver {
    readonly root = null;
    readonly rootMargin = '0px';
    readonly thresholds: ReadonlyArray<number> = [0];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    value: MockIntersectionObserver,
  });

  // Stub ResizeObserver (not provided by jsdom)
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    value: MockResizeObserver,
  });
} // end if (typeof window !== 'undefined')
