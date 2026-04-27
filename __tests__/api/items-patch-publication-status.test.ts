/**
 * PATCH /api/items/:id publication_status branch (S202 §5.2 Phase 2 / T6).
 *
 * Spec: docs/specs/publication-lifecycle-state-machine-spec.md §3.2 + §3.4 + §8.3
 * Plan: docs/plans/§5.2-phase-1-2-2.5-plan.md T6
 *
 * Covers the AC3.7–AC3.10 behaviour matrix:
 *
 *   AC3.7  PATCH `field='publication_status'` value=`'in_review'` succeeds
 *          for editor; updates `publication_status` only.
 *   AC3.8  PATCH with `archive_reason` body field stores reason in
 *          `archive_reason` column when transitioning to `'archived'`.
 *   AC3.9  Invalid transition (e.g. `'draft' → 'archived'`) returns 409.
 *   AC3.10 Non-existent item ID returns 404.
 *
 * Plus the canonical `content_history.change_reason` phrasing assertion
 * (per `feedback_content_history_change_reason_mandatory`).
 *
 * Pinned-time pattern per CLAUDE.md ("Date-sensitive tests need pinned time"
 * gotcha) — `vi.useFakeTimers()` + `vi.setSystemTime()` so the
 * `archived_at` ISO timestamp asserts deterministically.
 *
 * UUIDs are RFC 4122 v4 compliant per CLAUDE.md ("Zod UUID validation is
 * strict" gotcha).
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

// Stub the embedding helper — the publication_status branch never calls it,
// but the route file imports it eagerly so leaving it real would attempt
// network access on any code path that escaped the branch.
vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: vi.fn(),
}));

import { PATCH } from '@/app/api/items/[id]/route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// RFC 4122 v4 compliant — first hex group ends '4xxx' (version) + ninth hex
// pair starts '8'/'9'/'a'/'b' (variant). Per CLAUDE.md "Zod UUID validation
// is strict".
const ITEM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'test-user-id'; // matches createMockSupabaseClient() default

// Pinned timestamp for archived_at assertions. Chosen as a midday UTC value
// so DST and midnight-boundary rounding don't confound the ISO comparison.
const PINNED_NOW_ISO = '2026-04-27T12:00:00.000Z';
const PINNED_NOW = new Date(PINNED_NOW_ISO);

// Snapshot returned by the branch's first .maybeSingle() — content_items
// fetch. Includes title/content because the content_history insert requires
// them (NOT NULL).
function makeCurrentItem(overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID,
    publication_status: 'draft',
    archived_at: null,
    archived_by: null,
    archive_reason: null,
    title: 'Sample item',
    content: '<p>Sample body</p>',
    brief: null,
    detail: null,
    reference: null,
    ...overrides,
  };
}

function makePatchRequest(body: unknown) {
  return createTestRequest(`/api/items/${ITEM_ID}`, {
    method: 'PATCH',
    body,
  });
}

// ---------------------------------------------------------------------------
// Reset mocks before each test (mirrors the items.test.ts pattern but tuned
// to the publication_status branch — we only reset what this branch touches).
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(PINNED_NOW);

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

  // Terminal methods — mockReset to drop any mockResolvedValueOnce queue
  // left from a previous test.
  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockReset();
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation(
    (resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null, count: 0 }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PATCH /api/items/[id] — publication_status branch (S202 §5.2 / T6)', () => {
  const params = createTestParams({ id: ITEM_ID });

  // -------------------------------------------------------------------------
  // AC3.7 — happy path: editor draft → in_review
  // -------------------------------------------------------------------------
  it('AC3.7: editor PATCHing draft → in_review returns 200 and updates publication_status only', async () => {
    configureRole(mockSupabase, 'editor');
    // First .maybeSingle() — content_items fetch. Second — content_history
    // version lookup (returns null → next version = 1).
    mockSupabase._chain.maybeSingle
      .mockResolvedValueOnce({
        data: makeCurrentItem({ publication_status: 'draft' }),
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });

    const res = await PATCH(
      makePatchRequest({ field: 'publication_status', value: 'in_review' }),
      { params },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.previousStatus).toBe('draft');
    expect(body.newStatus).toBe('in_review');
    expect(body.transition).toBe('draft -> in_review');

    // The .update() payload — only publication_status + updated_by; no
    // archive metadata for a non-archive transition.
    const updateCall = mockSupabase._chain.update.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(updateCall).toBeDefined();
    expect(updateCall!.publication_status).toBe('in_review');
    expect(updateCall!.updated_by).toBe(USER_ID);
    expect('archived_at' in updateCall!).toBe(false);
    expect('archived_by' in updateCall!).toBe(false);
    expect('archive_reason' in updateCall!).toBe(false);
    // Crucially — do NOT touch governance_review_status.
    expect('governance_review_status' in updateCall!).toBe(false);
  });

  // -------------------------------------------------------------------------
  // AC3.8 — published → archived stamps archive metadata + archive_reason
  // -------------------------------------------------------------------------
  it('AC3.8: admin PATCHing published → archived with archive_reason stamps archive_reason + archived_at + archived_by', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.maybeSingle
      .mockResolvedValueOnce({
        data: makeCurrentItem({ publication_status: 'published' }),
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });

    const res = await PATCH(
      makePatchRequest({
        field: 'publication_status',
        value: 'archived',
        archive_reason: 'superseded by v2',
      }),
      { params },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.newStatus).toBe('archived');

    const updateCall = mockSupabase._chain.update.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(updateCall).toBeDefined();
    expect(updateCall!.publication_status).toBe('archived');
    expect(updateCall!.archive_reason).toBe('superseded by v2');
    expect(updateCall!.archived_by).toBe(USER_ID);
    expect(updateCall!.archived_at).toBe(PINNED_NOW_ISO);
  });

  // -------------------------------------------------------------------------
  // AC3.9 — invalid transition returns 409 (admin draft → archived is in §3.2
  // disallowed list — drafts are deleted, not archived).
  // -------------------------------------------------------------------------
  it('AC3.9: admin PATCHing draft → archived returns 409 (spec §3.2 disallowed)', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: makeCurrentItem({ publication_status: 'draft' }),
      error: null,
    });

    const res = await PATCH(
      makePatchRequest({ field: 'publication_status', value: 'archived' }),
      { params },
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/draft.*archived/i);
    // The branch must short-circuit before any update — assert no update
    // call was made.
    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // AC3.10 — non-existent item returns 404
  // -------------------------------------------------------------------------
  it('AC3.10: non-existent item ID returns 404', async () => {
    configureRole(mockSupabase, 'admin');
    // .maybeSingle() returns data=null,error=null for missing rows.
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const res = await PATCH(
      makePatchRequest({ field: 'publication_status', value: 'in_review' }),
      { params },
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Item not found');
    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // change_reason canonical phrasing (per
  // feedback_content_history_change_reason_mandatory)
  // -------------------------------------------------------------------------
  it('writes content_history with change_type="publication_state" and canonical change_reason phrasing', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.maybeSingle
      .mockResolvedValueOnce({
        data: makeCurrentItem({ publication_status: 'draft' }),
        error: null,
      })
      .mockResolvedValueOnce({ data: { version: 4 }, error: null });

    const res = await PATCH(
      makePatchRequest({ field: 'publication_status', value: 'in_review' }),
      { params },
    );
    expect(res.status).toBe(200);

    // The content_history insert is identifiable by its `change_type`.
    // Multiple .insert() calls may exist on the chain mock if other
    // best-effort inserts fire; pick the one whose payload carries
    // change_type='publication_state'.
    const historyCall = mockSupabase._chain.insert.mock.calls.find(
      (call: unknown[]) => {
        const payload = call[0] as Record<string, unknown>;
        return payload.change_type === 'publication_state';
      },
    );
    expect(historyCall).toBeDefined();
    const payload = historyCall![0] as Record<string, unknown>;
    expect(payload.change_type).toBe('publication_state');
    expect(payload.change_reason).toBe('Transition from draft to in_review');
    expect(payload.content_item_id).toBe(ITEM_ID);
    expect(payload.created_by).toBe(USER_ID);
    expect(payload.version).toBe(5); // max version (4) + 1
    expect(payload.change_summary).toBe(
      'Publication status: draft -> in_review',
    );
  });

  // -------------------------------------------------------------------------
  // change_reason includes archive_reason suffix on archive transition
  // -------------------------------------------------------------------------
  it('appends "(reason: …)" to content_history.change_reason on archive transitions with archive_reason', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.maybeSingle
      .mockResolvedValueOnce({
        data: makeCurrentItem({ publication_status: 'published' }),
        error: null,
      })
      .mockResolvedValueOnce({ data: { version: 1 }, error: null });

    const res = await PATCH(
      makePatchRequest({
        field: 'publication_status',
        value: 'archived',
        archive_reason: 'replaced by v2',
      }),
      { params },
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
    expect(payload.change_reason).toBe(
      'Transition from published to archived (reason: replaced by v2)',
    );
  });
});
