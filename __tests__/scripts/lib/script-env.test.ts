import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  assertEnvFlag,
  resolveSupabaseEnv,
} from '../../../scripts/lib/script-env';

/**
 * Tests for the shared assertEnvFlag() guard + resolveSupabaseEnv().
 *
 * No real `.env` / DB: PROD_PROJECT_REF and the SUPABASE_* keys are stubbed on
 * process.env, and process.exit is mocked to throw a sentinel so we can assert
 * the exit path without killing the test runner.
 */

const PROD_REF = 'prodref123';

/** Sentinel thrown in place of process.exit so the call site short-circuits. */
class ProcessExit extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const ENV_KEYS = [
  'PROD_PROJECT_REF',
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
];

describe('script-env', () => {
  const saved: Record<string, string | undefined> = {};
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.PROD_PROJECT_REF = PROD_REF;

    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ProcessExit(code ?? 0);
    }) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe('assertEnvFlag', () => {
    it('is a no-op when env is not "prod"', () => {
      expect(() =>
        assertEnvFlag('', 'https://staging.example.co'),
      ).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('passes when env=prod and the URL contains PROD_PROJECT_REF', () => {
      expect(() =>
        assertEnvFlag('prod', `https://${PROD_REF}.supabase.co`),
      ).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('exits(1) when env=prod but the URL does not contain PROD_PROJECT_REF', () => {
      expect(() =>
        assertEnvFlag('prod', 'https://wrong-project.supabase.co'),
      ).toThrow(ProcessExit);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits(1) when env=prod and the URL is undefined', () => {
      expect(() => assertEnvFlag('prod', undefined)).toThrow(ProcessExit);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('weaves the script name into the remediation hint', () => {
      expect(() =>
        assertEnvFlag('prod', 'https://wrong.supabase.co', 'scripts/my-job.ts'),
      ).toThrow(ProcessExit);
      const printed = errorSpy.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .join('\n');
      expect(printed).toContain('scripts/my-job.ts');
    });
  });

  describe('resolveSupabaseEnv', () => {
    it('resolves url + key from SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY', () => {
      process.env.SUPABASE_URL = `https://${PROD_REF}.supabase.co`;
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';

      const result = resolveSupabaseEnv('', 'scripts/my-job.ts');

      expect(result).toEqual({
        url: `https://${PROD_REF}.supabase.co`,
        key: 'svc-key',
        env: '',
      });
    });

    it('falls back through the NEXT_PUBLIC_* url + publishable-key chain', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fallback.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'pub-key';

      const result = resolveSupabaseEnv();

      expect(result.url).toBe('https://fallback.supabase.co');
      expect(result.key).toBe('pub-key');
    });

    it('prefers the service-role key over the publishable keys', () => {
      process.env.SUPABASE_URL = 'https://x.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
      process.env.SUPABASE_PUBLISHABLE_KEY = 'pub';

      expect(resolveSupabaseEnv().key).toBe('svc');
    });

    it('exits(1) when the URL is missing', () => {
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';

      expect(() => resolveSupabaseEnv()).toThrow(ProcessExit);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits(1) when the key is missing', () => {
      process.env.SUPABASE_URL = 'https://x.supabase.co';

      expect(() => resolveSupabaseEnv()).toThrow(ProcessExit);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('applies the --env=prod guard against the resolved URL', () => {
      process.env.SUPABASE_URL = 'https://not-prod.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';

      // url does not contain PROD_REF → guard exits(1)
      expect(() => resolveSupabaseEnv('prod')).toThrow(ProcessExit);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
