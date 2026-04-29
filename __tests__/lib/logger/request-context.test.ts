/**
 * Tests for lib/logger/request-context.ts.
 *
 * Spec: docs/specs/structured-logging-spec.md §4.2 + §4.3 + §6 AC1 + §7.
 *
 * Covers two surfaces of `withRequestContext` (overloaded function — see
 * the module's TSDoc):
 *
 * 1. **Propagation primitives** (value-form):
 *    - getRequestContext() returns undefined outside a runWithRequestContext
 *    - context propagates across awaits
 *    - context propagates into nested helper calls (sync + async)
 *    - parallel runWithRequestContext calls are isolated (no leakage)
 *    - updateRequestContext mutates the in-flight scope only
 *    - withRequestContext(ctx, fn) value-form aliases runWithRequestContext
 *
 * 2. **Route-handler decorator** (decorator-form, post-WP1 fix-up consolidation):
 *    - Wraps a Response-returning handler and seeds an AsyncLocalStorage scope.
 *    - Reads `x-request-id` from the inbound request when present.
 *    - Mints a UUID v4 when the header is absent (test scaffolding path).
 *    - Forwards handler arguments (request, dynamic-params context) unchanged.
 *    - Echoes `x-request-id` on the outbound response.
 *    - Mirrors the request context onto the Sentry scope before the handler runs.
 *    - **Sentry context applied BEFORE handler body executes** (sync-throw safety).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sentryMocks = vi.hoisted(() => {
  const setTag = vi.fn();
  const setUser = vi.fn();
  const setLevel = vi.fn();
  const setContext = vi.fn();
  const scope = { setTag, setUser, setLevel, setContext };
  return {
    setTag,
    setUser,
    setLevel,
    setContext,
    scope,
    getCurrentScope: vi.fn(() => scope),
    captureException: vi.fn(),
    withScope: vi.fn((fn: (s: typeof scope) => void) => fn(scope)),
  };
});

vi.mock('@sentry/nextjs', () => ({
  getCurrentScope: sentryMocks.getCurrentScope,
  captureException: sentryMocks.captureException,
  withScope: sentryMocks.withScope,
}));

import { NextRequest, NextResponse } from 'next/server';
import {
  getRequestContext,
  runWithRequestContext,
  updateRequestContext,
  withRequestContext,
  withRequestContextBare,
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

const SUPPLIED_ID = '7d3f2a1e-4b6c-4f8a-9c1d-2e3f4a5b6c7d';

function makeRequest(opts: { headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(new URL('/api/test', 'http://localhost:3000'), {
    method: 'POST',
    headers: opts.headers ?? {},
  });
}

describe('lib/logger/request-context', () => {
  beforeEach(() => {
    sentryMocks.setTag.mockClear();
    sentryMocks.setUser.mockClear();
    sentryMocks.setLevel.mockClear();
    sentryMocks.setContext.mockClear();
    sentryMocks.captureException.mockClear();
  });

  // ---------------------------------------------------------------------------
  // Value-form: AsyncLocalStorage propagation primitives.
  // ---------------------------------------------------------------------------

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

  describe('withRequestContext value-form (ctx, fn)', () => {
    it('aliases runWithRequestContext when called with (ctx, fn)', () => {
      const ctx = fixtureCtx();
      const observed = withRequestContext(ctx, () => getRequestContext());
      expect(observed).toEqual(ctx);
    });

    it('forwards the function result through the value-form scope', () => {
      const result = withRequestContext(fixtureCtx(), () => 'value-form');
      expect(result).toBe('value-form');
    });
  });

  // ---------------------------------------------------------------------------
  // Decorator-form: route-handler wrapper (Phase 2 / post-WP1 consolidation).
  // ---------------------------------------------------------------------------

  describe('withRequestContext decorator-form (handler) — route wrapper', () => {
    it('seeds AsyncLocalStorage with the supplied x-request-id', async () => {
      let observed: string | undefined;
      const handler = withRequestContext(async () => {
        observed = getRequestContext()?.requestId;
        return NextResponse.json({ ok: true });
      });

      await handler(makeRequest({ headers: { 'x-request-id': SUPPLIED_ID } }));
      expect(observed).toBe(SUPPLIED_ID);
    });

    it('mints a fresh UUID when no x-request-id header is supplied', async () => {
      let observed: string | undefined;
      const handler = withRequestContext(async () => {
        observed = getRequestContext()?.requestId;
        return NextResponse.json({ ok: true });
      });

      await handler(makeRequest());
      expect(observed).toBeDefined();
      expect(observed).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('exposes route + method on the context', async () => {
      let observedRoute: string | undefined;
      let observedMethod: string | undefined;
      const handler = withRequestContext(async () => {
        const ctx = getRequestContext();
        observedRoute = ctx?.route;
        observedMethod = ctx?.method;
        return NextResponse.json({ ok: true });
      });

      await handler(makeRequest());
      expect(observedRoute).toBe('/api/test');
      expect(observedMethod).toBe('POST');
    });

    it('forwards Next.js dynamic-route params to the handler', async () => {
      const handler = withRequestContext(
        async (
          _req: NextRequest,
          ctx: { params: Promise<{ id: string }> },
        ) => {
          const { id } = await ctx.params;
          return NextResponse.json({ id });
        },
      );

      const res = await handler(makeRequest(), {
        params: Promise.resolve({ id: 'item-123' }),
      });
      const body = (await res.json()) as { id: string };
      expect(body.id).toBe('item-123');
    });

    it('echoes the request id on the outbound response', async () => {
      const handler = withRequestContext(async () =>
        NextResponse.json({ ok: true }),
      );
      const res = await handler(
        makeRequest({ headers: { 'x-request-id': SUPPLIED_ID } }),
      );
      expect(res.headers.get('x-request-id')).toBe(SUPPLIED_ID);
    });

    it('mirrors requestId + route + method onto the Sentry scope', async () => {
      const handler = withRequestContext(async () =>
        NextResponse.json({ ok: true }),
      );
      await handler(makeRequest({ headers: { 'x-request-id': SUPPLIED_ID } }));

      const calls = sentryMocks.setTag.mock.calls.map(([k, v]) => `${k}=${v}`);
      expect(calls).toContain(`requestId=${SUPPLIED_ID}`);
      expect(calls).toContain('route=/api/test');
      expect(calls).toContain('method=POST');
    });

    it('rejects malformed x-request-id and mints fresh UUID', async () => {
      let observed: string | undefined;
      const handler = withRequestContext(async () => {
        observed = getRequestContext()?.requestId;
        return NextResponse.json({ ok: true });
      });
      await handler(makeRequest({ headers: { 'x-request-id': 'not-a-uuid' } }));
      expect(observed).toBeDefined();
      expect(observed).not.toBe('not-a-uuid');
      expect(observed).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    // F3 — verifier ordering test (post-WP1 fix-up).
    //
    // Earlier tests verify `setTag('requestId', …)` is called at SOME point
    // during the request lifecycle. They do NOT verify it runs BEFORE the
    // handler body. A handler that throws synchronously on its first line
    // would otherwise produce a Sentry event with no requestId tag if
    // ordering broke. This test pins the invariant via call-list index
    // comparison.
    it('applies Sentry context BEFORE handler body executes (sync-throw safety)', async () => {
      const callOrder: string[] = [];
      sentryMocks.setTag.mockImplementation((key: string, value: string) => {
        callOrder.push(`setTag:${key}=${value}`);
      });

      const handler = withRequestContext(() => {
        callOrder.push('handler-entry');
        throw new Error('synchronous throw');
      });

      await expect(
        handler(makeRequest({ headers: { 'x-request-id': SUPPLIED_ID } })),
      ).rejects.toThrow('synchronous throw');

      // Sentry tag MUST appear before handler entry in the call ordering.
      const tagIdx = callOrder.findIndex((c) =>
        c.startsWith(`setTag:requestId=`),
      );
      const handlerIdx = callOrder.findIndex((c) => c === 'handler-entry');
      expect(tagIdx).toBeGreaterThan(-1);
      expect(handlerIdx).toBeGreaterThan(-1);
      expect(tagIdx).toBeLessThan(handlerIdx);
    });
  });

  describe('withRequestContextBare — bodyless-handler wrapper', () => {
    it('wraps a parameterless handler (DELETE/recalculate-all style)', async () => {
      const handler = withRequestContextBare(async () =>
        NextResponse.json({ ok: true }),
      );
      const res = await handler();
      expect(res.status).toBe(200);
      // No request → mints a fresh UUID; assert format only.
      expect(res.headers.get('x-request-id')).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('seeds an AsyncLocalStorage scope for the bare handler', async () => {
      let observedRequestId: string | undefined;
      const handler = withRequestContextBare(async () => {
        observedRequestId = getRequestContext()?.requestId;
        return NextResponse.json({ ok: true });
      });
      await handler();
      expect(observedRequestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });
});
