/**
 * Tests for lib/api/define-route.ts — the typed Zod-backed PASS-THROUGH
 * validator (Option-4 contract).
 *
 * Spec:
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/PRODUCT.md §8.0 — INV-PT
 *     (pass-through) and INV-FP (fail-open-prod / loud-dev+CI+test).
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/TECH.md §2.4a — the
 *     governing pass-through contract (supersedes the S11 payload-returning
 *     contract); §2.4a.2 the isLoud/isProd failure policy.
 *
 * Acceptance per task-list.json Subtask ID-32.25 testStrategy:
 *   - INV-PT: a handler returning `NextResponse.json({error},{status:401})`
 *     yields that exact 401 unchanged (not a re-wrapped 200, not a 500); a
 *     matching 2xx JSON body passes through unchanged; a 3xx redirect, a 204,
 *     and a `text/event-stream` response each pass through with status +
 *     headers intact and NO schema parse attempted.
 *   - INV-FP: an identical drifting 2xx JSON body throws under
 *     `NODE_ENV=test` (loud) and returns the original response + logs the
 *     drift under `NODE_ENV=production` (fail-open).
 *
 * These tests assert the wire-level behaviour of the wrapper (status, headers,
 * body, throw-vs-return), never the wrapper's internal structure — per
 * docs/reference/test-philosophy.md (test real behaviour, not implementation).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { defineRoute } from '@/lib/api/define-route';
import { logger } from '@/lib/logger';

function makeRequest(): NextRequest {
  return new NextRequest(new URL('/api/test', 'http://localhost:3000'), {
    method: 'GET',
  });
}

/** Force the LOUD-test environment regardless of the ambient CI flag. */
function setLoudTestEnv(): void {
  vi.stubEnv('NODE_ENV', 'test');
  // Clear CI so the LOUD path is driven by NODE_ENV !== 'production', not the
  // ambient CI flag — keeps the loud-vs-fail-open split unambiguous.
  vi.stubEnv('CI', '');
}

/** Force the production fail-open environment (production AND not CI). */
function setProdEnv(): void {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CI', '');
}

afterEach(() => {
  // `vi.unstubAllEnvs` restores NODE_ENV / CI to their pre-stub values.
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('defineRoute — Response detection', () => {
  it('NextResponse is an instanceof Response (the detection predicate)', () => {
    // The wrapper branches on `instanceof Response`; NextResponse extends the
    // WHATWG Response, so this MUST hold for the pass-through path to fire.
    const res = NextResponse.json({ ok: true });
    expect(res instanceof Response).toBe(true);
  });
});

describe('defineRoute — INV-PT pass-through (handler returns a Response)', () => {
  beforeEach(() => {
    setLoudTestEnv();
  });

  it('passes a 2xx JSON body that matches the schema through unchanged', async () => {
    const Schema = z.object({ items: z.array(z.string()), total: z.number() });
    const payload = { items: ['alpha', 'beta'], total: 2 };

    const route = defineRoute(Schema, async () =>
      NextResponse.json(payload, { status: 200 }),
    );
    const response = await route(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(payload);
  });

  it('passes a 401 error envelope through UNCHANGED (not re-wrapped to 200, not a 500)', async () => {
    // The majority real-world path: handler short-circuits with an inline
    // NextResponse error. Under INV-PT the wrapper is transparent — no parse,
    // no re-wrap.
    const Schema = z.object({ items: z.array(z.string()) });
    const route = defineRoute(Schema, async () =>
      NextResponse.json({ error: 'unauthorised' }, { status: 401 }),
    );

    const response = await route(makeRequest());
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: 'unauthorised' });
  });

  it('passes a 500 error envelope through unchanged (no schema parse)', async () => {
    const Schema = z.object({ items: z.array(z.string()) });
    const route = defineRoute(Schema, async () =>
      NextResponse.json({ error: 'boom' }, { status: 500 }),
    );

    const response = await route(makeRequest());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'boom' });
  });

  it('passes a 3xx redirect through with status + Location intact (no schema parse)', async () => {
    const Schema = z.object({ items: z.array(z.string()) });
    const route = defineRoute(Schema, async () =>
      NextResponse.redirect(new URL('http://localhost:3000/login'), 307),
    );

    const response = await route(makeRequest());
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/login',
    );
  });

  it('passes a 204 No Content response through unchanged (no schema parse)', async () => {
    const Schema = z.object({ items: z.array(z.string()) });
    const route = defineRoute(
      Schema,
      async () => new NextResponse(null, { status: 204 }),
    );

    const response = await route(makeRequest());
    expect(response.status).toBe(204);
  });

  it('passes a text/event-stream response through unchanged (no schema parse)', async () => {
    const Schema = z.object({ items: z.array(z.string()) });
    const route = defineRoute(
      Schema,
      async () =>
        new NextResponse('data: hello\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    );

    const response = await route(makeRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    // The wrapper must NOT have consumed/parsed the stream body.
    expect(await response.text()).toBe('data: hello\n\n');
  });

  it('passes a non-JSON 2xx response (text/plain) through unchanged (no schema parse)', async () => {
    const Schema = z.object({ items: z.array(z.string()) });
    const route = defineRoute(
      Schema,
      async () =>
        new NextResponse('plain text body', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
    );

    const response = await route(makeRequest());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('plain text body');
  });

  it('does NOT parse a 2xx JSON body that fails the schema when status/ct disqualify it — but DOES validate a genuine 2xx application/json', async () => {
    // Negative control: a 4xx with a drifting JSON body must pass through, not
    // throw — only 2xx JSON is validated.
    const Schema = z.object({ count: z.number() });
    const route = defineRoute(Schema, async () =>
      NextResponse.json({ count: 'not-a-number' }, { status: 422 }),
    );

    const response = await route(makeRequest());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ count: 'not-a-number' });
  });
});

describe('defineRoute — raw (non-Response) payload arm', () => {
  beforeEach(() => {
    setLoudTestEnv();
  });

  it('validates a raw payload and JSON-wraps it on success (200)', async () => {
    const Schema = z.object({ id: z.string() });
    const route = defineRoute(Schema, async () => ({ id: 'abc' }));

    const response = await route(makeRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'abc' });
  });

  it('strips additive wire fields per zod-4 default z.object semantics', async () => {
    // zod-4 default z.object STRIPS unknown keys (TECH §12 behaviour-confirmed).
    const Schema = z.object({ id: z.string() });
    const route = defineRoute(
      Schema,
      async () =>
        ({ id: 'abc', extra: 'stripped' }) as unknown as z.infer<typeof Schema>,
    );

    const response = await route(makeRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'abc' });
  });

  it('invokes the handler with the request and ctx tuple', async () => {
    const Schema = z.object({ id: z.string() });
    let observedRequest: NextRequest | undefined;
    let observedCtx: unknown;

    const route = defineRoute(Schema, async (request, ctx) => {
      observedRequest = request;
      observedCtx = ctx;
      return { id: 'abc' };
    });

    const request = makeRequest();
    const ctx = { params: Promise.resolve({ id: 'abc' }) };
    await route(request, ctx);

    expect(observedRequest).toBe(request);
    expect(observedCtx).toBe(ctx);
  });
});

describe('defineRoute — INV-FP failure policy (drifting 2xx JSON body)', () => {
  const Schema = z.object({ items: z.array(z.string()), total: z.number() });
  const driftingPayload = { items: ['x'], total: 'not-a-number' };

  it('LOUD under NODE_ENV=test: throws on a drifting 2xx JSON body (Response arm)', async () => {
    setLoudTestEnv();
    const route = defineRoute(Schema, async () =>
      NextResponse.json(driftingPayload, { status: 200 }),
    );

    await expect(route(makeRequest())).rejects.toThrow();
  });

  it('LOUD under NODE_ENV=test: throws on a drifting raw payload (raw arm)', async () => {
    setLoudTestEnv();
    const route = defineRoute(
      Schema,
      async () => driftingPayload as unknown as z.infer<typeof Schema>,
    );

    await expect(route(makeRequest())).rejects.toThrow();
  });

  it('LOUD when CI is set even under NODE_ENV=production (CI runner must fail loud)', async () => {
    // INV-FP: LOUD when NODE_ENV !== 'production' OR process.env.CI is set.
    // A CI runner with NODE_ENV=production + CI=true must still throw.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CI', 'true');
    const route = defineRoute(Schema, async () =>
      NextResponse.json(driftingPayload, { status: 200 }),
    );

    await expect(route(makeRequest())).rejects.toThrow();
  });

  it('FAIL-OPEN under NODE_ENV=production (not CI): returns the ORIGINAL response unchanged', async () => {
    setProdEnv();
    // Silence the real fail-open logger.error during the prod path; the
    // logging assertion lives in the sibling test below.
    vi.spyOn(logger, 'error').mockImplementation(() => {});

    const original = NextResponse.json(driftingPayload, { status: 200 });
    const route = defineRoute(Schema, async () => original);

    const response = await route(makeRequest());
    // The original, unmodified response is returned — same status and body.
    expect(response).toBe(original);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(driftingPayload);
  });

  it('FAIL-OPEN under NODE_ENV=production: logs the drift via the canonical logger', async () => {
    setProdEnv();
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    const route = defineRoute(Schema, async () =>
      NextResponse.json(driftingPayload, { status: 200 }),
    );
    await route(makeRequest());

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [ctx, msg] = errorSpy.mock.calls[0];
    expect(ctx).toMatchObject({ route: expect.any(String) });
    expect((ctx as { issues: unknown }).issues).toBeDefined();
    expect(Array.isArray((ctx as { issues: unknown[] }).issues)).toBe(true);
    expect(String(msg)).toContain('response_schema_validation_failed');
  });

  it('FAIL-OPEN under NODE_ENV=production (raw arm): returns NextResponse.json(payload) + logs', async () => {
    setProdEnv();
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    const route = defineRoute(
      Schema,
      async () => driftingPayload as unknown as z.infer<typeof Schema>,
    );

    const response = await route(makeRequest());
    expect(response.status).toBe(200);
    // Fail-open raw arm serialises the original (un-validated) payload.
    expect(await response.json()).toEqual(driftingPayload);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
