/**
 * Unit tests for `lib/queue/handlers/bid-draft-all.ts` — Session 224 W4-C.
 *
 * Spec: docs/specs/§5.4.1-batch-draft-all-spec.md §8 (10 ACs) + §7.7 Vitest
 * cases mapping. The handler under test is the pure async function the
 * dispatcher invokes from `lib/queue/dispatch.ts case 'form_draft_all':`.
 *
 * AC coverage:
 *   AC-2  Worker drains job to completion (handler-side happy path).
 *   AC-5  Per-question failure tolerance (continue-with-partial).
 *   AC-6  Procurement not in draftable state → PermanentJobError.
 *   AC-7  0 questions → PermanentJobError.
 *   AC-9  bid_transitioned only when all eligible drafted with no failures.
 *
 * Mocking discipline (per memory feedback):
 *   - `runDraftingPipeline` is mocked at the @/lib/ai/draft module boundary
 *     so the handler's per-question loop is exercised without invoking
 *     Anthropic.
 *   - `PIPELINE_SYSTEM_USER_ID` is imported from the actual module via
 *     `actual.PIPELINE_SYSTEM_USER_ID` in the vi.mock factory per
 *     `feedback_centralised_constant_mock_adoption_sweep` — never hard-code.
 *   - The shared `createMockSupabaseClient()` factory provides the
 *     chainable Supabase mock; per-test calls configure terminal-method
 *     responses with `mockResolvedValueOnce` / `then.mockImplementationOnce`.
 *
 * Verbatim spec contracts quoted in test setup (per
 * `feedback_brief_quote_spec_verbatim`):
 *   - draftableStates = ['drafting', 'in_review', 'ready_for_export']
 *     (spec §4.3 + lib/procurement/procurement-workflow.ts:81-86).
 *   - PermanentJobError messages: `form_not_found: <id>`, `bid_not_draftable: <state>`,
 *     `form_questions_fetch_failed: <msg>`, `no_questions_in_bid`.
 *   - Per-question result statuses: 'drafted' | 'skipped' | 'failed'.
 *   - skip reasons: 'no_content', 'already_drafted'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';
import { PermanentJobError } from '@/lib/queue/dispatch';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

// ---------------------------------------------------------------------------
// Hoisted mocks — runDraftingPipeline is the Anthropic-bound boundary.
// ---------------------------------------------------------------------------

const { mockRunDraftingPipeline } = vi.hoisted(() => ({
  mockRunDraftingPipeline: vi.fn(),
}));

vi.mock('@/lib/ai/draft', () => ({
  runDraftingPipeline: mockRunDraftingPipeline,
}));

// Import the handler AFTER vi.mock declaration so the mocked draft module
// is in place when the handler module's import resolves.
const { runBidDraftAllJob } =
  await import('@/lib/queue/handlers/procurement-draft-all');
const { PIPELINE_SYSTEM_USER_ID } = await import('@/lib/intelligence/types');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BID_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const USER_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

const QUESTION_IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
];

const RESPONSE_IDS = [
  'a1111111-1111-4111-8111-111111111111',
  'a2222222-2222-4222-8222-222222222222',
  'a3333333-3333-4333-8333-333333333333',
  'a4444444-4444-4444-8444-444444444444',
  'a5555555-5555-4555-8555-555555555555',
];

const DRAFT_RESULT = {
  response_text: 'Drafted response text.',
  source_content_ids: ['c1c1c1c1-1111-4111-8111-111111111111'],
  citations: [],
  analysis: {
    primary_topic: 'Test',
    content_types_needed: [],
    response_structure: { suggested_headings: [], word_allocation: [] },
    key_points_to_cover: [],
    tone: 'formal' as const,
  },
  metadata: {
    quality_data: { overall_score: 85 },
    ai_metadata: { model: 'claude-sonnet-4-6', cost_estimate: 0.01 },
  },
  total_tokens: 500,
  total_cost: 0.01,
};

function makeQuestion(
  id: string,
  overrides: Partial<{
    confidence_posture: string | null;
    matched_content_ids: string[] | null;
  }> = {},
) {
  return {
    id,
    question_text: `Question text for ${id}`,
    word_limit: 200,
    section_name: 'Section 1',
    confidence_posture: overrides.confidence_posture ?? 'strong',
    matched_content_ids: overrides.matched_content_ids ?? [
      'c1c1c1c1-1111-4111-8111-111111111111',
    ],
  };
}

function makeBody(
  overrides: Partial<{
    skip_existing: boolean;
    model_tier: 'analysis' | 'drafting';
  }> = {},
) {
  return {
    form_id: BID_ID,
    model_tier: overrides.model_tier ?? ('drafting' as const),
    skip_existing: overrides.skip_existing ?? false,
  };
}

const AUTH_CONTEXT = {
  user_id: USER_ID,
  role: 'editor' as const,
  workspace_id: BID_ID,
};

// ---------------------------------------------------------------------------
// Mock-supabase scenario builder.
//
// The handler's call sequence (per lib/queue/handlers/bid-draft-all.ts):
//   1. workspaces.select(...).eq('id', bid_id).eq('type', 'bid').single()
//        → { data: bid, error }
//   2. form_questions.select(...).eq('workspace_id', bid_id).order(...).order(...)
//        → resolves via .then() with { data: questions, error }
//   3. (if skip_existing) form_responses.select('question_id').in(...)
//        → resolves via .then() with { data: existing, error }
//   4. Per question with content matched:
//        a. content_items.select(...).in('id', matchedIds)
//           → resolves via .then() with { data, error }
//        b. form_responses.upsert(...).select('id').single()
//           → returns { data: { id }, error }
//        c. form_questions.update({ status }).eq('id', qId).eq('workspace_id', ...)
//           → returns { error: null } (no .single()/then call observed —
//             update without .select() is fire-and-forget through `sb()`)
//   5. (if all drafted, no failures, drafting state) workspaces.select count
//        → returns { count, error }
//   6. workspaces.update({ status: 'in_review', ... }).eq(...).eq(...)
//        → returns { error: null }
// ---------------------------------------------------------------------------

interface SupabaseScenario {
  bid: {
    data: {
      id: string;
      status: string;
      domain_metadata: Record<string, unknown>;
    } | null;
    error: { message: string } | null;
  };
  questions: {
    data: ReturnType<typeof makeQuestion>[] | null;
    error: { message: string } | null;
  };
  /** Existing form_responses rows with `.in('question_id', ...)` */
  existing: { question_id: string }[];
  /** Per-content-items batch result. Returned for every question's
   *  matched_content_ids lookup. */
  contentItems: {
    id: string;
    suggested_title: string;
    content: string;
    content_type: string;
    summary: string | null;
  }[];
  /** Sequence of upsert results (one per draft attempt). */
  upsertedIds: string[];
  /** When set, `count` returned by the post-loop "any undrafted left?"
   *  workspaces.select count() check (step 5). */
  undraftedCount?: number | null;
}

function configureSupabase(
  client: MockSupabaseClient,
  scenario: SupabaseScenario,
): void {
  // 1. workspaces.select.single() — bid existence check.
  client._chain.single.mockResolvedValueOnce({
    data: scenario.bid.data,
    error: scenario.bid.error,
  });

  // The remaining call sequence depends on whether step 1 succeeded.
  if (scenario.bid.error || !scenario.bid.data) return;

  // 2. form_questions.select(...).order().order() — resolves via .then()
  client._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
    resolve({
      data: scenario.questions.data,
      error: scenario.questions.error,
    }),
  );

  if (scenario.questions.error || !scenario.questions.data) return;

  // 3. (existing responses lookup if skip_existing in caller body) — the
  //    handler always issues this when skip_existing=true. We always
  //    queue it; tests that pass skip_existing=false simply won't trigger
  //    the consumption (no harm done — the mock chain is ordered and
  //    unconsumed implementations stay queued).
  client._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
    resolve({ data: scenario.existing, error: null }),
  );

  // 4. Per-question fan-out. For each question with matched_content_ids
  //    we need:
  //    a. content_items.select(...).in(...) → .then resolve
  //    b. form_responses.upsert(...).select('id').single() → resolve
  //    c. form_questions.update(...).eq().eq() — terminal `sb()` await,
  //       which the mock fulfils via the chainable .eq() returning the
  //       chain (which is awaitable via .then() default impl resolving
  //       to {data: [], error: null}).
  let upsertIdx = 0;
  for (const q of scenario.questions.data) {
    if (q.confidence_posture === 'no_content') continue;
    if (
      scenario.existing.some((e) => e.question_id === q.id) &&
      // skip-existing was requested by caller — but we always queue
      // assuming the handler's branch reaches the upsert path. For
      // already-drafted skip cases, content/upsert mocks are not
      // consumed.
      false
    ) {
      // never reached
    }
    // a. content_items lookup
    client._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: scenario.contentItems, error: null }),
    );
    // b. form_responses.upsert.select.single
    const id = scenario.upsertedIds[upsertIdx];
    upsertIdx += 1;
    if (id) {
      client._chain.single.mockResolvedValueOnce({
        data: { id },
        error: null,
      });
    }
  }

  // 5. Post-loop count check — only fires when transition path is reached.
  if (scenario.undraftedCount !== undefined) {
    // The handler awaits the chain directly via destructuring `{ count }`.
    // In our mock, terminal `.then` is what awaits the chain when no
    // .single() is called — so we queue another .then implementation
    // returning { count }. The chain.is() returns chain, chain.not()
    // returns chain, etc., so the call lands on `then`.
    client._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: null, count: scenario.undraftedCount, error: null }),
    );
  }
}

// ---------------------------------------------------------------------------
// Test suite.
// ---------------------------------------------------------------------------

describe('runBidDraftAllJob — form_draft_all handler (§5.4.1)', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    mockRunDraftingPipeline.mockResolvedValue(DRAFT_RESULT);
  });

  // -------------------------------------------------------------------------
  // AC-2 — Worker drains job to completion (handler-side).
  // Spec §8 AC-2 lines 877-884.
  // -------------------------------------------------------------------------

  describe('AC-2 — handler drains all questions to completion', () => {
    it('5-question bid all-success → drafted=5, skipped=0, failed=0, drafted_response_ids has 5 UUIDs', async () => {
      const questions = QUESTION_IDS.slice(0, 5).map((id) => makeQuestion(id));
      configureSupabase(mockSupabase, {
        bid: {
          data: { id: BID_ID, status: 'drafting', domain_metadata: {} },
          error: null,
        },
        questions: { data: questions, error: null },
        existing: [],
        contentItems: [
          {
            id: 'c1c1c1c1-1111-4111-8111-111111111111',
            suggested_title: 'Source 1',
            content: 'Source content',
            content_type: 'q_a_pair',
            summary: 'Summary',
          },
        ],
        upsertedIds: RESPONSE_IDS.slice(0, 5),
        undraftedCount: 0, // ⇒ transition to in_review fires
      });

      const result = await runBidDraftAllJob(
        makeBody(),
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
      );

      expect(result.total_questions).toBe(5);
      expect(result.drafted).toBe(5);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.drafted_response_ids).toEqual(RESPONSE_IDS.slice(0, 5));
      expect(result.bid_transitioned).toBe(true);
      expect(result.total_cost).toBeCloseTo(0.05, 4);
      expect(result.total_tokens).toBe(2500);
      // Per-question results all 'drafted'
      for (const r of result.results) {
        expect(r.status).toBe('drafted');
        expect(r.quality_score).toBe(85);
      }
      // runDraftingPipeline called once per question.
      expect(mockRunDraftingPipeline).toHaveBeenCalledTimes(5);
    });

    it('upsert payload: review_status=ai_drafted, drafted_by=PIPELINE_SYSTEM_USER_ID, source_content_ids carried through', async () => {
      const questions = [makeQuestion(QUESTION_IDS[0])];
      configureSupabase(mockSupabase, {
        bid: {
          data: { id: BID_ID, status: 'drafting', domain_metadata: {} },
          error: null,
        },
        questions: { data: questions, error: null },
        existing: [],
        contentItems: [
          {
            id: 'c1c1c1c1-1111-4111-8111-111111111111',
            suggested_title: 'Source 1',
            content: 'Source content',
            content_type: 'q_a_pair',
            summary: null,
          },
        ],
        upsertedIds: [RESPONSE_IDS[0]],
        undraftedCount: 0,
      });

      await runBidDraftAllJob(
        makeBody(),
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
      );

      // The handler's upsert is the .upsert() chain method on
      // form_responses. Inspect the recorded call args.
      expect(mockSupabase._chain.upsert).toHaveBeenCalled();
      const upsertCall = mockSupabase._chain.upsert.mock.calls[0];
      const payload = upsertCall[0] as Record<string, unknown>;
      expect(payload.question_id).toBe(QUESTION_IDS[0]);
      expect(payload.review_status).toBe('ai_drafted');
      expect(payload.drafted_by).toBe(PIPELINE_SYSTEM_USER_ID);
      expect(payload.source_content_ids).toEqual(
        DRAFT_RESULT.source_content_ids,
      );
      expect(payload.response_text).toBe(DRAFT_RESULT.response_text);
      expect(payload.overall_score).toBe(85);
      // onConflict on question_id (§4.4 step 4 verbatim from route.ts L218-233).
      const opts = upsertCall[1] as { onConflict?: string };
      expect(opts.onConflict).toBe('question_id');
    });

    it('form_questions.update({status:ai_drafted}) called once per drafted question', async () => {
      const questions = QUESTION_IDS.slice(0, 3).map((id) => makeQuestion(id));
      configureSupabase(mockSupabase, {
        bid: {
          data: { id: BID_ID, status: 'drafting', domain_metadata: {} },
          error: null,
        },
        questions: { data: questions, error: null },
        existing: [],
        contentItems: [
          {
            id: 'c1c1c1c1-1111-4111-8111-111111111111',
            suggested_title: 'Source 1',
            content: 'Source content',
            content_type: 'q_a_pair',
            summary: null,
          },
        ],
        upsertedIds: RESPONSE_IDS.slice(0, 3),
        undraftedCount: 0,
      });

      await runBidDraftAllJob(
        makeBody(),
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
      );

      // The handler issues form_questions.update(...) per success.
      // We inspect update calls — the FIRST update is form_responses
      // (no, that's upsert; update is only used for form_questions and
      // workspaces). form_questions update happens 3x for the 3 drafts;
      // workspaces update 1x for the in_review transition.
      expect(mockSupabase._chain.update).toHaveBeenCalled();
      const updateCalls = mockSupabase._chain.update.mock.calls;
      const aiDraftedUpdates = updateCalls.filter(
        (call) => (call[0] as { status?: string }).status === 'ai_drafted',
      );
      expect(aiDraftedUpdates).toHaveLength(3);
      const inReviewUpdates = updateCalls.filter(
        (call) => (call[0] as { status?: string }).status === 'in_review',
      );
      expect(inReviewUpdates).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // AC-5 — Per-question failure tolerance (continue-with-partial).
  // Spec §8 AC-5 lines 909-916.
  // -------------------------------------------------------------------------

  describe('AC-5 — per-question failure does NOT fail whole job', () => {
    it('429 on 3rd question of 5 → drafted=4, failed=1, results[2].status=failed; remaining still drafted', async () => {
      const questions = QUESTION_IDS.slice(0, 5).map((id) => makeQuestion(id));

      // Mock: succeed on Q1+Q2, throw on Q3, succeed on Q4+Q5.
      let callCount = 0;
      mockRunDraftingPipeline.mockImplementation(async () => {
        callCount += 1;
        if (callCount === 3) {
          throw new Error('Anthropic 429: rate limit exceeded');
        }
        return DRAFT_RESULT;
      });

      // Configure 4 successful upserts (Q1, Q2, Q4, Q5).
      configureSupabase(mockSupabase, {
        bid: {
          data: { id: BID_ID, status: 'drafting', domain_metadata: {} },
          error: null,
        },
        questions: { data: questions, error: null },
        existing: [],
        contentItems: [
          {
            id: 'c1c1c1c1-1111-4111-8111-111111111111',
            suggested_title: 'Source 1',
            content: 'Source content',
            content_type: 'q_a_pair',
            summary: null,
          },
        ],
        // Configure 5 — but only 4 are consumed because Q3 throws before
        // upsert. (configureSupabase queues 5 content/upsert mocks; the
        // 3rd content lookup IS consumed by Q3 before runDraftingPipeline
        // throws, but the 3rd upsert mock stays unconsumed. Subsequent
        // questions consume the 4th and 5th upsert mocks.)
        upsertedIds: [
          RESPONSE_IDS[0],
          RESPONSE_IDS[1],
          RESPONSE_IDS[2], // unconsumed
          RESPONSE_IDS[3],
          RESPONSE_IDS[4],
        ],
        // failed > 0 ⇒ transition does NOT fire ⇒ no count call required.
      });

      const result = await runBidDraftAllJob(
        makeBody(),
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
      );

      expect(result.drafted).toBe(4);
      expect(result.failed).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.results[2].status).toBe('failed');
      expect(result.results[2].error).toMatch(/Anthropic 429/);
      expect(result.results[0].status).toBe('drafted');
      expect(result.results[1].status).toBe('drafted');
      expect(result.results[3].status).toBe('drafted');
      expect(result.results[4].status).toBe('drafted');
      expect(result.bid_transitioned).toBe(false); // failed > 0 blocks
      expect(mockRunDraftingPipeline).toHaveBeenCalledTimes(5);
    });

    it('bid_transitioned=false when failed > 0 even if drafting state would otherwise allow', async () => {
      const questions = [
        makeQuestion(QUESTION_IDS[0]),
        makeQuestion(QUESTION_IDS[1]),
      ];
      mockRunDraftingPipeline.mockImplementationOnce(async () => {
        throw new Error('transient');
      });
      mockRunDraftingPipeline.mockResolvedValueOnce(DRAFT_RESULT);

      configureSupabase(mockSupabase, {
        bid: {
          data: { id: BID_ID, status: 'drafting', domain_metadata: {} },
          error: null,
        },
        questions: { data: questions, error: null },
        existing: [],
        contentItems: [
          {
            id: 'c1c1c1c1-1111-4111-8111-111111111111',
            suggested_title: 'Source 1',
            content: 'Source content',
            content_type: 'q_a_pair',
            summary: null,
          },
        ],
        upsertedIds: [RESPONSE_IDS[0], RESPONSE_IDS[1]],
        // No undraftedCount — transition gate is failed > 0, never reaches
        // the count check.
      });

      const result = await runBidDraftAllJob(
        makeBody(),
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
      );

      expect(result.drafted).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.bid_transitioned).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // AC-6 — Procurement not in draftable state → PermanentJobError.
  // Spec §8 AC-6 lines 920-927.
  // -------------------------------------------------------------------------

  describe('AC-6 — bid not in draftable state', () => {
    it('bid status=matching → PermanentJobError mentioning bid state', async () => {
      configureSupabase(mockSupabase, {
        bid: {
          data: { id: BID_ID, status: 'matching', domain_metadata: {} },
          error: null,
        },
        questions: { data: [], error: null }, // unused
        existing: [],
        contentItems: [],
        upsertedIds: [],
      });

      await expect(
        runBidDraftAllJob(
          makeBody(),
          mockSupabase as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
        ),
      ).rejects.toThrow(PermanentJobError);

      // Message contract verbatim from handler:
      // throw new PermanentJobError(`bid_not_draftable: ${procurementStatus}`);
      await expect(
        runBidDraftAllJob(
          makeBody(),
          // Re-configure for second call.
          (() => {
            const fresh = createMockSupabaseClient();
            configureSupabase(fresh, {
              bid: {
                data: { id: BID_ID, status: 'matching', domain_metadata: {} },
                error: null,
              },
              questions: { data: [], error: null },
              existing: [],
              contentItems: [],
              upsertedIds: [],
            });
            return fresh;
          })() as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
        ),
      ).rejects.toThrow(/bid_not_draftable: matching/);
    });

    it('bid not found → PermanentJobError("form_not_found: <id>")', async () => {
      configureSupabase(mockSupabase, {
        bid: { data: null, error: { message: 'No rows found' } },
        questions: { data: [], error: null },
        existing: [],
        contentItems: [],
        upsertedIds: [],
      });

      await expect(
        runBidDraftAllJob(
          makeBody(),
          mockSupabase as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
        ),
      ).rejects.toThrow(PermanentJobError);

      const fresh = createMockSupabaseClient();
      configureSupabase(fresh, {
        bid: { data: null, error: { message: 'No rows found' } },
        questions: { data: [], error: null },
        existing: [],
        contentItems: [],
        upsertedIds: [],
      });
      await expect(
        runBidDraftAllJob(
          makeBody(),
          fresh as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
        ),
      ).rejects.toThrow(`form_not_found: ${BID_ID}`);
    });
  });

  // -------------------------------------------------------------------------
  // AC-7 — 0 questions → PermanentJobError.
  // Spec §8 AC-7 lines 929-932.
  // -------------------------------------------------------------------------

  describe('AC-7 — empty bid (0 questions)', () => {
    it('form_questions returns [] → PermanentJobError("no_questions_in_bid")', async () => {
      configureSupabase(mockSupabase, {
        bid: {
          data: { id: BID_ID, status: 'drafting', domain_metadata: {} },
          error: null,
        },
        questions: { data: [], error: null },
        existing: [],
        contentItems: [],
        upsertedIds: [],
      });

      await expect(
        runBidDraftAllJob(
          makeBody(),
          mockSupabase as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
        ),
      ).rejects.toThrow(PermanentJobError);

      const fresh = createMockSupabaseClient();
      configureSupabase(fresh, {
        bid: {
          data: { id: BID_ID, status: 'drafting', domain_metadata: {} },
          error: null,
        },
        questions: { data: [], error: null },
        existing: [],
        contentItems: [],
        upsertedIds: [],
      });
      await expect(
        runBidDraftAllJob(
          makeBody(),
          fresh as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
        ),
      ).rejects.toThrow('no_questions_in_bid');
    });

    it('form_questions DB error → PermanentJobError("form_questions_fetch_failed: <msg>")', async () => {
      configureSupabase(mockSupabase, {
        bid: {
          data: { id: BID_ID, status: 'drafting', domain_metadata: {} },
          error: null,
        },
        questions: { data: null, error: { message: 'connection refused' } },
        existing: [],
        contentItems: [],
        upsertedIds: [],
      });

      await expect(
        runBidDraftAllJob(
          makeBody(),
          mockSupabase as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
        ),
      ).rejects.toThrow(/form_questions_fetch_failed: connection refused/);
    });
  });

  // -------------------------------------------------------------------------
  // Skip-existing logic (extension of AC-2 happy path).
  // Spec §3.1 ProcurementDraftAllBody + handler L162-170.
  // -------------------------------------------------------------------------

  describe('skip_existing logic', () => {
    it('skip_existing=true with 2 of 5 already drafted → status=skipped(reason=already_drafted) for those 2; remaining 3 drafted', async () => {
      const questions = QUESTION_IDS.slice(0, 5).map((id) => makeQuestion(id));
      const alreadyDrafted = [
        { question_id: QUESTION_IDS[0] },
        { question_id: QUESTION_IDS[1] },
      ];
      configureSupabase(mockSupabase, {
        bid: {
          data: { id: BID_ID, status: 'drafting', domain_metadata: {} },
          error: null,
        },
        questions: { data: questions, error: null },
        existing: alreadyDrafted,
        contentItems: [
          {
            id: 'c1c1c1c1-1111-4111-8111-111111111111',
            suggested_title: 'Source 1',
            content: 'Source content',
            content_type: 'q_a_pair',
            summary: null,
          },
        ],
        // Only 3 upserts will fire (Q3, Q4, Q5).
        upsertedIds: [RESPONSE_IDS[2], RESPONSE_IDS[3], RESPONSE_IDS[4]],
        undraftedCount: 0,
      });

      const result = await runBidDraftAllJob(
        makeBody({ skip_existing: true }),
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
      );

      expect(result.drafted).toBe(3);
      expect(result.skipped).toBe(2);
      expect(result.failed).toBe(0);
      // First two questions are skipped with reason=already_drafted
      expect(result.results[0].status).toBe('skipped');
      expect(result.results[0].reason).toBe('already_drafted');
      expect(result.results[1].status).toBe('skipped');
      expect(result.results[1].reason).toBe('already_drafted');
      // Remaining 3 drafted
      expect(result.results[2].status).toBe('drafted');
      expect(result.results[3].status).toBe('drafted');
      expect(result.results[4].status).toBe('drafted');
      // runDraftingPipeline only called 3 times (skipped questions don't
      // invoke the pipeline)
      expect(mockRunDraftingPipeline).toHaveBeenCalledTimes(3);
    });
  });

  // -------------------------------------------------------------------------
  // confidence_posture='no_content' skip path.
  // Spec §4.4 step 5 + handler L153-160.
  // -------------------------------------------------------------------------

  describe("confidence_posture='no_content' skip", () => {
    it('no_content question pushed as status=skipped, reason=no_content; runDraftingPipeline NOT invoked', async () => {
      const questions = [
        makeQuestion(QUESTION_IDS[0], { confidence_posture: 'no_content' }),
        makeQuestion(QUESTION_IDS[1], { confidence_posture: 'strong' }),
      ];
      configureSupabase(mockSupabase, {
        bid: {
          data: { id: BID_ID, status: 'drafting', domain_metadata: {} },
          error: null,
        },
        questions: { data: questions, error: null },
        existing: [],
        contentItems: [
          {
            id: 'c1c1c1c1-1111-4111-8111-111111111111',
            suggested_title: 'Source 1',
            content: 'Source content',
            content_type: 'q_a_pair',
            summary: null,
          },
        ],
        upsertedIds: [RESPONSE_IDS[1]],
        undraftedCount: 0,
      });

      const result = await runBidDraftAllJob(
        makeBody(),
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
      );

      expect(result.drafted).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.results[0].status).toBe('skipped');
      expect(result.results[0].reason).toBe('no_content');
      expect(result.results[1].status).toBe('drafted');
      // runDraftingPipeline only called for the strong question.
      expect(mockRunDraftingPipeline).toHaveBeenCalledTimes(1);
    });
  });
});
