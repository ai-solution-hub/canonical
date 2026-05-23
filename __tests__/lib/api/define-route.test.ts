/**
 * Tests for lib/api/define-route.ts — the typed Zod-backed wrapper.
 *
 * Spec: docs/specs/ast-dataflow-tool/ops-t1-codemod/PRODUCT.md §1
 * (defineRoute symmetry contract); ops-t1-codemod/TECH.md §2.4 (wrapper is
 * the rewrite target authored by Subtask 32.5; downstream Subtasks rewrite
 * handlers to call it).
 *
 * Acceptance per task-list.json Subtask 32.5 testStrategy:
 *   (a) defineRoute(SchemaX, handler) returns a callable route export which
 *       invokes the handler with the (request, ctx) tuple.
 *   (b) Validates handler return value against SchemaX.
 *   (c) Returns a 500 envelope when validation fails.
 *
 * Title "wraps a handler and validates its return payload against the
 * schema" is the load-bearing test title called out by the Subtask brief.
 */

import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { defineRoute } from '@/lib/api/define-route';

function makeRequest(): NextRequest {
  return new NextRequest(new URL('/api/test', 'http://localhost:3000'), {
    method: 'GET',
  });
}

describe('defineRoute', () => {
  it('wraps a handler and validates its return payload against the schema', async () => {
    const Schema = z.object({ items: z.array(z.string()), total: z.number() });
    const payload = { items: ['alpha', 'beta'], total: 2 };

    const route = defineRoute(Schema, async () => payload);
    const response = await route(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(payload);
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

  it('returns a 500 envelope when the handler payload does not match the schema', async () => {
    const Schema = z.object({ items: z.array(z.string()), total: z.number() });

    const route = defineRoute(Schema, async () =>
      // Force a runtime shape mismatch — `total` is a string, not a number.
      // Cast through `as unknown as` so the compile-time generic does not
      // pre-empt this test (the schema's job is to catch shapes that escape
      // the type system at runtime: untyped Supabase clients, JSON parsing,
      // upstream bugs, etc.).
      ({ items: ['x'], total: 'not-a-number' }) as unknown as z.infer<
        typeof Schema
      >,
    );

    const response = await route(makeRequest());
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body).toMatchObject({ error: 'response_schema_validation_failed' });
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
  });
});
