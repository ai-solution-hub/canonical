/**
 * Tests for lib/logger/sentry-bridge.ts.
 *
 * Spec: docs/specs/structured-logging-spec.md §4.4 + §10 decision 1.
 *
 * Covers:
 * - applyRequestContextToSentry sets requestId/route/method tags + user
 * - applyRequestContextToSentry no-ops when no context is in scope
 * - captureForLevel forwards warn/error/fatal to Sentry
 * - captureForLevel ignores info/debug/trace
 * - captureForLevel passes the original Error when present
 * - captureForLevel synthesises an Error from msg when err is missing
 * - Sentry SDK exceptions are swallowed (logger never breaks the request)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sentryMocks = vi.hoisted(() => {
  const setTag = vi.fn();
  const setUser = vi.fn();
  const setLevel = vi.fn();
  const setContext = vi.fn();
  const scope = { setTag, setUser, setLevel, setContext };
  const getCurrentScope = vi.fn(() => scope);
  const captureException = vi.fn();
  return {
    setTag,
    setUser,
    setLevel,
    setContext,
    scope,
    getCurrentScope,
    captureException,
  };
});

vi.mock('@sentry/nextjs', () => ({
  getCurrentScope: sentryMocks.getCurrentScope,
  captureException: sentryMocks.captureException,
}));

import { runWithRequestContext } from '@/lib/logger/request-context';
import {
  applyRequestContextToSentry,
  captureForLevel,
} from '@/lib/logger/sentry-bridge';
import type { RequestContext } from '@/lib/logger/types';

function fixtureCtx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: '7d3f2a1e-4b6c-4f8a-9c1d-2e3f4a5b6c7d',
    route: '/api/items',
    method: 'POST',
    startedAt: 1700000000000,
    ...overrides,
  };
}

describe('lib/logger/sentry-bridge', () => {
  beforeEach(() => {
    sentryMocks.setTag.mockReset();
    sentryMocks.setUser.mockReset();
    sentryMocks.setLevel.mockReset();
    sentryMocks.setContext.mockReset();
    sentryMocks.getCurrentScope.mockClear();
    sentryMocks.captureException.mockReset();
  });

  describe('applyRequestContextToSentry', () => {
    it('sets requestId/route/method tags + user when context is present', () => {
      runWithRequestContext(
        fixtureCtx({
          userId: 'aaaaaaaa-1111-4111-a111-111111111111',
          userRole: 'editor',
        }),
        () => {
          applyRequestContextToSentry();
        },
      );
      expect(sentryMocks.setTag).toHaveBeenCalledWith(
        'requestId',
        '7d3f2a1e-4b6c-4f8a-9c1d-2e3f4a5b6c7d',
      );
      expect(sentryMocks.setTag).toHaveBeenCalledWith('route', '/api/items');
      expect(sentryMocks.setTag).toHaveBeenCalledWith('method', 'POST');
      expect(sentryMocks.setTag).toHaveBeenCalledWith('userRole', 'editor');
      expect(sentryMocks.setUser).toHaveBeenCalledWith({
        id: 'aaaaaaaa-1111-4111-a111-111111111111',
      });
    });

    it('omits setUser when no userId is on context', () => {
      runWithRequestContext(fixtureCtx(), () => {
        applyRequestContextToSentry();
      });
      expect(sentryMocks.setUser).not.toHaveBeenCalled();
    });

    it('no-ops when called outside a request scope', () => {
      applyRequestContextToSentry();
      expect(sentryMocks.setTag).not.toHaveBeenCalled();
      expect(sentryMocks.setUser).not.toHaveBeenCalled();
    });

    it('swallows errors thrown by the Sentry SDK', () => {
      sentryMocks.getCurrentScope.mockImplementationOnce(() => {
        throw new Error('sentry exploded');
      });
      runWithRequestContext(fixtureCtx(), () => {
        // Must not throw — logger guarantees never breaking the request.
        expect(() => applyRequestContextToSentry()).not.toThrow();
      });
    });
  });

  describe('captureForLevel', () => {
    it('captures error level in Sentry with the supplied Error instance', () => {
      const err = new Error('boom');
      runWithRequestContext(fixtureCtx(), () => {
        captureForLevel('error', { err }, 'something failed');
      });
      expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
      const [payload, scopeFn] = sentryMocks.captureException.mock.calls[0];
      expect(payload).toBe(err);
      expect(typeof scopeFn).toBe('function');
      // Run the scope callback to assert level + context wiring.
      scopeFn(sentryMocks.scope);
      expect(sentryMocks.setLevel).toHaveBeenCalledWith('error');
    });

    it('captures warn level in Sentry tagged as warning (per spec §10 decision 1)', () => {
      const err = new Error('soft fail');
      runWithRequestContext(fixtureCtx(), () => {
        captureForLevel(
          'warn',
          { err, op: 'classify.fallback' },
          'fallback path',
        );
      });
      expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
      const scopeFn = sentryMocks.captureException.mock.calls[0][1];
      scopeFn(sentryMocks.scope);
      expect(sentryMocks.setLevel).toHaveBeenCalledWith('warning');
      expect(sentryMocks.setContext).toHaveBeenCalledWith(
        'logger',
        expect.objectContaining({ op: 'classify.fallback' }),
      );
    });

    it('captures fatal level in Sentry tagged as fatal', () => {
      const err = new Error('process unrecoverable');
      runWithRequestContext(fixtureCtx(), () => {
        captureForLevel('fatal', { err }, 'unrecoverable');
      });
      const scopeFn = sentryMocks.captureException.mock.calls[0][1];
      scopeFn(sentryMocks.scope);
      expect(sentryMocks.setLevel).toHaveBeenCalledWith('fatal');
    });

    it('ignores info / debug / trace levels', () => {
      runWithRequestContext(fixtureCtx(), () => {
        captureForLevel('info', { msg: 'just info' }, 'an info line');
        captureForLevel('debug', { foo: 'bar' }, 'debug line');
        captureForLevel('trace', undefined, 'trace line');
      });
      expect(sentryMocks.captureException).not.toHaveBeenCalled();
    });

    it('synthesises an Error from msg when no err is supplied', () => {
      runWithRequestContext(fixtureCtx(), () => {
        captureForLevel('error', { op: 'noop' }, 'something went wrong');
      });
      expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
      const [payload] = sentryMocks.captureException.mock.calls[0];
      expect(payload).toBeInstanceOf(Error);
      expect((payload as Error).message).toBe('something went wrong');
    });

    it('strips err/error/exception fields from the Sentry context payload', () => {
      const err = new Error('do not leak the raw err');
      runWithRequestContext(fixtureCtx(), () => {
        captureForLevel(
          'error',
          { err, op: 'embed.generate', userId: 'should-be-kept' },
          'failed',
        );
      });
      const scopeFn = sentryMocks.captureException.mock.calls[0][1];
      scopeFn(sentryMocks.scope);
      expect(sentryMocks.setContext).toHaveBeenCalledWith(
        'logger',
        expect.not.objectContaining({ err: expect.anything() }),
      );
      expect(sentryMocks.setContext).toHaveBeenCalledWith(
        'logger',
        expect.objectContaining({
          op: 'embed.generate',
          userId: 'should-be-kept',
        }),
      );
    });

    it('tags the captured event with request context when present', () => {
      const err = new Error('with scope');
      runWithRequestContext(fixtureCtx(), () => {
        captureForLevel('error', { err }, 'msg');
      });
      // applyRequestContextToSentry should fire before captureException.
      expect(sentryMocks.setTag).toHaveBeenCalledWith(
        'requestId',
        '7d3f2a1e-4b6c-4f8a-9c1d-2e3f4a5b6c7d',
      );
      expect(sentryMocks.setTag).toHaveBeenCalledWith('route', '/api/items');
      expect(sentryMocks.setTag).toHaveBeenCalledWith('method', 'POST');
    });

    it('swallows Sentry SDK errors so the logger never breaks the request', () => {
      sentryMocks.captureException.mockImplementationOnce(() => {
        throw new Error('sentry network down');
      });
      runWithRequestContext(fixtureCtx(), () => {
        expect(() =>
          captureForLevel('error', { err: new Error('inner') }, 'msg'),
        ).not.toThrow();
      });
    });
  });
});
