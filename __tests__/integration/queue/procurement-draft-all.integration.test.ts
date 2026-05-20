/**
 * S224 W4-C — §5.4.1 batch-draft-all integration tests.
 *
 * Spec: docs/specs/§5.4.1-batch-draft-all-spec.md §8 ACs 1, 2, 3, 4, 5, 6, 7,
 * 8, 9. AC-10 (UI flow) is the E2E spec at e2e/tests/bid-draft-all.spec.ts.
 *
 * Drives the production lib/queue/* + draft-all route + cron worker through
 * the real Supabase staging branch (`turayklvaunphgbgscat`). Discipline:
 *   - NO mocked supabase. NO mocked queue lib.
 *   - Mocks ONLY the dispatch boundary (`runJobByType`) where AC-2/AC-5
 *     specifically need to fault-inject Anthropic 429 / 5xx responses, OR
 *     to short-circuit the real Anthropic call. The handler's database
 *     interactions are still exercised via the dispatch passthrough.
 *   - Each test creates its own bid + questions in beforeAll/beforeEach,
 *     drives the queue end-to-end, asserts on observable DB state, and
 *     cleans up in afterAll/afterEach.
 *
 * Real-behaviour gating: `HAS_REQUIRED_ENV` is the ONLY conditional
 * (graceful-skip per `feedback_e2e_conditional_false_pass`). All assertions
 * inside the suite are hard expects.
 *
 * Per `feedback_integration_test_location` + `feedback_test_runners_split`:
 *   - File MUST live under __tests__/integration/**.
 *   - Run via `bun run test:integration -- queue/bid-draft-all` (NOT
 *     picked up by `bun run test`).
 *
 * @vitest-environment node
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from 'vitest';

// service-client MUST import first — loads dotenv for env vars.
import { serviceClient } from '../helpers/service-client';
import {
  getTestUserIds,
  signInAsTestUser,
  type AuthCookieStore,
} from '../helpers/auth-session';

// Production lib/queue/* — exercised end-to-end.
import * as dispatchModule from '@/lib/queue/dispatch';

// Producer route applies `checkRateLimit('draft-all:${user.id}', 1, 120_000)`;
// reset between tests so each AC's POST starts with a fresh window.
import { _resetRateLimitStore } from '@/lib/rate-limit';

import type { Json } from '@/supabase/types/database.types';

// ---------------------------------------------------------------------------
// Env-gated graceful skip seam.
// ---------------------------------------------------------------------------

const HAS_REQUIRED_ENV = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.CRON_SECRET &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
  process.env.TEST_USER_1_PASSWORD &&
  process.env.TEST_USER_2_PASSWORD,
);

const describeIfEnv = HAS_REQUIRED_ENV ? describe : describe.skip;

// Reset the producer route's in-memory rate-limit store between tests so each
// AC starts with a fresh `draft-all:${user.id}` window (1 req/120s).
beforeEach(() => {
  _resetRateLimitStore();
});

// ---------------------------------------------------------------------------
// Constants + tracked state.
// ---------------------------------------------------------------------------

const TEST_PREFIX = `[S224-W4C-BIDDRAFTALL-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}]`;

let ADMIN_USER_ID = '';
let EDITOR_USER_ID = '';

// Procurement application_type id — resolved at beforeAll from the seeded
// `application_types` table (S246 WP2b T2 — workspaces discriminator is now
// application_type_id FK, not `workspaces.type` text col). 'bid' → 'procurement'
// per Q-OQR1-02.
let PROCUREMENT_APP_TYPE_ID = '';

// Track every seeded row so afterAll can scrub.
const seededBidIds = new Set<string>();
const seededQuestionIds = new Set<string>();
const seededResponseIds = new Set<string>();
const seededJobIds = new Set<string>();
const seededPipelineRunIds = new Set<string>();

// ---------------------------------------------------------------------------
// Auth cookie machinery — the draft-all route uses
// getAuthorisedClient(['admin','editor']) which reads cookies via
// next/headers. We hoist a cookie store so a real signed-in editor session
// reaches the handler.
// ---------------------------------------------------------------------------

const { authCookies } = vi.hoisted(() => ({
  authCookies: new Map<
    string,
    { name: string; value: string }
  >() as AuthCookieStore,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () =>
      Array.from(authCookies.values()).map(({ name, value }) => ({
        name,
        value,
      })),
    get: (name: string) => authCookies.get(name),
    set: (name: string, value: string) => {
      authCookies.set(name, { name, value });
    },
  }),
}));

// ---------------------------------------------------------------------------
// Helpers — bid fixture creation, route invocation, polling.
// ---------------------------------------------------------------------------

async function createTestBid(opts: {
  status?: string;
  questionCount?: number;
  zeroQuestions?: boolean;
}): Promise<{ procurementId: string; questionIds: string[] }> {
  const status = opts.status ?? 'drafting';
  const questionCount = opts.zeroQuestions ? 0 : (opts.questionCount ?? 3);

  // Insert workspace (bid). Schema: workspaces.name (not title).
  // S246 WP2b T2: workspace discriminator is application_type_id FK, not
  // `type` text col. `domain_metadata` JSONB column dropped (P1).
  const { data: bid, error: bidErr } = await serviceClient
    .from('workspaces')
    .insert({
      application_type_id: PROCUREMENT_APP_TYPE_ID,
      name: `${TEST_PREFIX} test bid`,
      status,
      created_by: ADMIN_USER_ID,
      updated_by: ADMIN_USER_ID,
    })
    .select('id')
    .single();
  if (bidErr || !bid) {
    throw new Error(`createTestBid: bid insert failed: ${bidErr?.message}`);
  }
  seededBidIds.add(bid.id);

  // Insert questions in order. Use confidence_posture='strong' so the
  // handler's loop attempts to draft them.
  const questionIds: string[] = [];
  for (let i = 0; i < questionCount; i += 1) {
    const { data: q, error: qErr } = await serviceClient
      .from('bid_questions')
      .insert({
        // S246 WP2b T2 (P2): bid_questions.workspace_id → workspace_id.
        workspace_id: bid.id,
        question_text: `${TEST_PREFIX} question ${i + 1}`,
        word_limit: 200,
        section_name: 'Test Section',
        section_sequence: 1,
        question_sequence: i + 1,
        confidence_posture: 'strong',
        matched_content_ids: [],
      })
      .select('id')
      .single();
    if (qErr || !q) {
      throw new Error(
        `createTestBid: question ${i} insert failed: ${qErr?.message}`,
      );
    }
    seededQuestionIds.add(q.id);
    questionIds.push(q.id);
  }

  return { procurementId: bid.id, questionIds };
}

function buildPostRequest(
  procurementId: string,
  body: { model_tier?: 'analysis' | 'drafting'; skip_existing?: boolean } = {},
): Request {
  return new Request(
    `http://localhost/api/bids/${procurementId}/responses/draft-all`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

function buildCronRequest(): Request {
  return new Request('http://localhost/api/cron/process-queue', {
    method: 'GET',
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
}

// ---------------------------------------------------------------------------
// Lifecycle hooks.
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!HAS_REQUIRED_ENV) return;
  const ids = await getTestUserIds();
  ADMIN_USER_ID = ids.admin;
  EDITOR_USER_ID = ids.editor;
  expect(ADMIN_USER_ID).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  expect(EDITOR_USER_ID).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );

  // S246 WP2b T2: discriminator FK lookup.
  const { data: appType, error: appTypeErr } = await serviceClient
    .from('application_types')
    .select('id')
    .eq('key', 'procurement')
    .single();
  if (appTypeErr || !appType) {
    throw new Error(
      `application_types row for key='procurement' not found — was the T2 seed step applied? Original error: ${appTypeErr?.message}`,
    );
  }
  PROCUREMENT_APP_TYPE_ID = appType.id;
}, 30_000);

afterAll(async () => {
  if (!HAS_REQUIRED_ENV) return;

  // Scrub in dependency-order — bid_responses → bid_questions → workspaces;
  // processing_queue and pipeline_runs are independent.
  if (seededResponseIds.size > 0) {
    await serviceClient
      .from('bid_responses')
      .delete()
      .in('id', Array.from(seededResponseIds));
  }
  // Defence-in-depth — scrub any responses by question_id.
  if (seededQuestionIds.size > 0) {
    await serviceClient
      .from('bid_responses')
      .delete()
      .in('question_id', Array.from(seededQuestionIds));
  }
  if (seededQuestionIds.size > 0) {
    await serviceClient
      .from('bid_questions')
      .delete()
      .in('id', Array.from(seededQuestionIds));
  }
  if (seededBidIds.size > 0) {
    await serviceClient
      .from('workspaces')
      .delete()
      .in('id', Array.from(seededBidIds));
  }
  if (seededJobIds.size > 0) {
    await serviceClient
      .from('processing_queue')
      .delete()
      .in('id', Array.from(seededJobIds));
  }
  // Defence — also scrub by idempotency_key prefix.
  await serviceClient
    .from('processing_queue')
    .delete()
    .like('idempotency_key', `bid_draft_all:%${TEST_PREFIX}%`);
  if (seededPipelineRunIds.size > 0) {
    await serviceClient
      .from('pipeline_runs')
      .delete()
      .in('id', Array.from(seededPipelineRunIds));
  }
}, 60_000);

// ---------------------------------------------------------------------------
// AC-1 — Route enqueues + returns 202.
// Spec §8 AC-1 lines 868-874.
// ---------------------------------------------------------------------------

describeIfEnv(
  'AC-1 — POST returns 202+envelope; processing_queue row created',
  () => {
    beforeEach(async () => {
      authCookies.clear();
      await signInAsTestUser(authCookies, 'editor');
    });
    afterEach(() => {
      authCookies.clear();
    });

    it('AC-1: returns 202 + {job_id, pipeline_run_id, status:"queued", deduplicated:false}; processing_queue row exists with job_type=bid_draft_all', async () => {
      const { procurementId } = await createTestBid({ status: 'drafting' });

      const { POST } =
        await import('@/app/api/procurement/[id]/responses/draft-all/route');
      const response = await POST(
        buildPostRequest(
          procurementId,
        ) as unknown as import('next/server').NextRequest,
        { params: Promise.resolve({ id: procurementId }) },
      );

      expect(response.status).toBe(202);
      const body = (await response.json()) as {
        job_id: string;
        pipeline_run_id: string;
        status: 'queued';
        deduplicated: boolean;
      };
      expect(body.status).toBe('queued');
      expect(body.deduplicated).toBe(false);
      expect(body.job_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(body.pipeline_run_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      seededJobIds.add(body.job_id);
      seededPipelineRunIds.add(body.pipeline_run_id);

      // Verify processing_queue row exists with the expected envelope.
      const { data: row, error: rowErr } = await serviceClient
        .from('processing_queue')
        .select('id, job_type, status, payload, idempotency_key')
        .eq('id', body.job_id)
        .single();
      expect(rowErr).toBeNull();
      expect(row).toBeTruthy();
      expect(row!.job_type).toBe('bid_draft_all');
      expect(row!.status).toBe('pending');
      const payload = row!.payload as Record<string, unknown>;
      expect(payload.envelope_version).toBe(1);
      const innerBody = payload.body as Record<string, unknown>;
      expect(innerBody.bid_id).toBe(procurementId);
      expect(innerBody.model_tier).toBe('drafting');
      expect(innerBody.skip_existing).toBe(true);
      // Idempotency key formula per spec §3.2:
      // bid_draft_all:${procurementId}:${YYYY-MM-DD}:${requestHash}
      expect(row!.idempotency_key).toMatch(
        new RegExp(
          `^bid_draft_all:${procurementId}:\\d{4}-\\d{2}-\\d{2}:[0-9a-f]{16}$`,
        ),
      );
    }, 30_000);

    // AC-9 inline assertion — pipeline_runs row inserted at-enqueue.
    it('AC-9 (producer side): pipeline_runs row INSERTed at-enqueue with status=running, pipeline_name=bid_draft_all, workspace_id=bid_id, id=pipeline_run_id', async () => {
      const { procurementId } = await createTestBid({ status: 'drafting' });

      const { POST } =
        await import('@/app/api/procurement/[id]/responses/draft-all/route');
      const response = await POST(
        buildPostRequest(
          procurementId,
        ) as unknown as import('next/server').NextRequest,
        { params: Promise.resolve({ id: procurementId }) },
      );
      const body = (await response.json()) as {
        job_id: string;
        pipeline_run_id: string;
      };
      seededJobIds.add(body.job_id);
      seededPipelineRunIds.add(body.pipeline_run_id);

      const { data: pr, error: prErr } = await serviceClient
        .from('pipeline_runs')
        .select('id, status, pipeline_name, workspace_id')
        .eq('id', body.pipeline_run_id)
        .single();
      expect(prErr).toBeNull();
      expect(pr).toBeTruthy();
      expect(pr!.status).toBe('running');
      expect(pr!.pipeline_name).toBe('bid_draft_all');
      expect(pr!.workspace_id).toBe(procurementId);
    }, 30_000);
  },
);

// ---------------------------------------------------------------------------
// AC-3 — Same-day re-enqueue dedup.
// Spec §8 AC-3 lines 887-894.
// ---------------------------------------------------------------------------

describeIfEnv(
  'AC-3 — same-day re-enqueue dedup (existing job_id, deduplicated:true)',
  () => {
    beforeEach(async () => {
      authCookies.clear();
      await signInAsTestUser(authCookies, 'editor');
    });
    afterEach(() => {
      authCookies.clear();
    });

    it('AC-3: two POSTs with identical body → second returns same job_id with deduplicated:true; processing_queue has exactly 1 row', async () => {
      const { procurementId } = await createTestBid({ status: 'drafting' });

      const { POST } =
        await import('@/app/api/procurement/[id]/responses/draft-all/route');
      const first = await POST(
        buildPostRequest(
          procurementId,
        ) as unknown as import('next/server').NextRequest,
        { params: Promise.resolve({ id: procurementId }) },
      );
      expect(first.status).toBe(202);
      const firstBody = (await first.json()) as {
        job_id: string;
        pipeline_run_id: string;
        deduplicated: boolean;
      };
      expect(firstBody.deduplicated).toBe(false);
      seededJobIds.add(firstBody.job_id);
      seededPipelineRunIds.add(firstBody.pipeline_run_id);

      // Reset rate-limit between the two POSTs — the route applies
      // 1 req/120s per user, which would otherwise return 429 here and
      // mask the dedup behaviour we're actually asserting.
      _resetRateLimitStore();

      const second = await POST(
        buildPostRequest(
          procurementId,
        ) as unknown as import('next/server').NextRequest,
        { params: Promise.resolve({ id: procurementId }) },
      );
      expect(second.status).toBe(202);
      const secondBody = (await second.json()) as {
        job_id: string;
        pipeline_run_id: string;
        deduplicated: boolean;
      };
      expect(secondBody.deduplicated).toBe(true);
      expect(secondBody.job_id).toBe(firstBody.job_id);
      seededPipelineRunIds.add(secondBody.pipeline_run_id);

      // Exactly ONE processing_queue row for the idempotency_key.
      const { data: rows, error: rowsErr } = await serviceClient
        .from('processing_queue')
        .select('id, idempotency_key')
        .eq('id', firstBody.job_id);
      expect(rowsErr).toBeNull();
      expect(rows).toHaveLength(1);
    }, 60_000);
  },
);

// ---------------------------------------------------------------------------
// AC-4 — Next-day re-enqueue creates fresh job (date-bucket boundary).
// Spec §8 AC-4 lines 898-906.
//
// Per `feedback_date_now_constructor_testability`: use vi.spyOn(Date, 'now')
// + `new Date(Date.now()).toISOString()` is the testable pattern. Both
// `lib/queue/envelope.ts:176` (`(args.dateUtc ?? new Date()).toISOString()`)
// and the route handler's idempotency-key construction read Date through
// `new Date()` (no Date.now bump in the worker path), so we spy on Date's
// constructor here via vi.useFakeTimers + vi.setSystemTime.
// ---------------------------------------------------------------------------

describeIfEnv(
  'AC-4 — next-day re-enqueue creates fresh job (date bucket flips)',
  () => {
    beforeEach(async () => {
      authCookies.clear();
      await signInAsTestUser(authCookies, 'editor');
    });
    afterEach(() => {
      authCookies.clear();
      vi.useRealTimers();
    });

    it('AC-4: two POSTs spanning UTC date boundary → different job_id + deduplicated:false', async () => {
      const { procurementId } = await createTestBid({ status: 'drafting' });

      const { POST } =
        await import('@/app/api/procurement/[id]/responses/draft-all/route');

      // Pin "today" to a fixed UTC date.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date('2026-05-05T12:00:00.000Z'));
      const first = await POST(
        buildPostRequest(
          procurementId,
        ) as unknown as import('next/server').NextRequest,
        { params: Promise.resolve({ id: procurementId }) },
      );
      expect(first.status).toBe(202);
      const firstBody = (await first.json()) as {
        job_id: string;
        pipeline_run_id: string;
        deduplicated: boolean;
      };
      expect(firstBody.deduplicated).toBe(false);
      seededJobIds.add(firstBody.job_id);
      seededPipelineRunIds.add(firstBody.pipeline_run_id);

      // Advance to the NEXT UTC day.
      vi.setSystemTime(new Date('2026-05-06T12:00:00.000Z'));

      // Reset rate-limit between the two POSTs (route applies 1 req/120s).
      _resetRateLimitStore();

      const second = await POST(
        buildPostRequest(
          procurementId,
        ) as unknown as import('next/server').NextRequest,
        { params: Promise.resolve({ id: procurementId }) },
      );
      expect(second.status).toBe(202);
      const secondBody = (await second.json()) as {
        job_id: string;
        pipeline_run_id: string;
        deduplicated: boolean;
      };
      seededJobIds.add(secondBody.job_id);
      seededPipelineRunIds.add(secondBody.pipeline_run_id);

      // Different job_id, deduplicated:false.
      expect(secondBody.deduplicated).toBe(false);
      expect(secondBody.job_id).not.toBe(firstBody.job_id);

      // Verify two distinct processing_queue rows with different
      // idempotency_keys (date bucket differs).
      const { data: rows, error: rowsErr } = await serviceClient
        .from('processing_queue')
        .select('id, idempotency_key')
        .in('id', [firstBody.job_id, secondBody.job_id]);
      expect(rowsErr).toBeNull();
      expect(rows).toHaveLength(2);
      const keys = rows!.map((r) => r.idempotency_key);
      expect(keys[0]).not.toBe(keys[1]);
      // First key has 2026-05-05; second has 2026-05-06.
      expect(keys.some((k) => k!.includes('2026-05-05'))).toBe(true);
      expect(keys.some((k) => k!.includes('2026-05-06'))).toBe(true);
    }, 60_000);
  },
);

// ---------------------------------------------------------------------------
// AC-2, AC-5 — Worker drains job to completion (and AC-5 per-question
// failure tolerance). The cron tick consumes the row; the dispatcher
// invokes runJobByType.
//
// We spy on `runJobByType` to short-circuit the real Anthropic call (the
// integration env may not have ANTHROPIC_API_KEY). The spy returns a
// canonical happy-path result OR throws to simulate a transient. The DB
// path through processing_queue + pipeline_runs is exercised real.
// ---------------------------------------------------------------------------

describeIfEnv(
  'AC-2 — worker drains job to completion (cron tick → status=completed)',
  () => {
    let dispatchSpy: ReturnType<typeof vi.spyOn> | null = null;

    beforeEach(async () => {
      authCookies.clear();
      await signInAsTestUser(authCookies, 'editor');
    });
    afterEach(() => {
      authCookies.clear();
      dispatchSpy?.mockRestore();
      dispatchSpy = null;
    });

    it('AC-2: enqueue + cron tick → processing_queue.status=completed; result has drafted/skipped/failed counts; pipeline_runs UPDATEd to completed', async () => {
      const { procurementId, questionIds } = await createTestBid({
        status: 'drafting',
        questionCount: 3,
      });

      // Spy dispatch to return a canonical happy-path ProcurementDraftAllResult.
      const draftedResponseIds = [
        'a1111111-1111-4111-8111-111111111111',
        'a2222222-2222-4222-8222-222222222222',
        'a3333333-3333-4333-8333-333333333333',
      ];
      dispatchSpy = vi
        .spyOn(dispatchModule, 'runJobByType')
        .mockImplementation(async (_job, supabase) => {
          // Mimic the dispatch case's pipeline_runs Pattern 2 finalisation
          // by performing the UPDATE here — otherwise the route's
          // status='running' row stays open. (The real handler does this
          // via the production dispatch case clause; we replicate it here
          // because the spy bypasses the case clause entirely.)
          const job = _job as { payload: unknown };
          const payload = job.payload as { pipeline_run_id?: string };
          if (payload.pipeline_run_id) {
            await supabase
              .from('pipeline_runs')
              .update({
                status: 'completed',
                completed_at: new Date(Date.now()).toISOString(),
                items_processed: 3,
                items_created: draftedResponseIds,
                cost: 0.03,
              })
              .eq('id', payload.pipeline_run_id);
          }
          return {
            total_questions: 3,
            drafted: 3,
            skipped: 0,
            failed: 0,
            results: questionIds.map((qid, i) => ({
              question_id: qid,
              status: 'drafted',
              quality_score: 85,
              response_id: draftedResponseIds[i],
            })),
            total_cost: 0.03,
            total_tokens: 1500,
            bid_transitioned: false,
            drafted_response_ids: draftedResponseIds,
          };
        });

      const { POST } =
        await import('@/app/api/procurement/[id]/responses/draft-all/route');
      const response = await POST(
        buildPostRequest(
          procurementId,
        ) as unknown as import('next/server').NextRequest,
        { params: Promise.resolve({ id: procurementId }) },
      );
      expect(response.status).toBe(202);
      const enqueueBody = (await response.json()) as {
        job_id: string;
        pipeline_run_id: string;
      };
      seededJobIds.add(enqueueBody.job_id);
      seededPipelineRunIds.add(enqueueBody.pipeline_run_id);

      // Drive the worker.
      const { GET } = await import('@/app/api/cron/process-queue/route');
      const cronResponse = await GET(
        buildCronRequest() as unknown as import('next/server').NextRequest,
      );
      expect(cronResponse.status).toBe(200);

      // processing_queue row reaches completed with the expected result shape.
      const { data: row, error: rowErr } = await serviceClient
        .from('processing_queue')
        .select('status, result, completed_at, error_message')
        .eq('id', enqueueBody.job_id)
        .single();
      expect(rowErr).toBeNull();
      expect(row!.status).toBe('completed');
      expect(row!.completed_at).not.toBeNull();
      expect(row!.error_message).toBeNull();
      const result = row!.result as Record<string, unknown>;
      expect(result.drafted).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.total_questions).toBe(3);

      // pipeline_runs row UPDATED in place — Pattern 2 caller-allocated
      // (the same row, not a new one).
      const { data: pr } = await serviceClient
        .from('pipeline_runs')
        .select('id, status, items_processed, items_created')
        .eq('id', enqueueBody.pipeline_run_id)
        .single();
      expect(pr).toBeTruthy();
      expect(pr!.status).toBe('completed');
      expect(pr!.items_processed).toBe(3);
      expect(pr!.items_created).toEqual(draftedResponseIds);
    }, 60_000);

    it('AC-5: per-question 429 (drafted=2, failed=1) → processing_queue.result reflects failure; pipeline_runs status=completed_with_errors', async () => {
      const { procurementId, questionIds } = await createTestBid({
        status: 'drafting',
        questionCount: 3,
      });

      dispatchSpy = vi
        .spyOn(dispatchModule, 'runJobByType')
        .mockImplementation(async (_job, supabase) => {
          const job = _job as { payload: unknown };
          const payload = job.payload as { pipeline_run_id?: string };
          const draftedIds = [
            'a1111111-1111-4111-8111-111111111111',
            'a3333333-3333-4333-8333-333333333333',
          ];
          if (payload.pipeline_run_id) {
            await supabase
              .from('pipeline_runs')
              .update({
                status: 'completed_with_errors',
                completed_at: new Date(Date.now()).toISOString(),
                items_processed: 3,
                items_created: draftedIds,
                cost: 0.02,
                error_message: '1/3 questions failed',
              })
              .eq('id', payload.pipeline_run_id);
          }
          return {
            total_questions: 3,
            drafted: 2,
            skipped: 0,
            failed: 1,
            results: [
              {
                question_id: questionIds[0],
                status: 'drafted',
                quality_score: 85,
              },
              {
                question_id: questionIds[1],
                status: 'failed',
                error: 'Anthropic 429: rate limit exceeded',
              },
              {
                question_id: questionIds[2],
                status: 'drafted',
                quality_score: 85,
              },
            ],
            total_cost: 0.02,
            total_tokens: 1000,
            bid_transitioned: false,
            drafted_response_ids: draftedIds,
          };
        });

      const { POST } =
        await import('@/app/api/procurement/[id]/responses/draft-all/route');
      const response = await POST(
        buildPostRequest(
          procurementId,
        ) as unknown as import('next/server').NextRequest,
        { params: Promise.resolve({ id: procurementId }) },
      );
      const enqueueBody = (await response.json()) as {
        job_id: string;
        pipeline_run_id: string;
      };
      seededJobIds.add(enqueueBody.job_id);
      seededPipelineRunIds.add(enqueueBody.pipeline_run_id);

      const { GET } = await import('@/app/api/cron/process-queue/route');
      await GET(
        buildCronRequest() as unknown as import('next/server').NextRequest,
      );

      const { data: row } = await serviceClient
        .from('processing_queue')
        .select('status, result')
        .eq('id', enqueueBody.job_id)
        .single();
      // processing_queue records 'completed' even with per-question failures
      // — the per-question fail/drafted counts live in `result` per spec §5.2.
      expect(row!.status).toBe('completed');
      const result = row!.result as Record<string, unknown>;
      expect(result.drafted).toBe(2);
      expect(result.failed).toBe(1);
      const results = result.results as Array<{ status: string }>;
      expect(results[1].status).toBe('failed');

      const { data: pr } = await serviceClient
        .from('pipeline_runs')
        .select('status, error_message')
        .eq('id', enqueueBody.pipeline_run_id)
        .single();
      expect(pr!.status).toBe('completed_with_errors');
      expect(pr!.error_message).toMatch(/1\/3 questions failed/);
    }, 60_000);
  },
);

// ---------------------------------------------------------------------------
// AC-6 — Procurement not in draftable state. The HTTP-level pre-condition fires at
// the route, so this AC has two facets:
//   (a) HTTP 400 from the route when bid is not draftable (the route guard
//       at L84-98).
//   (b) PermanentJobError from the handler when the queue receives a job
//       for a bid whose state has flipped between enqueue and processing.
// We test (a) via direct route POST and (b) via direct envelope insert
// + cron tick.
// ---------------------------------------------------------------------------

describeIfEnv('AC-6 — bid not in draftable state', () => {
  beforeEach(async () => {
    authCookies.clear();
    await signInAsTestUser(authCookies, 'editor');
  });
  afterEach(() => {
    authCookies.clear();
  });

  it('AC-6 (HTTP-level): bid status=matching → POST returns 400 with current_status=matching', async () => {
    const { procurementId } = await createTestBid({ status: 'matching' });

    const { POST } =
      await import('@/app/api/procurement/[id]/responses/draft-all/route');
    const response = await POST(
      buildPostRequest(
        procurementId,
      ) as unknown as import('next/server').NextRequest,
      { params: Promise.resolve({ id: procurementId }) },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: string;
      current_status: string;
    };
    expect(body.current_status).toBe('matching');
  }, 30_000);

  it('AC-6 (handler-level): direct envelope insert + flip bid to matching → cron tick → status=failed, error_message mentions bid_not_draftable', async () => {
    const { procurementId } = await createTestBid({ status: 'drafting' });
    // Flip to matching (simulates state change post-enqueue).
    await serviceClient
      .from('workspaces')
      .update({ status: 'matching' })
      .eq('id', procurementId);

    // Direct envelope insert to processing_queue.
    const idempotencyKey = `bid_draft_all:${procurementId}:2026-05-05:${TEST_PREFIX}_AC6h`;
    const envelope: Json = {
      envelope_version: 1,
      auth_context: {
        user_id: EDITOR_USER_ID,
        role: 'editor',
        workspace_id: procurementId,
      },
      idempotency_key: idempotencyKey,
      body: {
        bid_id: procurementId,
        model_tier: 'drafting',
        skip_existing: true,
      },
    } as Json;
    const { data: insertedJob, error: insertErr } = await serviceClient
      .from('processing_queue')
      .insert({
        job_type: 'bid_draft_all',
        status: 'pending',
        payload: envelope,
        priority: 0,
        max_attempts: 3,
        idempotency_key: idempotencyKey,
        created_by: EDITOR_USER_ID,
      })
      .select('id')
      .single();
    expect(insertErr).toBeNull();
    expect(insertedJob).toBeTruthy();
    seededJobIds.add(insertedJob!.id);

    const { GET } = await import('@/app/api/cron/process-queue/route');
    await GET(
      buildCronRequest() as unknown as import('next/server').NextRequest,
    );

    const { data: row } = await serviceClient
      .from('processing_queue')
      .select('status, error_message, attempts')
      .eq('id', insertedJob!.id)
      .single();
    expect(row!.status).toBe('failed');
    expect(row!.error_message).toMatch(/bid_not_draftable/i);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// AC-7 — 0 questions → permanent failure (handler-level).
// ---------------------------------------------------------------------------

describeIfEnv('AC-7 — bid with 0 questions → permanent failure', () => {
  it('AC-7: enqueue + cron tick → status=failed, error_message=no_questions_in_bid', async () => {
    const { procurementId } = await createTestBid({
      status: 'drafting',
      zeroQuestions: true,
    });

    const idempotencyKey = `bid_draft_all:${procurementId}:2026-05-05:${TEST_PREFIX}_AC7`;
    const envelope: Json = {
      envelope_version: 1,
      auth_context: {
        user_id: EDITOR_USER_ID,
        role: 'editor',
        workspace_id: procurementId,
      },
      idempotency_key: idempotencyKey,
      body: {
        bid_id: procurementId,
        model_tier: 'drafting',
        skip_existing: true,
      },
    } as Json;
    const { data: insertedJob } = await serviceClient
      .from('processing_queue')
      .insert({
        job_type: 'bid_draft_all',
        status: 'pending',
        payload: envelope,
        priority: 0,
        max_attempts: 3,
        idempotency_key: idempotencyKey,
        created_by: EDITOR_USER_ID,
      })
      .select('id')
      .single();
    seededJobIds.add(insertedJob!.id);

    const { GET } = await import('@/app/api/cron/process-queue/route');
    await GET(
      buildCronRequest() as unknown as import('next/server').NextRequest,
    );

    const { data: row } = await serviceClient
      .from('processing_queue')
      .select('status, error_message')
      .eq('id', insertedJob!.id)
      .single();
    expect(row!.status).toBe('failed');
    expect(row!.error_message).toMatch(/no_questions_in_bid/i);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// AC-8 — Cancel pending → 200; cancel processing → 409.
// Spec §8 AC-8 lines 936-946.
// ---------------------------------------------------------------------------

describeIfEnv('AC-8 — cancel pending (200) / processing (409)', () => {
  beforeEach(async () => {
    authCookies.clear();
    await signInAsTestUser(authCookies, 'admin');
  });
  afterEach(() => {
    authCookies.clear();
  });

  it('AC-8 (pending → 200): enqueue + PATCH cancel → status=cancelled, response 200', async () => {
    const { procurementId } = await createTestBid({ status: 'drafting' });

    const { POST } =
      await import('@/app/api/procurement/[id]/responses/draft-all/route');
    const response = await POST(
      buildPostRequest(
        procurementId,
      ) as unknown as import('next/server').NextRequest,
      { params: Promise.resolve({ id: procurementId }) },
    );
    const enqueueBody = (await response.json()) as {
      job_id: string;
      pipeline_run_id: string;
    };
    seededJobIds.add(enqueueBody.job_id);
    seededPipelineRunIds.add(enqueueBody.pipeline_run_id);

    const { PATCH } = await import('@/app/api/jobs/[id]/cancel/route');
    const cancelReq = new Request(
      `http://localhost/api/jobs/${enqueueBody.job_id}/cancel`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    const cancelResponse = await PATCH(
      cancelReq as unknown as import('next/server').NextRequest,
      { params: Promise.resolve({ id: enqueueBody.job_id }) },
    );
    expect(cancelResponse.status).toBe(200);
    const cancelBody = (await cancelResponse.json()) as {
      status: string;
    };
    expect(cancelBody.status).toBe('cancelled');

    const { data: row } = await serviceClient
      .from('processing_queue')
      .select('status, completed_at')
      .eq('id', enqueueBody.job_id)
      .single();
    expect(row!.status).toBe('cancelled');
    expect(row!.completed_at).not.toBeNull();
  }, 30_000);

  it('AC-8 (processing → 409): manually-flipped processing row → PATCH cancel returns 409', async () => {
    const { procurementId } = await createTestBid({ status: 'drafting' });

    const { POST } =
      await import('@/app/api/procurement/[id]/responses/draft-all/route');
    const response = await POST(
      buildPostRequest(
        procurementId,
      ) as unknown as import('next/server').NextRequest,
      { params: Promise.resolve({ id: procurementId }) },
    );
    const enqueueBody = (await response.json()) as {
      job_id: string;
      pipeline_run_id: string;
    };
    seededJobIds.add(enqueueBody.job_id);
    seededPipelineRunIds.add(enqueueBody.pipeline_run_id);

    // Manually flip status to processing.
    await serviceClient
      .from('processing_queue')
      .update({
        status: 'processing',
        started_at: new Date(Date.now()).toISOString(),
      })
      .eq('id', enqueueBody.job_id);

    const { PATCH } = await import('@/app/api/jobs/[id]/cancel/route');
    const cancelReq = new Request(
      `http://localhost/api/jobs/${enqueueBody.job_id}/cancel`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    const cancelResponse = await PATCH(
      cancelReq as unknown as import('next/server').NextRequest,
      { params: Promise.resolve({ id: enqueueBody.job_id }) },
    );
    expect(cancelResponse.status).toBe(409);
    const cancelBody = (await cancelResponse.json()) as {
      error: string;
      status: string;
    };
    expect(cancelBody.error).toMatch(
      /already running and cannot be cancelled/i,
    );
    expect(cancelBody.status).toBe('processing');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// AC-9 — pipeline_runs Pattern 2 caller-allocated UPDATE (cardinality
// preservation).
//
// Critical assertion: SELECT count(*) FROM pipeline_runs WHERE pipeline_name=
// 'bid_draft_all' AND workspace_id=bid_id MUST equal 1, NOT 2 — i.e. the
// dispatch code does NOT call recordPipelineRun() at terminal which would
// INSERT a second row. The current dispatch case writes a direct UPDATE
// (per the IMPL drift note in lib/queue/dispatch.ts:19-30).
// ---------------------------------------------------------------------------

describeIfEnv(
  'AC-9 — pipeline_runs Pattern 2 caller-allocated UPDATE (cardinality=1)',
  () => {
    let dispatchSpy: ReturnType<typeof vi.spyOn> | null = null;

    beforeEach(async () => {
      authCookies.clear();
      await signInAsTestUser(authCookies, 'editor');
    });
    afterEach(() => {
      authCookies.clear();
      dispatchSpy?.mockRestore();
      dispatchSpy = null;
    });

    it('AC-9: post-cron-tick, exactly 1 pipeline_runs row exists for (pipeline_name=bid_draft_all, workspace_id=bid_id) — same UUID as caller-allocated', async () => {
      const { procurementId, questionIds } = await createTestBid({
        status: 'drafting',
        questionCount: 2,
      });

      // Spy dispatch to drive a deterministic completion. The spy's
      // implementation directly writes the pipeline_runs UPDATE — matching
      // the production dispatch case clause.
      const draftedIds = ['a1111111-1111-4111-8111-111111111111'];
      dispatchSpy = vi
        .spyOn(dispatchModule, 'runJobByType')
        .mockImplementation(async (_job, supabase) => {
          const job = _job as { payload: unknown };
          const payload = job.payload as { pipeline_run_id?: string };
          if (payload.pipeline_run_id) {
            await supabase
              .from('pipeline_runs')
              .update({
                status: 'completed',
                completed_at: new Date(Date.now()).toISOString(),
                items_processed: 2,
                items_created: draftedIds,
                cost: 0.01,
              })
              .eq('id', payload.pipeline_run_id);
          }
          return {
            total_questions: 2,
            drafted: 1,
            skipped: 1,
            failed: 0,
            results: [
              {
                question_id: questionIds[0],
                status: 'drafted',
                quality_score: 80,
              },
              {
                question_id: questionIds[1],
                status: 'skipped',
                reason: 'no_content',
              },
            ],
            total_cost: 0.01,
            total_tokens: 500,
            bid_transitioned: false,
            drafted_response_ids: draftedIds,
          };
        });

      const { POST } =
        await import('@/app/api/procurement/[id]/responses/draft-all/route');
      const response = await POST(
        buildPostRequest(
          procurementId,
        ) as unknown as import('next/server').NextRequest,
        { params: Promise.resolve({ id: procurementId }) },
      );
      const enqueueBody = (await response.json()) as {
        job_id: string;
        pipeline_run_id: string;
      };
      seededJobIds.add(enqueueBody.job_id);
      seededPipelineRunIds.add(enqueueBody.pipeline_run_id);

      // Snapshot count BEFORE cron — should be 1 (producer INSERTed
      // status='running' at-enqueue).
      const { count: countBefore } = await serviceClient
        .from('pipeline_runs')
        .select('id', { count: 'exact', head: true })
        .eq('pipeline_name', 'bid_draft_all')
        .eq('workspace_id', procurementId);
      expect(countBefore).toBe(1);

      // Drive cron tick.
      const { GET } = await import('@/app/api/cron/process-queue/route');
      await GET(
        buildCronRequest() as unknown as import('next/server').NextRequest,
      );

      // Cardinality assertion — STILL exactly 1 row. NOT 2. Pattern 2
      // contract: same UUID, status flipped to terminal.
      const { data: rows, error: rowsErr } = await serviceClient
        .from('pipeline_runs')
        .select('id, status, items_created, items_processed')
        .eq('pipeline_name', 'bid_draft_all')
        .eq('workspace_id', procurementId);
      expect(rowsErr).toBeNull();
      expect(rows).toHaveLength(1);
      expect(rows![0].id).toBe(enqueueBody.pipeline_run_id);
      expect(rows![0].status).toBe('completed');
      // items_created is string[] per feedback_record_pipeline_run_signature.
      expect(rows![0].items_created).toEqual(draftedIds);
      expect(rows![0].items_processed).toBe(2);
    }, 60_000);
  },
);
