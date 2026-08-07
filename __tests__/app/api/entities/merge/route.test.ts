/**
 * POST /api/entities/merge — the curation-pin step (id-400 Inv-9, collapsed to
 * one RPC by id-405).
 *
 * WHAT IS ACTUALLY AT STAKE. The merge commits atomically inside
 * `merge_entities`; the pin that follows is what stops the ingestion walk
 * reverting that merge on a later run (census #41 failure #1). So the response
 * must tell an operator the truth about the pin in three distinguishable
 * states, and the merge's own success must never be misreported:
 *
 *   - pinned N rows            → `mentions_pinned: N`, no `mentions_pin_error`
 *   - pin step FAILED          → `mentions_pin_error` present (the merge still
 *                                returns 200 — it committed)
 *   - honestly nothing to pin  → `mentions_pinned: 0`, still NO error key
 *
 * The second case is the one this file exists for. PR #156's review found the
 * pin step swallowing its failures: a query whose `error` channel is never read
 * reports a clean merge over rows that are silently unprotected. Every test
 * below therefore asserts on the error channel explicitly rather than on
 * `mentions_pinned` alone.
 *
 * References:
 *   - app/api/entities/merge/route.ts (the route under test).
 *   - supabase/migrations/20260730150743_id405_pin_entity_mentions_rpc.sql.
 *   - docs/reference/testing/test-philosophy.md (behaviour-not-implementation).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestRequest } from '@/__tests__/helpers/mock-next';
import {
  configureRole,
  createMockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';

const mockSupabase = createMockSupabaseClient();

const { mockCookies, mockCheckRateLimit, mockLogger } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({ cookies: mockCookies }));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }));

vi.mock('@/lib/logger', () => ({ logger: mockLogger }));

const { POST } = await import('@/app/api/entities/merge/route');

const TARGET = 'Acme Holdings Ltd';
const MERGED_TYPE = 'framework';

/** The merge RPC's single typed summary row (ID-70 RETURNS TABLE shape). */
const MERGE_ROW = {
  merged: true,
  target: TARGET,
  entity_type: MERGED_TYPE,
  mentions_updated: 3,
  relationship_sources_updated: 1,
  relationship_targets_updated: 1,
  duplicates_removed: 1,
};

type RpcResult = { data: unknown; error: unknown };

/**
 * Route the two RPCs the handler makes by NAME rather than by call order, so a
 * test that expects a pin failure cannot accidentally be satisfied by the merge
 * call's response (or vice versa).
 */
function stubRpcs(overrides: { merge?: RpcResult; pin?: RpcResult }): void {
  mockSupabase.rpc.mockImplementation((fn: string) => {
    if (fn === 'merge_entities')
      return Promise.resolve(
        overrides.merge ?? { data: [MERGE_ROW], error: null },
      );
    if (fn === 'pin_entity_mentions')
      return Promise.resolve(overrides.pin ?? { data: 0, error: null });
    throw new Error(`unexpected rpc: ${fn}`);
  });
}

function mergeRequest() {
  return createTestRequest('/api/entities/merge', {
    method: 'POST',
    body: {
      sources: ['ACME Holdings', 'Acme Hldgs'],
      target: TARGET,
      entity_type: MERGED_TYPE,
    },
  });
}

function pinCallArgs(): Record<string, unknown> | undefined {
  const call = mockSupabase.rpc.mock.calls.find(
    (c: unknown[]) => c[0] === 'pin_entity_mentions',
  );
  return call?.[1] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });
  mockCheckRateLimit.mockReturnValue({ allowed: true });
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'admin@example.com' } },
    error: null,
  });
  // The role lookup is queued with `mockResolvedValueOnce`, which `clearAllMocks`
  // does NOT drain — so each test declares its own caller rather than inheriting
  // (and stacking) one here.
});

describe('POST /api/entities/merge — curation pin', () => {
  it('reports the row count the pin statement actually wrote', async () => {
    configureRole(mockSupabase, 'admin');
    stubRpcs({ pin: { data: 7, error: null } });

    const res = await POST(mergeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    // Authoritative: the count is the statement's own ROW_COUNT, not a tally
    // of per-row writes capped at a client-side read limit.
    expect(body.mentions_pinned).toBe(7);
    expect(body).not.toHaveProperty('mentions_pin_error');
    // The merge's own result is untouched by the pin step.
    expect(body.merged).toBe(true);
    expect(body.mentions_updated).toBe(3);
  });

  it('pins the merge winner returned by the merge, not the caller-supplied pair', async () => {
    // The winner echoed by `merge_entities` is the authority on which rows
    // survived; pinning anything else would leave the survivors unprotected.
    configureRole(mockSupabase, 'admin');
    stubRpcs({
      merge: {
        data: [{ ...MERGE_ROW, target: 'Canonicalised Acme' }],
        error: null,
      },
      pin: { data: 2, error: null },
    });

    await POST(mergeRequest());

    expect(pinCallArgs()).toEqual({
      p_canonical_name: 'Canonicalised Acme',
      p_entity_type: MERGED_TYPE,
    });
  });

  it('surfaces a pin failure instead of reporting a clean merge', async () => {
    configureRole(mockSupabase, 'admin');
    stubRpcs({
      pin: {
        data: null,
        error: {
          message: 'deadlock detected',
          code: '40P01',
          details: '',
          hint: '',
        },
      },
    });

    const res = await POST(mergeRequest());
    const body = await res.json();

    // The merge itself committed, so this is a 200 — but it must NOT look
    // like a fully successful curation.
    expect(res.status).toBe(200);
    expect(body.merged).toBe(true);
    expect(typeof body.mentions_pin_error).toBe('string');
    expect(body.mentions_pin_error.length).toBeGreaterThan(0);
    expect(body.mentions_pinned).toBe(0);
    // The operator-facing signal is not dropped either.
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('distinguishes an honest zero from a failed pin', async () => {
    configureRole(mockSupabase, 'admin');
    stubRpcs({ pin: { data: 0, error: null } });

    const res = await POST(mergeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.mentions_pinned).toBe(0);
    // No error key: nothing matched, and nothing went wrong.
    expect(body).not.toHaveProperty('mentions_pin_error');
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('never pins when the merge itself failed', async () => {
    configureRole(mockSupabase, 'admin');
    stubRpcs({
      merge: {
        data: null,
        error: {
          message: 'Target name must not be empty',
          code: 'P0001',
          details: '',
          hint: '',
        },
      },
    });

    const res = await POST(mergeRequest());

    expect(res.status).toBe(500);
    expect(pinCallArgs()).toBeUndefined();
  });

  it('refuses a non-admin caller before touching either RPC', async () => {
    configureRole(mockSupabase, 'editor');
    stubRpcs({});

    const res = await POST(mergeRequest());

    expect(res.status).toBe(403);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });
});

/**
 * The route tests above mock the RPC, so nothing in the unit suite can catch a
 * migration that pins the WRONG rows. These assertions pin the SQL text itself
 * — the same "the SQL text IS the contract to the DB" idiom as
 * `scripts/tests/test_cocoindex_curation_pinning.py::TestStage5PinSqlContracts`,
 * which guards the three pipeline-side pin predicates.
 */
describe('pin_entity_mentions migration — SQL contract', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'supabase/migrations/20260730150743_id405_pin_entity_mentions_rpc.sql',
    ),
    'utf8',
  );

  it('pins every matching row in ONE statement', () => {
    // More than one UPDATE would reintroduce the partial-pin window the RPC
    // exists to close.
    expect(sql.match(/UPDATE entity_mentions/g)).toHaveLength(1);
    expect(sql).toContain("'{curation_pinned}'");
    expect(sql).toContain('jsonb_set(');
    // Other metadata keys survive the stamp.
    expect(sql).toContain("COALESCE(em.metadata, '{}'::jsonb)");
  });

  it('matches the EFFECTIVE entity type, not the raw column', () => {
    // `merge_entities` repoints a merged row via entity_type_override and never
    // rewrites entity_type, so matching the raw column leaves exactly the
    // type-overridden survivors unpinned.
    expect(sql).toContain(
      'COALESCE(em.entity_type_override, em.entity_type) = p_entity_type',
    );
  });

  it('returns the statement row count, so the API count cannot drift', () => {
    expect(sql).toContain('GET DIAGNOSTICS v_pinned = ROW_COUNT');
    expect(sql).toContain('RETURN v_pinned');
  });

  it('keeps the merge_entities security posture', () => {
    // SECURITY INVOKER on both (merge_entities is prosecdef=false), so RLS
    // still adjudicates for `authenticated`; search_path pinned per ID-115.
    expect(sql).not.toMatch(/^\s*SECURITY DEFINER\b/m);
    expect(sql).toMatch(/LANGUAGE "sql" SECURITY INVOKER/);
    expect(
      sql.match(/SET "search_path" TO 'public', 'extensions'/g),
    ).toHaveLength(2);
    // DR-032: the api.* wrapper ships in the SAME migration — `.rpc()` resolves
    // through `api.<fn>` only (DB_OPTION), so a public-only fn would 404.
    expect(sql).toContain('CREATE FUNCTION "api"."pin_entity_mentions"');
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION "api"."pin_entity_mentions"("text", "text") TO "service_role"',
    );
  });
});
