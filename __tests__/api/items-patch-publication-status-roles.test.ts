/**
 * PATCH /api/items/:id publication_status branch — role-gate matrix
 * (S202 §5.2 Phase 2 / T6).
 *
 * Spec: docs/specs/publication-lifecycle-state-machine-spec.md §3.4 + §8.3
 * Plan: docs/plans/§5.2-phase-1-2-2.5-plan.md T6
 *
 * Covers AC4.1 / AC4.2 / AC4.3 — the exhaustive 4-state × 3-role matrix
 * intersected with the §3.2 transition table.
 *
 * Status-code policy reflects the spec semantics:
 *   - 403 when the role has NO allowed transitions out of the current state
 *     (viewer everywhere; editor on `'published'` and `'archived'`).
 *   - 409 when the role CAN transition out of the current state but not to
 *     the requested target (e.g. editor `'draft' → 'archived'`).
 *
 * Note: the route-level gate `getAuthorisedClient(['admin', 'editor'])`
 * already short-circuits viewers with 403 before the publication_status
 * branch fires. So AC4.1's "viewer cannot transition any state" surfaces as
 * the route-level 403, not the branch's role-fan-out 403 — both are
 * correct outcomes per spec §8.3 ("authenticated but wrong role" → 403).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

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

vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: vi.fn(),
}));

import { PATCH } from '@/app/api/items/[id]/route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ITEM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
// V1-L1: v4-compliant UUID per CLAUDE.md "Zod UUID validation is strict"
// gotcha; consistent with items-patch-publication-status.test.ts and the
// helper test at __tests__/lib/governance/publication-transitions.test.ts:35.
const USER_ID = 'a0000000-0000-4000-8000-000000000001';

const PINNED_NOW_ISO = '2026-04-27T12:00:00.000Z';

function makeCurrentItem(publicationStatus: string) {
  return {
    id: ITEM_ID,
    publication_status: publicationStatus,
    archived_at: publicationStatus === 'archived' ? PINNED_NOW_ISO : null,
    archived_by: publicationStatus === 'archived' ? USER_ID : null,
    archive_reason: null,
    title: 'Sample item',
    content: '<p>Sample body</p>',
    brief: null,
    detail: null,
    reference: null,
  };
}

function makePatchRequest(value: string) {
  return createTestRequest(`/api/items/${ITEM_ID}`, {
    method: 'PATCH',
    body: { field: 'publication_status', value },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(PINNED_NOW_ISO));

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
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: null, error: null, count: 0 }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helpers — wire role + content_items snapshot + content_history version
// for one transition request.
// ---------------------------------------------------------------------------

function arrangeRoleAndItem(
  role: 'admin' | 'editor' | 'viewer',
  fromStatus: string,
) {
  configureRole(mockSupabase, role);
  // First .maybeSingle() — content_items fetch. Second — content_history
  // version lookup. Both must be queued because the role-allowed paths
  // proceed through both.
  mockSupabase._chain.maybeSingle
    .mockResolvedValueOnce({
      data: makeCurrentItem(fromStatus),
      error: null,
    })
    .mockResolvedValueOnce({ data: null, error: null });
}

// ---------------------------------------------------------------------------
// AC4.1 — viewer cannot transition any state
// ---------------------------------------------------------------------------

describe('PATCH /api/items/[id] — publication_status role-gate / AC4.1 viewer', () => {
  const params = createTestParams({ id: ITEM_ID });

  // Route-level gate (`getAuthorisedClient(['admin','editor'])`) short-
  // circuits viewers with 403 BEFORE the publication_status branch fires.
  // This still satisfies AC4.1 ("viewer cannot transition any state →
  // 403"). We test the four spec-allowed (non-empty) target states.
  const targets = ['draft', 'in_review', 'published', 'archived'] as const;
  for (const target of targets) {
    it(`viewer PATCH publication_status='${target}' → 403`, async () => {
      configureRole(mockSupabase, 'viewer');
      const res = await PATCH(makePatchRequest(target), { params });
      expect(res.status).toBe(403);
      // V1-L2: assert the response body carries the route-level
      // `Forbidden` message (per `lib/auth.ts` `forbiddenResponse()`).
      // A regression returning 403 with empty/wrong body would otherwise
      // pass on status-code only.
      const body = await res.json();
      expect(body.error).toMatch(/forbidden/i);
      // Branch must NOT have fetched the item.
      expect(mockSupabase._chain.update).not.toHaveBeenCalled();
    });
  }
});

// ---------------------------------------------------------------------------
// AC4.2 — editor matrix
// ---------------------------------------------------------------------------

describe('PATCH /api/items/[id] — publication_status role-gate / AC4.2 editor', () => {
  const params = createTestParams({ id: ITEM_ID });

  // Allowed editor transitions per spec §3.4:
  //   - draft → in_review (YES)
  //   - in_review → draft (YES)
  //   - in_review → published (YES per §5.3)
  // Disallowed (route returns 403 or 409 depending on whether editor has ANY
  // transitions out of the source state):
  //   - draft → published (editor source has [in_review] → 409, not 403)
  //   - draft → archived (§3.2 disallowed for everyone → 409)
  //   - published → archived (editor source has [] → 403)
  //   - archived → published (editor source has [] → 403)
  //   - archived → draft (editor source has [] → 403)

  it('editor PATCH draft → in_review → 200', async () => {
    arrangeRoleAndItem('editor', 'draft');
    const res = await PATCH(makePatchRequest('in_review'), { params });
    expect(res.status).toBe(200);
  });

  it('editor PATCH in_review → draft → 200', async () => {
    arrangeRoleAndItem('editor', 'in_review');
    const res = await PATCH(makePatchRequest('draft'), { params });
    expect(res.status).toBe(200);
  });

  it('editor PATCH in_review → published → 200 (per spec §5.3)', async () => {
    arrangeRoleAndItem('editor', 'in_review');
    const res = await PATCH(makePatchRequest('published'), { params });
    expect(res.status).toBe(200);
  });

  it('editor PATCH draft → published → 409 (admin-only target)', async () => {
    arrangeRoleAndItem('editor', 'draft');
    const res = await PATCH(makePatchRequest('published'), { params });
    expect(res.status).toBe(409);
    // V1-L2: assert the route's `Transition not allowed: 'X' -> 'Y' for
    // role 'Z'.` body message — see app/api/items/[id]/route.ts:256. The
    // regex pins both states + the role so a regression returning 409 with
    // a generic message would fail loudly.
    const body = await res.json();
    expect(body.error).toMatch(
      /transition not allowed.*draft.*published.*editor/i,
    );
  });

  it('editor PATCH published → archived → 403 (editor cannot leave published)', async () => {
    arrangeRoleAndItem('editor', 'published');
    const res = await PATCH(makePatchRequest('archived'), { params });
    expect(res.status).toBe(403);
    // V1-L2: assert the branch's `Role 'X' cannot transition out of 'Y'.`
    // body message — see app/api/items/[id]/route.ts:248. Distinct from the
    // route-level `Forbidden` 403 returned for viewers — this 403 is
    // emitted by the branch's own role-fan-out logic.
    const body = await res.json();
    expect(body.error).toMatch(
      /role.*editor.*cannot transition out.*published/i,
    );
    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });

  it('editor PATCH archived → published → 403 (editor cannot leave archived)', async () => {
    arrangeRoleAndItem('editor', 'archived');
    const res = await PATCH(makePatchRequest('published'), { params });
    expect(res.status).toBe(403);
    // V1-L2: branch-emitted `Role 'editor' cannot transition out of
    // 'archived'.` body assertion.
    const body = await res.json();
    expect(body.error).toMatch(
      /role.*editor.*cannot transition out.*archived/i,
    );
    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });

  it('editor PATCH archived → draft → 403 (editor cannot leave archived)', async () => {
    arrangeRoleAndItem('editor', 'archived');
    const res = await PATCH(makePatchRequest('draft'), { params });
    expect(res.status).toBe(403);
    // V1-L2: same branch-emitted message — target-state independent.
    const body = await res.json();
    expect(body.error).toMatch(
      /role.*editor.*cannot transition out.*archived/i,
    );
    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC4.3 — admin matrix (every spec-allowed transition succeeds)
// ---------------------------------------------------------------------------

describe('PATCH /api/items/[id] — publication_status role-gate / AC4.3 admin', () => {
  const params = createTestParams({ id: ITEM_ID });

  // Admin spec-allowed transitions (§3.4 + §3.2 disallowed list intersected):
  //   - draft → in_review
  //   - draft → published
  //   - in_review → draft
  //   - in_review → published
  //   - published → archived
  //   - published → draft
  //   - archived → published
  //   - archived → draft
  const cases: ReadonlyArray<{ from: string; to: string }> = [
    { from: 'draft', to: 'in_review' },
    { from: 'draft', to: 'published' },
    { from: 'in_review', to: 'draft' },
    { from: 'in_review', to: 'published' },
    { from: 'published', to: 'archived' },
    { from: 'published', to: 'draft' },
    { from: 'archived', to: 'published' },
    { from: 'archived', to: 'draft' },
  ];
  for (const { from, to } of cases) {
    it(`admin PATCH ${from} → ${to} → 200`, async () => {
      arrangeRoleAndItem('admin', from);
      const res = await PATCH(makePatchRequest(to), { params });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.previousStatus).toBe(from);
      expect(body.newStatus).toBe(to);
    });
  }
});
