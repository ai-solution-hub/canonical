/**
 * Tests for lib/logger/request-context.ts.
 *
 * Spec: docs/specs/structured-logging-spec.md §4.2 + §7.
 *
 * Covers:
 * - getRequestContext() returns undefined outside a runWithRequestContext
 * - context propagates across awaits
 * - context propagates into nested helper calls (sync + async)
 * - parallel runWithRequestContext calls are isolated (no leakage)
 * - updateRequestContext mutates the in-flight scope only
 */

import { describe, it, expect } from 'vitest';
import {
  getRequestContext,
  runWithRequestContext,
  updateRequestContext,
  withRequestContext,
} from '@/lib/logger/request-context';
import type { RequestContext } from '@/lib/logger/types';

function fixtureCtx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: '7d3f2a1e-4b6c-4f8a-9c1d-2e3f4a5b6c7d',
    route: '/api/test',
    method: 'GET',
    startedAt: 1700000000000,
    ...overrides,
  };
}

describe('lib/logger/request-context', () => {
  describe('getRequestContext', () => {
    it('returns undefined when called outside a runWithRequestContext scope', () => {
      expect(getRequestContext()).toBeUndefined();
    });

    it('returns the active context inside a runWithRequestContext scope', () => {
      const ctx = fixtureCtx();
      runWithRequestContext(ctx, () => {
        expect(getRequestContext()).toEqual(ctx);
      });
    });
  });

  describe('runWithRequestContext propagation', () => {
    it('propagates across awaits', async () => {
      const ctx = fixtureCtx();
      const observed = await runWithRequestContext(ctx, async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
        return getRequestContext();
      });
      expect(observed).toEqual(ctx);
    });

    it('propagates into nested helper calls', () => {
      const ctx = fixtureCtx({ route: '/api/nested' });
      function helperA() {
        return helperB();
      }
      function helperB() {
        return getRequestContext()?.route;
      }
      const observed = runWithRequestContext(ctx, () => helperA());
      expect(observed).toBe('/api/nested');
    });

    it('returns undefined again after the scope exits', () => {
      const ctx = fixtureCtx();
      runWithRequestContext(ctx, () => {
        expect(getRequestContext()?.requestId).toBe(ctx.requestId);
      });
      expect(getRequestContext()).toBeUndefined();
    });

    it('isolates parallel scopes — no cross-leakage', async () => {
      const ctxA = fixtureCtx({
        requestId: 'aaaaaaaa-1111-4111-a111-111111111111',
      });
      const ctxB = fixtureCtx({
        requestId: 'bbbbbbbb-2222-4222-b222-222222222222',
      });

      const [resultA, resultB] = await Promise.all([
        runWithRequestContext(ctxA, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return getRequestContext()?.requestId;
        }),
        runWithRequestContext(ctxB, async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return getRequestContext()?.requestId;
        }),
      ]);

      expect(resultA).toBe('aaaaaaaa-1111-4111-a111-111111111111');
      expect(resultB).toBe('bbbbbbbb-2222-4222-b222-222222222222');
    });

    it('returns the function result through the scope', () => {
      const result = runWithRequestContext(fixtureCtx(), () => 42);
      expect(result).toBe(42);
    });

    it('forwards async function results unchanged', async () => {
      const result = await runWithRequestContext(
        fixtureCtx(),
        async () => 'hello',
      );
      expect(result).toBe('hello');
    });
  });

  describe('updateRequestContext', () => {
    it('mutates userId on the in-flight scope', () => {
      const ctx = fixtureCtx();
      runWithRequestContext(ctx, () => {
        expect(getRequestContext()?.userId).toBeUndefined();
        updateRequestContext({
          userId: 'cccccccc-3333-4333-c333-333333333333',
          userRole: 'admin',
        });
        expect(getRequestContext()?.userId).toBe(
          'cccccccc-3333-4333-c333-333333333333',
        );
        expect(getRequestContext()?.userRole).toBe('admin');
      });
    });

    it('is a no-op outside a scope', () => {
      // Must not throw
      expect(() => updateRequestContext({ userId: 'no-scope' })).not.toThrow();
      expect(getRequestContext()).toBeUndefined();
    });

    it('does not bleed userId mutations across parallel scopes', async () => {
      const ctxA = fixtureCtx({
        requestId: 'dddddddd-4444-4444-d444-444444444444',
      });
      const ctxB = fixtureCtx({
        requestId: 'eeeeeeee-5555-4555-e555-555555555555',
      });

      const [a, b] = await Promise.all([
        runWithRequestContext(ctxA, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          updateRequestContext({ userId: 'user-a' });
          await new Promise((resolve) => setTimeout(resolve, 5));
          return getRequestContext()?.userId;
        }),
        runWithRequestContext(ctxB, async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          updateRequestContext({ userId: 'user-b' });
          await new Promise((resolve) => setTimeout(resolve, 5));
          return getRequestContext()?.userId;
        }),
      ]);

      expect(a).toBe('user-a');
      expect(b).toBe('user-b');
    });
  });

  describe('withRequestContext', () => {
    it('aliases runWithRequestContext for now (Phase 1 surface)', () => {
      const ctx = fixtureCtx();
      const observed = withRequestContext(ctx, () => getRequestContext());
      expect(observed).toEqual(ctx);
    });
  });
});
