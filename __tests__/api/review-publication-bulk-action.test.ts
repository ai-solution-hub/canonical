/**
 * POST /api/review/publication-bulk-action — bulk approval gate Wave 1
 * unit tests.
 *
 * Spec: docs/specs/publication-approval-gate-spec.md §4 + §5 + §6 + §7 +
 *       §8.1 (AC-bulk-1.x) + §8.2 (AC-bulk-2.x) + §8.5 (AC-bulk-5.x).
 *
 * Wave 1 scope: AC-bulk-1.1..1.8 (happy paths + role gates),
 * AC-bulk-2.1..2.10 (partial-failure paths), AC-bulk-5.1..5.4 (optimistic
 * concurrency). Out of scope (Wave 2/3): AC-bulk-3.x integration tests
 * with live DB row counts, AC-bulk-4.x UI multi-select, AC-bulk-6.x doc
 * guard.
 *
 * Test pattern modelled on
 * `__tests__/api/items-patch-publication-status.test.ts` (S202 §5.2 T6).
 * Uses `createMockSupabaseClient()` from `__tests__/helpers/mock-supabase.ts`
 * and `createTestRequest()` from `__tests__/helpers/mock-next.ts`.
 *
 * UUIDs are RFC 4122 v4 compliant per CLAUDE.md "Zod UUID validation is
 * strict" — first hex group ends '4xxx' (version) + ninth hex pair starts
 * '8'/'9'/'a'/'b' (variant).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// Reset the in-memory rate-limit store between tests so the 20 req/min
// budget doesn't leak across the 30+ tests in this file.
import { _resetRateLimitStore } from '@/lib/rate-limit';

import { POST } from '@/app/api/review/publication-bulk-action/route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// RFC 4122 v4 UUIDs for the test rows. Distinct first nibble per id so
// the `eq('id', ...)` mock spy assertions are unambiguous.
const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ID_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ID_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ID_E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const USER_ID = 'a0000000-0000-4000-8000-000000000001';

interface CurrentRowOverrides {
  id?: string;
  publication_status?: string;
  title?: string | null;
  content?: string | null;
  brief?: string | null;
  detail?: string | null;
  reference?: string | null;
}

function makeCurrentRow(
  id: string,
  overrides: CurrentRowOverrides = {},
): CurrentRowOverrides {
  return {
    id,
    publication_status: 'in_review',
    title: 'Sample item',
    content: '<p>Sample body</p>',
    brief: null,
    detail: null,
    reference: null,
    ...overrides,
  };
}

function makePostRequest(body: unknown) {
  return createTestRequest('/api/review/publication-bulk-action', {
    method: 'POST',
    body,
  });
}

// ---------------------------------------------------------------------------
// Mock chain configuration helpers.
//
// Per-iteration semantics in the route:
//   1. SELECT current state via `.maybeSingle()` — controlled by
//      `mockSupabase._chain.maybeSingle.mockResolvedValueOnce(...)`.
//   2. UPDATE returning `.single()` — controlled by
//      `mockSupabase._chain.single.mockResolvedValueOnce(...)`.
//   3. INSERT into content_history — terminal supabase-js insert resolves
//      via the chain `then` shim. Default response = `{ data: null,
//      error: null, count: 0 }`, which is success for `sb()`. Override on
//      a per-test basis if a content_history failure path is asserted.
//
// `configureRole(mockSupabase, role)` queues the FIRST `.single()` to
// return `{ data: { role }, error: null }` for the user_roles lookup that
// `getAuthorisedClient` performs internally. ALL subsequent `.single()`
// queueings (for the per-item UPDATEs) come AFTER that call.
// ---------------------------------------------------------------------------

function queueFetch(row: CurrentRowOverrides | null) {
  mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
    data: row,
    error: null,
  });
}

function queueFetchError(message = 'Connection refused') {
  mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
    data: null,
    error: { code: '08006', message },
  });
}

function queueUpdateSuccess(id: string, newStatus: string) {
  mockSupabase._chain.single.mockResolvedValueOnce({
    data: { id, publication_status: newStatus },
    error: null,
  });
}

function queueUpdateRaceLoss() {
  mockSupabase._chain.single.mockResolvedValueOnce({
    data: null,
    error: {
      code: 'PGRST116',
      message: 'Cannot coerce the result to a single JSON object',
    },
  });
}

function queueUpdateError(code = '23502', message = 'PG error') {
  mockSupabase._chain.single.mockResolvedValueOnce({
    data: null,
    error: { code, message },
  });
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimitStore();

  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: USER_ID, email: 'test@example.com' } },
    error: null,
  });

  const chainable = [
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'neq',
    'in',
    'is',
    'not',
    'ilike',
    'contains',
    'gte',
    'lte',
    'gt',
    'lt',
    'or',
    'order',
    'limit',
    'range',
  ] as const;
  for (const m of chainable) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockReset();
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.then.mockReset();
  // Default: terminal awaits (e.g. content_history.insert with no
  // .single()) resolve to a success-shaped response — matches sb()
  // contract for non-throwing inserts.
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: null, error: null, count: 0 }),
  );
});

// ===========================================================================
// AC-bulk-1.x — Happy paths + role gates
// ===========================================================================

describe('AC-bulk-1.x — happy paths + role gates', () => {
  it('AC-bulk-1.1: admin POST single in_review id → 200, success=1, failureCount=0', async () => {
    configureRole(mockSupabase, 'admin');
    queueFetch(makeCurrentRow(ID_A, { publication_status: 'in_review' }));
    queueUpdateSuccess(ID_A, 'published');

    const res = await POST(
      makePostRequest({ ids: [ID_A], action: 'approve' }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe('approve');
    expect(body.totalRequested).toBe(1);
    expect(body.successCount).toBe(1);
    expect(body.failureCount).toBe(0);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      id: ID_A,
      status: 'success',
      previousStatus: 'in_review',
      newStatus: 'published',
    });
  });

  it('AC-bulk-1.2: editor POST single in_review id → 200, success=1 (RBAC matrix permits editor)', async () => {
    configureRole(mockSupabase, 'editor');
    queueFetch(makeCurrentRow(ID_A, { publication_status: 'in_review' }));
    queueUpdateSuccess(ID_A, 'published');

    const res = await POST(
      makePostRequest({ ids: [ID_A], action: 'approve' }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.successCount).toBe(1);
    expect(body.results[0].status).toBe('success');
  });

  it('AC-bulk-1.3: admin POST 3 in_review ids → 200, success=3, failureCount=0 (sequential iteration)', async () => {
    configureRole(mockSupabase, 'admin');
    queueFetch(makeCurrentRow(ID_A, { publication_status: 'in_review' }));
    queueUpdateSuccess(ID_A, 'published');
    queueFetch(makeCurrentRow(ID_B, { publication_status: 'in_review' }));
    queueUpdateSuccess(ID_B, 'published');
    queueFetch(makeCurrentRow(ID_C, { publication_status: 'in_review' }));
    queueUpdateSuccess(ID_C, 'published');

    const res = await POST(
      makePostRequest({ ids: [ID_A, ID_B, ID_C], action: 'approve' }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalRequested).toBe(3);
    expect(body.successCount).toBe(3);
    expect(body.failureCount).toBe(0);
    expect(body.results.map((r: { id: string }) => r.id)).toEqual([
      ID_A,
      ID_B,
      ID_C,
    ]);
    expect(body.results.every((r: { status: string }) => r.status === 'success')).toBe(true);
  });

  it('AC-bulk-1.4: 51 ids → 400 (Zod cap=50 enforcement, D-3 RATIFIED S217)', async () => {
    configureRole(mockSupabase, 'admin');
    // Generate 51 v4-compliant UUIDs by varying the first hex character
    // through 0-f and using two-char suffixes.
    const ids = Array.from({ length: 51 }, (_, i) => {
      const idx = i.toString(16).padStart(2, '0');
      return `${idx}aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
    });

    const res = await POST(makePostRequest({ ids, action: 'approve' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    // The detailed error message comes from the Zod schema's
    // `.max(50, '...')` literal.
    const idsDetail = body.details.find(
      (d: { field: string }) => d.field === 'ids',
    );
    expect(idsDetail).toBeDefined();
    expect(idsDetail.message).toBe('At most 50 items per request');
    // No per-item iteration occurred → no .from() call after auth role lookup.
    // (auth role lookup itself uses .from('user_roles') so a single call is
    // expected; the route MUST NOT issue a content_items SELECT.)
    const contentItemsCalls = mockSupabase.from.mock.calls.filter(
      (call: unknown[]) => call[0] === 'content_items',
    );
    expect(contentItemsCalls).toHaveLength(0);
  });

  it('AC-bulk-1.4 (boundary): exactly 50 ids → request accepted past Zod (no .max() rejection)', async () => {
    configureRole(mockSupabase, 'admin');
    const ids = Array.from({ length: 50 }, (_, i) => {
      const idx = i.toString(16).padStart(2, '0');
      return `${idx}aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
    });
    // Queue 50 fetch+update success pairs.
    for (const id of ids) {
      queueFetch(makeCurrentRow(id, { publication_status: 'in_review' }));
      queueUpdateSuccess(id, 'published');
    }

    const res = await POST(makePostRequest({ ids, action: 'approve' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalRequested).toBe(50);
    expect(body.successCount).toBe(50);
  });

  it('AC-bulk-1.5: action=return_to_draft transitions in_review → draft', async () => {
    configureRole(mockSupabase, 'admin');
    queueFetch(makeCurrentRow(ID_A, { publication_status: 'in_review' }));
    queueUpdateSuccess(ID_A, 'draft');
    queueFetch(makeCurrentRow(ID_B, { publication_status: 'in_review' }));
    queueUpdateSuccess(ID_B, 'draft');
    queueFetch(makeCurrentRow(ID_C, { publication_status: 'in_review' }));
    queueUpdateSuccess(ID_C, 'draft');

    const res = await POST(
      makePostRequest({
        ids: [ID_A, ID_B, ID_C],
        action: 'return_to_draft',
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe('return_to_draft');
    expect(body.successCount).toBe(3);
    expect(body.results.every(
      (r: { newStatus: string }) => r.newStatus === 'draft',
    )).toBe(true);
  });

  it('AC-bulk-1.6: empty ids array → 400 (Zod min(1) enforcement)', async () => {
    configureRole(mockSupabase, 'admin');

    const res = await POST(makePostRequest({ ids: [], action: 'approve' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    const idsDetail = body.details.find(
      (d: { field: string }) => d.field === 'ids',
    );
    expect(idsDetail).toBeDefined();
    expect(idsDetail.message).toBe('At least one id is required');
  });

  it('AC-bulk-1.7: viewer POST → 403 (role gate at route boundary, BEFORE per-item iteration)', async () => {
    configureRole(mockSupabase, 'viewer');

    const res = await POST(
      makePostRequest({ ids: [ID_A], action: 'approve' }),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Forbidden');
    // Viewer was rejected at the auth wrapper; the per-item iteration
    // never ran. Verify .maybeSingle was never called for the content_items
    // fetch (only the user_roles lookup uses .single() / .maybeSingle()
    // chain methods).
    expect(mockSupabase._chain.maybeSingle).not.toHaveBeenCalled();
  });

  it('AC-bulk-1.8: unauthenticated POST → 401', async () => {
    configureUnauthenticated(mockSupabase);

    const res = await POST(
      makePostRequest({ ids: [ID_A], action: 'approve' }),
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorised');
  });
});

// ===========================================================================
// AC-bulk-2.x — Partial-failure paths
// ===========================================================================

describe('AC-bulk-2.x — partial-failure paths', () => {
  it('AC-bulk-2.1: mixed-state batch (3 in_review + 2 published) → successCount=3, failureCount=2 with conflicts', async () => {
    configureRole(mockSupabase, 'admin');
    // Items 1-3: in_review → succeed.
    queueFetch(makeCurrentRow(ID_A, { publication_status: 'in_review' }));
    queueUpdateSuccess(ID_A, 'published');
    queueFetch(makeCurrentRow(ID_B, { publication_status: 'in_review' }));
    queueUpdateSuccess(ID_B, 'published');
    queueFetch(makeCurrentRow(ID_C, { publication_status: 'in_review' }));
    queueUpdateSuccess(ID_C, 'published');
    // Items 4-5: published — pre-loop guard rejects.
    queueFetch(makeCurrentRow(ID_D, { publication_status: 'published' }));
    queueFetch(makeCurrentRow(ID_E, { publication_status: 'published' }));

    const res = await POST(
      makePostRequest({
        ids: [ID_A, ID_B, ID_C, ID_D, ID_E],
        action: 'approve',
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.successCount).toBe(3);
    expect(body.failureCount).toBe(2);
    expect(body.results[0].status).toBe('success');
    expect(body.results[1].status).toBe('success');
    expect(body.results[2].status).toBe('success');
    expect(body.results[3]).toMatchObject({
      id: ID_D,
      status: 'conflict',
      previousStatus: 'published',
    });
    expect(body.results[3].reason).toMatch(/Pre-loop guard/);
    expect(body.results[4]).toMatchObject({
      id: ID_E,
      status: 'conflict',
      previousStatus: 'published',
    });
  });

  it('AC-bulk-2.2: non-existent UUID → not_found (maybeSingle returns null)', async () => {
    configureRole(mockSupabase, 'admin');
    queueFetch(makeCurrentRow(ID_A, { publication_status: 'in_review' }));
    queueUpdateSuccess(ID_A, 'published');
    queueFetch(null); // ID_B does not exist

    const res = await POST(
      makePostRequest({ ids: [ID_A, ID_B], action: 'approve' }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.successCount).toBe(1);
    expect(body.failureCount).toBe(1);
    expect(body.results[0].status).toBe('success');
    expect(body.results[1]).toMatchObject({
      id: ID_B,
      status: 'not_found',
    });
  });

  it('AC-bulk-2.3: RLS-hidden row (maybeSingle returns null) → not_found', async () => {
    configureRole(mockSupabase, 'editor');
    queueFetch(null); // RLS hides the row identically to "missing"

    const res = await POST(
      makePostRequest({ ids: [ID_A], action: 'approve' }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.successCount).toBe(0);
    expect(body.failureCount).toBe(1);
    expect(body.results[0]).toMatchObject({
      id: ID_A,
      status: 'not_found',
    });
  });

  it('AC-bulk-2.4: race-loss between fetch + UPDATE → conflict (PGRST116)', async () => {
    configureRole(mockSupabase, 'admin');
    queueFetch(makeCurrentRow(ID_A, { publication_status: 'in_review' }));
    queueUpdateRaceLoss(); // Concurrent writer changed status mid-iteration

    const res = await POST(
      makePostRequest({ ids: [ID_A], action: 'approve' }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.successCount).toBe(0);
    expect(body.failureCount).toBe(1);
    expect(body.results[0]).toMatchObject({
      id: ID_A,
      status: 'conflict',
      previousStatus: 'in_review',
      reason: 'Concurrent state change detected.',
    });
  });

  it('AC-bulk-2.5: pre-loop guard catches published → draft for action=return_to_draft (defence-in-depth)', async () => {
    configureRole(mockSupabase, 'admin');
    queueFetch(makeCurrentRow(ID_A, { publication_status: 'published' }));

    const res = await POST(
      makePostRequest({ ids: [ID_A], action: 'return_to_draft' }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.successCount).toBe(0);
    expect(body.failureCount).toBe(1);
    expect(body.results[0]).toMatchObject({
      id: ID_A,
      status: 'conflict',
      previousStatus: 'published',
    });
    expect(body.results[0].reason).toMatch(/Pre-loop guard/);
    // The pre-loop guard must short-circuit BEFORE the UPDATE, so
    // `.update()` was never called. (Without the guard,
    // `computeAllowedTransitions('published', 'admin')` returns
    // ['archived', 'draft'] and the UPDATE would silently fire.)
    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });

  it('AC-bulk-2.6: every item race-loses → 200, successCount=0, failureCount=N', async () => {
    configureRole(mockSupabase, 'admin');
    queueFetch(makeCurrentRow(ID_A, { publication_status: 'in_review' }));
    queueUpdateRaceLoss();
    queueFetch(makeCurrentRow(ID_B, { publication_status: 'in_review' }));
    queueUpdateRaceLoss();
    queueFetch(makeCurrentRow(ID_C, { publication_status: 'in_review' }));
    queueUpdateRaceLoss();

    const res = await POST(
      makePostRequest({ ids: [ID_A, ID_B, ID_C], action: 'approve' }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.successCount).toBe(0);
    expect(body.failureCount).toBe(3);
    expect(body.results.every(
      (r: { status: string }) => r.status === 'conflict',
    )).toBe(true);
  });

  it('AC-bulk-2.7: PG error during fetch → status=error with message', async () => {
    configureRole(mockSupabase, 'admin');
    queueFetchError('Connection refused');

    const res = await POST(
      makePostRequest({ ids: [ID_A], action: 'approve' }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.successCount).toBe(0);
    expect(body.failureCount).toBe(1);
    expect(body.results[0]).toMatchObject({
      id: ID_A,
      status: 'error',
      error: 'Connection refused',
    });
  });

  it('AC-bulk-2.7b: PG error during UPDATE (non-PGRST116) → status=error', async () => {
    configureRole(mockSupabase, 'admin');
    queueFetch(makeCurrentRow(ID_A, { publication_status: 'in_review' }));
    queueUpdateError('23502', 'null value in column violates not-null');

    const res = await POST(
      makePostRequest({ ids: [ID_A], action: 'approve' }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.successCount).toBe(0);
    expect(body.failureCount).toBe(1);
    expect(body.results[0]).toMatchObject({
      id: ID_A,
      status: 'error',
    });
    expect(body.results[0].error).toMatch(/null value/);
  });

  it('AC-bulk-2.8: cap exceeded (51 ids) → 400, no per-item iteration occurs', async () => {
    // Same coverage as AC-bulk-1.4 — duplicated here as a defensive
    // assertion that the iteration loop is never reached on Zod-rejected
    // requests.
    configureRole(mockSupabase, 'admin');
    const ids = Array.from({ length: 51 }, (_, i) => {
      const idx = i.toString(16).padStart(2, '0');
      return `${idx}aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
    });

    const res = await POST(makePostRequest({ ids, action: 'approve' }));

    expect(res.status).toBe(400);
    expect(mockSupabase._chain.maybeSingle).not.toHaveBeenCalled();
    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });

  it('AC-bulk-2.9: invalid action enum → 400', async () => {
    configureRole(mockSupabase, 'admin');

    const res = await POST(
      makePostRequest({ ids: [ID_A], action: 'foo' }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    const actionDetail = body.details.find(
      (d: { field: string }) => d.field === 'action',
    );
    expect(actionDetail).toBeDefined();
  });

  it('AC-bulk-2.9b: invalid id (non-UUID) → 400', async () => {
    configureRole(mockSupabase, 'admin');

    const res = await POST(
      makePostRequest({ ids: ['not-a-uuid'], action: 'approve' }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    // Zod field path is `ids.0` for the failing array element.
    const idsDetail = body.details.find((d: { field: string }) =>
      d.field.startsWith('ids'),
    );
    expect(idsDetail).toBeDefined();
    expect(idsDetail.message).toMatch(/UUID/i);
  });

  it('AC-bulk-2.10: archived row leaked through stale cache → pre-loop guard returns conflict, never UPDATE', async () => {
    configureRole(mockSupabase, 'admin');
    queueFetch(makeCurrentRow(ID_A, { publication_status: 'archived' }));

    const res = await POST(
      makePostRequest({ ids: [ID_A], action: 'approve' }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0]).toMatchObject({
      id: ID_A,
      status: 'conflict',
      previousStatus: 'archived',
    });
    expect(body.results[0].reason).toMatch(/Pre-loop guard/);
    // No UPDATE issued — bulk endpoint NEVER transitions out of states
    // other than 'in_review' regardless of role/action.
    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });

  it('AC-bulk-2.10b: draft row → pre-loop guard returns conflict (sweep coverage)', async () => {
    configureRole(mockSupabase, 'editor');
    queueFetch(makeCurrentRow(ID_A, { publication_status: 'draft' }));

    const res = await POST(
      makePostRequest({ ids: [ID_A], action: 'return_to_draft' }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0]).toMatchObject({
      id: ID_A,
      status: 'conflict',
      previousStatus: 'draft',
    });
    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// AC-bulk-5.x — Optimistic concurrency
// ===========================================================================

describe('AC-bulk-5.x — optimistic concurrency', () => {
  it('AC-bulk-5.1: successful UPDATE uses .eq("publication_status", fromStatus) filter (mock spy)', async () => {
    configureRole(mockSupabase, 'admin');
    queueFetch(makeCurrentRow(ID_A, { publication_status: 'in_review' }));
    queueUpdateSuccess(ID_A, 'published');

    const res = await POST(
      makePostRequest({ ids: [ID_A], action: 'approve' }),
    );

    expect(res.status).toBe(200);
    // Inspect .eq() calls on the chain — we expect both ('id', ID_A)
    // and ('publication_status', 'in_review') to have been invoked
    // (the route may call .eq multiple times across the fetch + update
    // phases plus the auth user_roles lookup; we only care that the
    // optimistic-concurrency filter was issued).
    const eqCalls = mockSupabase._chain.eq.mock.calls;
    const hasIdEq = eqCalls.some(
      (call: unknown[]) => call[0] === 'id' && call[1] === ID_A,
    );
    const hasFromStatusGuard = eqCalls.some(
      (call: unknown[]) =>
        call[0] === 'publication_status' && call[1] === 'in_review',
    );
    expect(hasIdEq).toBe(true);
    expect(hasFromStatusGuard).toBe(true);
  });

  it('AC-bulk-5.2: race-loss simulated (PGRST116 on UPDATE) → conflict', async () => {
    // Same flow as AC-bulk-2.4 but framed under §5 — the .eq filter
    // is the optimistic-concurrency guard, and PGRST116 is the
    // canonical race-loss signal from PostgREST.
    configureRole(mockSupabase, 'admin');
    queueFetch(makeCurrentRow(ID_A, { publication_status: 'in_review' }));
    queueUpdateRaceLoss();

    const res = await POST(
      makePostRequest({ ids: [ID_A], action: 'approve' }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0]).toMatchObject({
      id: ID_A,
      status: 'conflict',
      reason: 'Concurrent state change detected.',
    });
  });

  it('AC-bulk-5.3: pre-loop guard rejects fromStatus !== "in_review" BEFORE UPDATE attempt (belt-and-braces)', async () => {
    // Pre-loop guard fires; UPDATE is never called. The
    // .eq('publication_status', 'in_review') filter is the second line of
    // defence — verified via the absence of any .update() invocation.
    configureRole(mockSupabase, 'admin');
    queueFetch(makeCurrentRow(ID_A, { publication_status: 'published' }));

    const res = await POST(
      makePostRequest({ ids: [ID_A], action: 'return_to_draft' }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].status).toBe('conflict');
    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });

  it('AC-bulk-5.4: two parallel bulk callers cannot double-publish — second caller sees PGRST116 on every id', async () => {
    // Simulate the SECOND of two concurrent bulk callers: every UPDATE
    // sees PGRST116 because the FIRST caller has already committed and
    // flipped the publication_status from 'in_review' to 'published'.
    // Even though the SECOND caller's fetch sees stale 'in_review' (the
    // fetches were issued before the first caller committed), the
    // .eq('publication_status', 'in_review') filter on the UPDATE
    // matches zero rows for every id.
    configureRole(mockSupabase, 'admin');
    queueFetch(makeCurrentRow(ID_A, { publication_status: 'in_review' }));
    queueUpdateRaceLoss();
    queueFetch(makeCurrentRow(ID_B, { publication_status: 'in_review' }));
    queueUpdateRaceLoss();
    queueFetch(makeCurrentRow(ID_C, { publication_status: 'in_review' }));
    queueUpdateRaceLoss();
    queueFetch(makeCurrentRow(ID_D, { publication_status: 'in_review' }));
    queueUpdateRaceLoss();
    queueFetch(makeCurrentRow(ID_E, { publication_status: 'in_review' }));
    queueUpdateRaceLoss();

    const res = await POST(
      makePostRequest({
        ids: [ID_A, ID_B, ID_C, ID_D, ID_E],
        action: 'approve',
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.successCount).toBe(0);
    expect(body.failureCount).toBe(5);
    expect(body.results.every(
      (r: { status: string; reason: string }) =>
        r.status === 'conflict' &&
        r.reason === 'Concurrent state change detected.',
    )).toBe(true);
  });
});

// ===========================================================================
// content_history insert contract — bulk-aware change_reason literal
// ===========================================================================

describe('content_history insert contract — bulk literals (§6)', () => {
  it("approve → content_history insert carries change_reason='bulk_approve' + change_type='publication_state'", async () => {
    configureRole(mockSupabase, 'admin');
    queueFetch(makeCurrentRow(ID_A, { publication_status: 'in_review' }));
    queueUpdateSuccess(ID_A, 'published');

    const res = await POST(
      makePostRequest({ ids: [ID_A], action: 'approve' }),
    );

    expect(res.status).toBe(200);
    // Find the content_history insert — identifiable by
    // change_type='publication_state' on the payload.
    const historyCall = mockSupabase._chain.insert.mock.calls.find(
      (call: unknown[]) => {
        const payload = call[0] as Record<string, unknown>;
        return payload.change_type === 'publication_state';
      },
    );
    expect(historyCall).toBeDefined();
    const payload = historyCall![0] as Record<string, unknown>;
    expect(payload.change_type).toBe('publication_state');
    expect(payload.change_reason).toBe('bulk_approve');
    expect(payload.change_summary).toBe(
      'Publication status: in_review -> published',
    );
    expect(payload.content_item_id).toBe(ID_A);
    expect(payload.created_by).toBe(USER_ID);
    // version is OMITTED — auto_version_content_history trigger sets it.
    expect('version' in payload).toBe(false);
  });

  it("return_to_draft → content_history insert carries change_reason='bulk_return_to_draft'", async () => {
    configureRole(mockSupabase, 'admin');
    queueFetch(makeCurrentRow(ID_A, { publication_status: 'in_review' }));
    queueUpdateSuccess(ID_A, 'draft');

    const res = await POST(
      makePostRequest({ ids: [ID_A], action: 'return_to_draft' }),
    );

    expect(res.status).toBe(200);
    const historyCall = mockSupabase._chain.insert.mock.calls.find(
      (call: unknown[]) => {
        const payload = call[0] as Record<string, unknown>;
        return payload.change_type === 'publication_state';
      },
    );
    expect(historyCall).toBeDefined();
    const payload = historyCall![0] as Record<string, unknown>;
    expect(payload.change_reason).toBe('bulk_return_to_draft');
    expect(payload.change_summary).toBe(
      'Publication status: in_review -> draft',
    );
  });

  it('failed iterations (conflict / not_found / error) write ZERO content_history rows', async () => {
    // Per spec §6.4: failed bulk attempts are NOT persisted to
    // content_history. Verify by enumerating every .insert() call and
    // confirming none target content_history (i.e. none have
    // change_type='publication_state' in the payload).
    configureRole(mockSupabase, 'admin');
    queueFetch(null); // not_found
    queueFetch(makeCurrentRow(ID_B, { publication_status: 'published' })); // pre-loop guard
    queueFetch(makeCurrentRow(ID_C, { publication_status: 'in_review' })); // race-loss
    queueUpdateRaceLoss();

    const res = await POST(
      makePostRequest({
        ids: [ID_A, ID_B, ID_C],
        action: 'approve',
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.successCount).toBe(0);
    expect(body.failureCount).toBe(3);
    const historyInserts = mockSupabase._chain.insert.mock.calls.filter(
      (call: unknown[]) => {
        const payload = call[0] as Record<string, unknown>;
        return payload.change_type === 'publication_state';
      },
    );
    expect(historyInserts).toHaveLength(0);
  });
});
