/**
 * Tests for `lib/env.ts` Zod-validated env exports.
 *
 * @vitest-environment node
 *
 * Run in node environment so `typeof window === 'undefined'` and the
 * server-side parse path actually executes. (The default `jsdom`
 * environment defines `window`, which short-circuits `serverEnv` to
 * `null as never` and prevents the server-side rejection tests from
 * firing.)
 *
 * Strategy: dynamic-import the module after stubbing `process.env`, with
 * `vi.resetModules()` between scenarios so each import re-evaluates the
 * schema. This mirrors how the real boot path works (parse on first
 * import, throw on missing required vars) without polluting the global
 * cached `clientEnv` / `serverEnv` for other tests in the suite.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const VALID_ENV: Record<string, string> = {
  // client (NEXT_PUBLIC_*)
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_test_anon_key',
  NEXT_PUBLIC_APP_URL: 'https://example.vercel.app',
  NEXT_PUBLIC_CLIENT_ID: 'example-client',
  // server
  SUPABASE_SECRET_KEY: 'sb_secret_test_service_key',
  SUPABASE_DBPASSWORD: 'test-db-password',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  OPENAI_API_KEY: 'sk-test',
  CRON_SECRET: 'test-cron-secret',
};

function applyEnv(env: Record<string, string>): void {
  for (const [k, v] of Object.entries(env)) {
    vi.stubEnv(k, v);
  }
}

describe('lib/env.ts boot-time env validation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('exposes typed clientEnv when all required vars are present', async () => {
    applyEnv(VALID_ENV);
    const { clientEnv } = await import('@/lib/env');
    expect(clientEnv.NEXT_PUBLIC_SUPABASE_URL).toBe(
      'https://example.supabase.co',
    );
    expect(clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe(
      'sb_publishable_test_anon_key',
    );
    expect(clientEnv.NEXT_PUBLIC_APP_URL).toBe('https://example.vercel.app');
    expect(clientEnv.NEXT_PUBLIC_CLIENT_ID).toBe('example-client');
  });

  it('exposes typed serverEnv with coerced numeric defaults', async () => {
    applyEnv(VALID_ENV);
    const { serverEnv } = await import('@/lib/env');
    expect(serverEnv.SUPABASE_SECRET_KEY).toBe('sb_secret_test_service_key');
    expect(serverEnv.ANTHROPIC_API_KEY).toBe('sk-ant-test');
    // CLASSIFICATION_BATCH_SIZE has a default of 25 when unset
    expect(serverEnv.CLASSIFICATION_BATCH_SIZE).toBe(25);
  });

  it('coerces CLASSIFICATION_BATCH_SIZE from string to number', async () => {
    applyEnv({ ...VALID_ENV, CLASSIFICATION_BATCH_SIZE: '50' });
    const { serverEnv } = await import('@/lib/env');
    expect(serverEnv.CLASSIFICATION_BATCH_SIZE).toBe(50);
    expect(typeof serverEnv.CLASSIFICATION_BATCH_SIZE).toBe('number');
  });

  it('REJECTS missing NEXT_PUBLIC_CLIENT_ID with the S196-incident message', async () => {
    const incomplete = { ...VALID_ENV };
    delete incomplete.NEXT_PUBLIC_CLIENT_ID;
    applyEnv(incomplete);
    // Stub the missing var to empty string so it is present-but-blank
    // (the failure mode that caused the S196 incident).
    vi.stubEnv('NEXT_PUBLIC_CLIENT_ID', '');

    await expect(import('@/lib/env')).rejects.toThrow(
      /NEXT_PUBLIC_CLIENT_ID.*REQUIRED.*BRANDING fallback corruption.*S196/,
    );
  });

  it('REJECTS malformed NEXT_PUBLIC_SUPABASE_URL with a clear message', async () => {
    applyEnv({ ...VALID_ENV, NEXT_PUBLIC_SUPABASE_URL: 'not-a-url' });
    await expect(import('@/lib/env')).rejects.toThrow(
      /NEXT_PUBLIC_SUPABASE_URL.*valid URL/,
    );
  });

  it('REJECTS missing SUPABASE_SECRET_KEY (server-side)', async () => {
    const incomplete = { ...VALID_ENV };
    delete incomplete.SUPABASE_SECRET_KEY;
    applyEnv(incomplete);
    vi.stubEnv('SUPABASE_SECRET_KEY', '');

    await expect(import('@/lib/env')).rejects.toThrow(
      /SUPABASE_SECRET_KEY.*required/,
    );
  });

  it('REJECTS missing CRON_SECRET (server-side)', async () => {
    const incomplete = { ...VALID_ENV };
    delete incomplete.CRON_SECRET;
    applyEnv(incomplete);
    vi.stubEnv('CRON_SECRET', '');

    await expect(import('@/lib/env')).rejects.toThrow(/CRON_SECRET.*required/);
  });

  it('accepts optional NEXT_PUBLIC_OBSERVABILITY_SENTRY_DSN as empty string', async () => {
    applyEnv({
      ...VALID_ENV,
      NEXT_PUBLIC_OBSERVABILITY_SENTRY_DSN: '',
    });
    const { clientEnv } = await import('@/lib/env');
    // empty-string passthrough or undefined — both indicate "not set"
    expect(
      clientEnv.NEXT_PUBLIC_OBSERVABILITY_SENTRY_DSN === '' ||
        clientEnv.NEXT_PUBLIC_OBSERVABILITY_SENTRY_DSN === undefined,
    ).toBe(true);
  });
});
