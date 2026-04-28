/**
 * Tests for the root `proxy.ts` request-ID minting + scope establishment.
 *
 * Spec: docs/specs/structured-logging-spec.md §4.3 (where context is
 * established) + §6 AC 5 (Sentry events grouped by requestId tag).
 *
 * Covers:
 *  - Mints a UUID and forwards it on the REQUEST `x-request-id` header.
 *  - Echoes the same UUID back on the RESPONSE `x-request-id` header.
 *  - Honours an upstream-supplied `x-request-id` (UUID-shaped only).
 *  - Rejects malformed/non-UUID supplied IDs and mints a fresh one.
 *  - Establishes an AsyncLocalStorage scope so log lines emitted from
 *    inside the proxy body carry the requestId.
 *  - Redirect responses (unauthenticated users) carry the same header.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: supabaseMocks.createServerClient,
}));

vi.mock('@/lib/routes', () => ({
  PUBLIC_ROUTES: ['/login', '/signup', '/api/_health'],
}));

import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { getRequestContext } from '@/lib/logger';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function buildRequest(
  url: string,
  init: { headers?: Record<string, string>; method?: string } = {},
): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    headers: new Headers(init.headers ?? {}),
    method: init.method ?? 'GET',
  });
}

beforeEach(() => {
  supabaseMocks.getUser.mockReset();
  supabaseMocks.createServerClient.mockReset();
  // Default: unauthenticated user. Tests that need an authenticated path
  // override this in their setup block.
  supabaseMocks.getUser.mockResolvedValue({
    data: { user: { id: 'user-fixture' } },
    error: null,
  });
  supabaseMocks.createServerClient.mockImplementation(() => ({
    auth: { getUser: supabaseMocks.getUser },
  }));
});

describe('proxy.ts request-ID minting', () => {
  it('mints a UUID and stamps it on the REQUEST headers', async () => {
    const req = buildRequest('/some/page');
    await proxy(req);
    const stamped = req.headers.get('x-request-id');
    expect(stamped).toMatch(UUID_RE);
  });

  it('echoes the request ID on the RESPONSE headers', async () => {
    const req = buildRequest('/some/page');
    const res = await proxy(req);
    const stamped = req.headers.get('x-request-id');
    expect(res.headers.get('x-request-id')).toBe(stamped);
  });

  it('honours an upstream-supplied UUID-shaped x-request-id', async () => {
    const supplied = '7d3f2a1e-4b6c-4f8a-9c1d-2e3f4a5b6c7d';
    const req = buildRequest('/some/page', {
      headers: { 'x-request-id': supplied },
    });
    const res = await proxy(req);
    expect(res.headers.get('x-request-id')).toBe(supplied);
    expect(req.headers.get('x-request-id')).toBe(supplied);
  });

  it('mints a fresh UUID when the supplied header is malformed', async () => {
    const req = buildRequest('/some/page', {
      headers: { 'x-request-id': 'not-a-uuid' },
    });
    const res = await proxy(req);
    const stamped = res.headers.get('x-request-id');
    expect(stamped).not.toBe('not-a-uuid');
    expect(stamped).toMatch(UUID_RE);
  });

  it('mints a unique UUID per request', async () => {
    const reqA = buildRequest('/a');
    const reqB = buildRequest('/b');
    await proxy(reqA);
    await proxy(reqB);
    expect(reqA.headers.get('x-request-id')).not.toBe(
      reqB.headers.get('x-request-id'),
    );
  });
});

describe('proxy.ts AsyncLocalStorage scope', () => {
  it('establishes a request scope visible inside the proxy body', async () => {
    let observedRequestId: string | undefined;
    let observedRoute: string | undefined;
    let observedMethod: string | undefined;
    supabaseMocks.getUser.mockImplementationOnce(async () => {
      const ctx = getRequestContext();
      observedRequestId = ctx?.requestId;
      observedRoute = ctx?.route;
      observedMethod = ctx?.method;
      return {
        data: { user: { id: 'user-fixture' } },
        error: null,
      };
    });
    const req = buildRequest('/api/items', { method: 'POST' });
    await proxy(req);
    expect(observedRequestId).toMatch(UUID_RE);
    expect(observedRoute).toBe('/api/items');
    expect(observedMethod).toBe('POST');
  });

  it('does not leak request scope outside the proxy', async () => {
    expect(getRequestContext()).toBeUndefined();
    const req = buildRequest('/some/page');
    await proxy(req);
    expect(getRequestContext()).toBeUndefined();
  });
});

describe('proxy.ts redirect responses still carry the request ID', () => {
  it('login redirect for unauthenticated user keeps x-request-id header', async () => {
    supabaseMocks.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });
    const req = buildRequest('/some/private/page');
    const res = await proxy(req);
    // 307/308 redirect to /login — `Location` header is set; `x-request-id`
    // must still be present so the caller can correlate.
    expect(res.headers.get('x-request-id')).toMatch(UUID_RE);
    expect(res.headers.get('x-request-id')).toBe(
      req.headers.get('x-request-id'),
    );
  });
});
