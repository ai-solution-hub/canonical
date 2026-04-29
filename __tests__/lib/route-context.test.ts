/**
 * Tests for lib/route-context.ts — Phase 2 route-handler decorator.
 *
 * Spec: docs/specs/structured-logging-spec.md §4.3 + §6 AC1.
 *
 * The decorator form (`withRequestContext(handler)`) is distinct from the
 * value-form helper at `@/lib/logger` (which has the shape
 * `withRequestContext(ctx, fn)` and is consumed by the proxy). This file
 * covers the route-wrapper form only.
 *
 * Covers:
 * - Wraps a Response-returning handler and seeds an AsyncLocalStorage scope.
 * - Reads `x-request-id` from the inbound request when present.
 * - Mints a UUID v4 when the header is absent (test scaffolding path).
 * - Forwards handler arguments (request, dynamic-params context) unchanged.
 * - Echoes `x-request-id` on the outbound response.
 * - Mirrors the request context onto the Sentry scope before the handler runs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { withRequestContext } from '@/lib/route-context';
import { getRequestContext } from '@/lib/logger/request-context';

const sentrySetTag = vi.fn();
const sentrySetUser = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  getCurrentScope: () => ({
    setTag: sentrySetTag,
    setUser: sentrySetUser,
    setContext: vi.fn(),
    setLevel: vi.fn(),
  }),
  captureException: vi.fn(),
  withScope: (fn: (s: unknown) => void) =>
    fn({
      setTag: sentrySetTag,
      setUser: sentrySetUser,
      setContext: vi.fn(),
      setLevel: vi.fn(),
    }),
}));

const SUPPLIED_ID = '7d3f2a1e-4b6c-4f8a-9c1d-2e3f4a5b6c7d';

function makeRequest(opts: { headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(new URL('/api/test', 'http://localhost:3000'), {
    method: 'POST',
    headers: opts.headers ?? {},
  });
}

describe('lib/route-context — withRequestContext route decorator', () => {
  beforeEach(() => {
    sentrySetTag.mockClear();
    sentrySetUser.mockClear();
  });

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

    const calls = sentrySetTag.mock.calls.map(([k, v]) => `${k}=${v}`);
    expect(calls).toContain(`requestId=${SUPPLIED_ID}`);
    expect(calls).toContain('route=/api/test');
    expect(calls).toContain('method=POST');
  });

  it('handles parameterless handlers (DELETE/recalculate-all style)', async () => {
    const handler = withRequestContext(async () =>
      NextResponse.json({ ok: true }),
    );
    const res = await handler(makeRequest({ headers: { 'x-request-id': SUPPLIED_ID } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe(SUPPLIED_ID);
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
});
