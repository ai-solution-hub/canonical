/**
 * Tests for `lib/error.ts` — `safeErrorMessage` is the chokepoint
 * through which 168 callers route API error messages.
 *
 * Spec: docs/specs/structured-logging-spec.md §4.5 (rewrite to delegate
 * to logger.error).
 *
 * Behaviour-preserving rewrite contract: signature unchanged, return
 * string unchanged. The implementation captures errors to Sentry
 * directly (universal SDK from `@sentry/nextjs` — works in both client
 * and server bundles). Server routes that want full structured logging
 * import `logger` from `@/lib/logger` directly inside their catch arm
 * (Phase 2 migration); safeErrorMessage is the cross-runtime LCD.
 *
 * Tests assert:
 *  1. Production-mode return value = fallback only.
 *  2. Development-mode return value = "<fallback>: <err.message>" for
 *     `Error` instances.
 *  3. Non-Error inputs in dev still return the bare fallback.
 *  4. Undefined NODE_ENV behaves like non-development.
 *  5. Sentry capture fires for both Error and non-Error throwables.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sentryMocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  getCurrentScope: vi.fn(() => ({
    setTag: vi.fn(),
    setUser: vi.fn(),
    setLevel: vi.fn(),
    setContext: vi.fn(),
  })),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: sentryMocks.captureException,
  getCurrentScope: sentryMocks.getCurrentScope,
}));

import { safeErrorMessage } from '@/lib/error';

beforeEach(() => {
  sentryMocks.captureException.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('safeErrorMessage', () => {
  it('returns just the fallback in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const result = safeErrorMessage(
      new Error('secret details'),
      'Something went wrong',
    );
    expect(result).toBe('Something went wrong');
  });

  it('includes the error message in development for Error instances', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const result = safeErrorMessage(new Error('db timeout'), 'Failed to load');
    expect(result).toBe('Failed to load: db timeout');
  });

  it('returns just the fallback in development for non-Error objects', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const result = safeErrorMessage('a plain string error', 'Operation failed');
    expect(result).toBe('Operation failed');
  });

  it('returns just the fallback when NODE_ENV is undefined (non-development)', () => {
    vi.stubEnv('NODE_ENV', '');
    const result = safeErrorMessage(new Error('oops'), 'Server error');
    expect(result).toBe('Server error');
  });

  it('forwards Error instances to Sentry directly (chokepoint capture)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const err = new Error('kaboom');
    safeErrorMessage(err, 'Request failed');
    expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
    expect(sentryMocks.captureException.mock.calls[0][0]).toBe(err);
  });

  it('forwards non-Error throwables (synthesised Error with the fallback msg)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const err = { code: 42 };
    safeErrorMessage(err, 'Unexpected error');
    expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
    const captured = sentryMocks.captureException.mock.calls[0][0];
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe('Unexpected error');
  });
});
