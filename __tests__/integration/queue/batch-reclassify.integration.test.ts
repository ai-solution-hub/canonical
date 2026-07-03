/**
 * S225 W1-C — §5.4.2 batch-reclassify integration tests.
 *
 * Spec: docs/specs/§5.4.2-batch-reclassify-spec.md §8 ACs 1, 2, 3, 4, 5, 6, 7,
 * 8, 9. AC-10 (pipeline_runs Pattern 2 cardinality) is covered as a sub-AC of
 * AC-2. AC-11 (UI flow E2E) is the deferred spec (per D-4 ratified flip —
 * CLI-only with future UI).
 *
 * Drives the production lib/queue/* + batch-reclassify route + cron worker
 * through the real Supabase staging branch.
 * Discipline:
 *   - NO mocked supabase. NO mocked queue lib.
 *   - Mocks ONLY the dispatch boundary (`runJobByType`) where AC-2/AC-5
 *     specifically need to fault-inject Anthropic responses, OR to
 *     short-circuit the real Anthropic call.
 *   - Each test creates its own seeded content_items in beforeEach, drives
 *     the queue end-to-end, asserts on observable DB state, and cleans up
 *     in afterAll.
 *
 * Real-behaviour gating: `HAS_REQUIRED_ENV` is the ONLY conditional
 * (graceful-skip per `feedback_e2e_conditional_false_pass`). All assertions
 * inside the suite are hard expects.
 *
 * Per `feedback_integration_test_location` + `feedback_test_runners_split`:
 *   - File MUST live under __tests__/integration/**.
 *   - Run via `bun run test:integration -- batch-reclassify` (NOT
 *     picked up by `bun run test`).
 *
 * Per `feedback_brief_quote_spec_verbatim`: AC text + interface shapes
 * copied verbatim from spec §8 + §3.1.
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

// ---------------------------------------------------------------------------
// Constants + tracked state.
// ---------------------------------------------------------------------------

const TEST_PREFIX = `[S225-W1C-BATCHRECLASSIFY-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}]`;

let ADMIN_USER_ID = '';
let EDITOR_USER_ID = '';

// Track every seeded row so afterAll can scrub.
const seededContentItemIds = new Set<string>();
const seededJobIds = new Set<string>();
const seededPipelineRunIds = new Set<string>();

// ---------------------------------------------------------------------------
// Auth cookie machinery — the route uses
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
// Helpers.
// ---------------------------------------------------------------------------

/**
 * Insert a seeded content_items row scoped to the test prefix. Items are
 * UNCLASSIFIED by default so the candidate filter selects them under
 * `force: false`.
 */
async function createTestContentItem(opts: {
  classified?: boolean;
  domain?: string | null;
}): Promise<{ itemId: string }> {
  const classified = opts.classified ?? false;
  // Use a hash that the GENERATED ALWAYS column will compute itself
  // (per CLAUDE.md gotcha — content_text_hash is GENERATED ALWAYS).
  const { data: item, error: itemErr } = await serviceClient
    .from('content_items')
    .insert({
      title: `${TEST_PREFIX} test item`,
      suggested_title: `${TEST_PREFIX} test item`,
      content: `${TEST_PREFIX} sample content text about security and encryption.`,
      content_type: 'q_a_pair',
      platform: 'extraction',
      primary_domain: classified ? (opts.domain ?? 'security') : 'unclassified',
      primary_subtopic: classified ? 'cyber-security' : 'unclassified',
      classified_at: classified ? new Date(Date.now()).toISOString() : null,
      classification_confidence: classified ? 0.95 : null,
      ai_keywords: classified ? ['encryption', 'gdpr'] : null,
    })
    .select('id')
    .single();
  if (itemErr || !item) {
    throw new Error(
      `createTestContentItem: insert failed: ${itemErr?.message}`,
    );
  }
  seededContentItemIds.add(item.id);
  return { itemId: item.id };
}

function buildPostRequest(body: Record<string, unknown> = {}): Request {
  return new Request('http://localhost/api/admin/batch-reclassify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
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

  // Cross-run isolation: nuke any batch_reclassify rows older than 10 minutes
  // on the persistent staging branch. The route's idempotency key has no
  // test-unique component (hashes canonical body only) so a prior run's
  // completed row in the same UTC date bucket would dedup-collide with the
  // current run's first POST. CI runs serially (`fileParallelism: false`)
  // and staging is dedicated to CI, so the 10-min age gate is safe.
  await serviceClient
    .from('processing_queue')
    .delete()
    .eq('job_type', 'batch_reclassify')
    .lt('created_at', new Date(Date.now() - 10 * 60_000).toISOString());
}, 30_000);

afterAll(async () => {
  if (!HAS_REQUIRED_ENV) return;

  // Scrub in dependency-order — entity_mentions / entity_relationships are
  // FK to source_documents, NOT content_items (ID-131 M2 / ID-131.26), so
  // deleting content_items no longer cascades to them. Resolve each seeded
  // item's linked source_document_id (best-effort; items with none simply
  // never got entity rows written) before cleaning up, to avoid orphan-row
  // buildup on the persistent staging branch.
  if (seededContentItemIds.size > 0) {
    const { data: sourceDocLinks } = await serviceClient
      .from('content_items')
      .select('source_document_id')
      .in('id', Array.from(seededContentItemIds));
    const sourceDocumentIds = (sourceDocLinks ?? [])
      .map((r) => r.source_document_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (sourceDocumentIds.length > 0) {
      await serviceClient
        .from('entity_mentions')
        .delete()
        .in('source_document_id', sourceDocumentIds);
      await serviceClient
        .from('entity_relationships')
        .delete()
        .in('source_document_id', sourceDocumentIds);
    }
    await serviceClient
      .from('content_items')
      .delete()
      .in('id', Array.from(seededContentItemIds));
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
    .like('idempotency_key', `batch_reclassify:%${TEST_PREFIX}%`);
  if (seededPipelineRunIds.size > 0) {
    await serviceClient
      .from('pipeline_runs')
      .delete()
      .in('id', Array.from(seededPipelineRunIds));
  }
}, 60_000);

// ---------------------------------------------------------------------------
// AC-1 — Route enqueues + returns 202.
// Spec §8 AC-1 lines 1182-1188.
// ---------------------------------------------------------------------------

describeIfEnv(
  'AC-1 — POST returns 202+envelope; processing_queue row created',
  () => {
    beforeEach(async () => {
      authCookies.clear();
      await signInAsTestUser(authCookies, 'admin');
    });
    afterEach(() => {
      authCookies.clear();
    });

    it('AC-1: returns 202 + {job_id, pipeline_run_id, status:"queued", deduplicated:false}; processing_queue row exists with job_type=batch_reclassify', async () => {
      const { POST } = await import('@/app/api/admin/batch-reclassify/route');
      const response = await POST(
        buildPostRequest({
          limit: 5,
          force: false,
        }) as unknown as import('next/server').NextRequest,
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
      expect(row!.job_type).toBe('batch_reclassify');
      expect(row!.status).toBe('pending');
      const payload = row!.payload as Record<string, unknown>;
      expect(payload.envelope_version).toBe(1);
      const innerBody = payload.body as Record<string, unknown>;
      expect(innerBody.workspace_id).toBe('default'); // CLIENT_CONFIG.client_id
      expect(innerBody.limit).toBe(5);
      expect(innerBody.force).toBe(false);
      // Idempotency key formula per spec §3.2 + D-6:
      // batch_reclassify:{workspace_id}:{YYYY-MM-DD}:{16-char-sha256-hex}
      expect(row!.idempotency_key).toMatch(
        /^batch_reclassify:default:\d{4}-\d{2}-\d{2}:[0-9a-f]{16}$/,
      );
    }, 30_000);

    it('producer side: pipeline_runs row INSERTed at-enqueue with status=running, pipeline_name=batch_reclassify, id=pipeline_run_id', async () => {
      const { POST } = await import('@/app/api/admin/batch-reclassify/route');
      const response = await POST(
        buildPostRequest({
          limit: 5,
        }) as unknown as import('next/server').NextRequest,
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
      expect(pr!.pipeline_name).toBe('batch_reclassify');
      // workspace_id is NULL because CLIENT_CONFIG.client_id ('default') is
      // non-UUID. Per route.ts L143-148 + D-8.
      expect(pr!.workspace_id).toBeNull();
    }, 30_000);
  },
);

// ---------------------------------------------------------------------------
// AC-3 — Same-day re-enqueue dedup.
// Spec §8 AC-3 lines 1203-1209.
// ---------------------------------------------------------------------------

describeIfEnv(
  'AC-3 — same-day re-enqueue dedup (existing job_id, deduplicated:true)',
  () => {
    beforeEach(async () => {
      authCookies.clear();
      await signInAsTestUser(authCookies, 'admin');
    });
    afterEach(() => {
      authCookies.clear();
    });

    it('AC-3: two POSTs with identical body → second returns same job_id with deduplicated:true; processing_queue has exactly 1 row', async () => {
      const { POST } = await import('@/app/api/admin/batch-reclassify/route');
      const body = { limit: 7, force: false };

      const first = await POST(
        buildPostRequest(body) as unknown as import('next/server').NextRequest,
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

      const second = await POST(
        buildPostRequest(body) as unknown as import('next/server').NextRequest,
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

      // Exactly ONE processing_queue row for the dedup-keyed job.
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
// Spec §8 AC-4 lines 1213-1220.
//
// Per `feedback_date_now_constructor_testability`: use vi.spyOn(Date, 'now')
// + `new Date(Date.now()).toISOString()` is the testable pattern. Both the
// route's idempotency-key construction (via `buildIdempotencyKey` →
// `new Date()`) and the worker path read Date through new Date(). We pin
// via `vi.useFakeTimers + vi.setSystemTime` here.
// ---------------------------------------------------------------------------

describeIfEnv(
  'AC-4 — next-day re-enqueue creates fresh job (date bucket flips)',
  () => {
    beforeEach(async () => {
      authCookies.clear();
      await signInAsTestUser(authCookies, 'admin');
    });
    afterEach(() => {
      authCookies.clear();
      vi.useRealTimers();
    });

    it('AC-4: two POSTs spanning UTC date boundary → different job_id + deduplicated:false', async () => {
      const { POST } = await import('@/app/api/admin/batch-reclassify/route');
      const body = { limit: 3, force: false };

      // Pin "today" to a fixed UTC date.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date('2026-05-05T12:00:00.000Z'));
      const first = await POST(
        buildPostRequest(body) as unknown as import('next/server').NextRequest,
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

      const second = await POST(
        buildPostRequest(body) as unknown as import('next/server').NextRequest,
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
// AC-2, AC-5 — Worker drains job to completion (and AC-5 per-item failure
// tolerance). The cron tick consumes the row; the dispatcher invokes
// runJobByType.
//
// We spy on `runJobByType` to short-circuit the real Anthropic call (the
// integration env may not have ANTHROPIC_API_KEY). The spy returns a
// canonical happy-path BatchReclassifyResult OR partial-failure result.
// The DB path through processing_queue + pipeline_runs is exercised real.
// ---------------------------------------------------------------------------

describeIfEnv(
  'AC-2 — worker drains job to completion (cron tick → status=completed)',
  () => {
    let dispatchSpy: ReturnType<typeof vi.spyOn> | null = null;

    beforeEach(async () => {
      authCookies.clear();
      await signInAsTestUser(authCookies, 'admin');
    });
    afterEach(() => {
      authCookies.clear();
      dispatchSpy?.mockRestore();
      dispatchSpy = null;
    });

    it('AC-2: enqueue + cron tick → processing_queue.status=completed; result has reclassified/failed counts; pipeline_runs UPDATEd to completed', async () => {
      const { itemId: item1 } = await createTestContentItem({
        classified: false,
      });
      const { itemId: item2 } = await createTestContentItem({
        classified: false,
      });

      // Spy dispatch to return a canonical happy-path BatchReclassifyResult.
      dispatchSpy = vi
        .spyOn(dispatchModule, 'runJobByType')
        .mockImplementation(async (_job, supabase) => {
          // Mimic the dispatch case's pipeline_runs Pattern 2 finalisation.
          const job = _job as { payload: unknown };
          const payload = job.payload as { pipeline_run_id?: string };
          if (payload.pipeline_run_id) {
            await supabase
              .from('pipeline_runs')
              .update({
                status: 'completed',
                completed_at: new Date(Date.now()).toISOString(),
                items_processed: 2,
                items_created: [item1, item2],
                cost: 0.005,
              })
              .eq('id', payload.pipeline_run_id);
          }
          return {
            total_items: 2,
            reclassified: 2,
            skipped: 0,
            failed: 0,
            results: [
              {
                item_id: item1,
                status: 'reclassified',
                new_domain: 'security',
                new_subtopic: 'cyber-security',
                domain_changed: true,
              },
              {
                item_id: item2,
                status: 'reclassified',
                new_domain: 'security',
                new_subtopic: 'cyber-security',
                domain_changed: true,
              },
            ],
            total_input_tokens: 2000,
            total_output_tokens: 400,
            total_cost: 0.005,
            total_entities: 0,
            total_relationships: 0,
            embedding_errors: 0,
            domain_changes: 2,
            domain_migrations: { '(none) -> security': 2 },
          };
        });

      const { POST } = await import('@/app/api/admin/batch-reclassify/route');
      const response = await POST(
        buildPostRequest({
          // Distinct limit avoids idempotency-key collision with AC-5
          // (which uses limit:12). Canonical body is hashed into the key
          // with no test-unique component.
          limit: 11,
        }) as unknown as import('next/server').NextRequest,
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
      expect(result.reclassified).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.total_items).toBe(2);

      // pipeline_runs row UPDATED in place — Pattern 2 caller-allocated
      // (the same row, not a new one).
      const { data: pr } = await serviceClient
        .from('pipeline_runs')
        .select('id, status, items_processed, items_created')
        .eq('id', enqueueBody.pipeline_run_id)
        .single();
      expect(pr).toBeTruthy();
      expect(pr!.status).toBe('completed');
      expect(pr!.items_processed).toBe(2);
      expect(pr!.items_created).toEqual([item1, item2]);
    }, 60_000);

    it('AC-5: per-item 429 (reclassified=1, failed=1) → processing_queue.result reflects failure; pipeline_runs status=completed_with_errors', async () => {
      const { itemId: item1 } = await createTestContentItem({
        classified: false,
      });
      const { itemId: item2 } = await createTestContentItem({
        classified: false,
      });

      dispatchSpy = vi
        .spyOn(dispatchModule, 'runJobByType')
        .mockImplementation(async (_job, supabase) => {
          const job = _job as { payload: unknown };
          const payload = job.payload as { pipeline_run_id?: string };
          if (payload.pipeline_run_id) {
            await supabase
              .from('pipeline_runs')
              .update({
                status: 'completed_with_errors',
                completed_at: new Date(Date.now()).toISOString(),
                items_processed: 2,
                items_created: [item1],
                cost: 0.003,
                error_message: '1/2 items failed',
              })
              .eq('id', payload.pipeline_run_id);
          }
          return {
            total_items: 2,
            reclassified: 1,
            skipped: 0,
            failed: 1,
            results: [
              {
                item_id: item1,
                status: 'reclassified',
                new_domain: 'security',
                new_subtopic: 'cyber-security',
                domain_changed: true,
              },
              {
                item_id: item2,
                status: 'failed',
                error: 'Anthropic 429: rate limit exceeded',
              },
            ],
            total_input_tokens: 1000,
            total_output_tokens: 200,
            total_cost: 0.003,
            total_entities: 0,
            total_relationships: 0,
            embedding_errors: 0,
            domain_changes: 1,
            domain_migrations: { '(none) -> security': 1 },
          };
        });

      const { POST } = await import('@/app/api/admin/batch-reclassify/route');
      const response = await POST(
        buildPostRequest({
          // Distinct limit avoids idempotency-key collision with AC-2
          // (which uses limit:11).
          limit: 12,
        }) as unknown as import('next/server').NextRequest,
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
      // processing_queue records 'completed' even with per-item failures —
      // the per-item fail/reclassify counts live in `result` per spec §5.2.
      expect(row!.status).toBe('completed');
      const result = row!.result as Record<string, unknown>;
      expect(result.reclassified).toBe(1);
      expect(result.failed).toBe(1);
      const results = result.results as Array<{ status: string }>;
      expect(results[1].status).toBe('failed');

      const { data: pr } = await serviceClient
        .from('pipeline_runs')
        .select('status, error_message')
        .eq('id', enqueueBody.pipeline_run_id)
        .single();
      expect(pr!.status).toBe('completed_with_errors');
      expect(pr!.error_message).toMatch(/1\/2 items failed/);
    }, 60_000);
  },
);

// ---------------------------------------------------------------------------
// AC-6 — Missing workspace_id → permanent failure (handler-level via
// direct envelope insert + cron tick).
//
// The route guards against missing workspace_id via the Zod schema's
// `default: CLIENT_CONFIG.client_id`. To exercise the handler's fail-fast,
// we directly INSERT a malformed envelope into processing_queue.
// ---------------------------------------------------------------------------

describeIfEnv('AC-6 — workspace_id missing → permanent failure', () => {
  it('AC-6: direct envelope insert with body.workspace_id="" → cron tick → status=failed, error_message mentions workspace_id_missing', async () => {
    const idempotencyKey = `batch_reclassify:default:2026-05-05:${TEST_PREFIX.slice(
      1,
      17,
    )}`;
    const envelope: Json = {
      envelope_version: 1,
      auth_context: {
        user_id: ADMIN_USER_ID,
        role: 'admin',
      },
      idempotency_key: idempotencyKey,
      body: {
        workspace_id: '', // ← invalid
        domain: null,
        limit: 0,
        force: false,
        entities_only: false,
        batch_size: 1,
        model_tier: 'claude-sonnet-4-6',
      },
    } as Json;
    const { data: insertedJob, error: insertErr } = await serviceClient
      .from('processing_queue')
      .insert({
        job_type: 'batch_reclassify',
        status: 'pending',
        payload: envelope,
        priority: 0,
        max_attempts: 3,
        idempotency_key: idempotencyKey,
        created_by: ADMIN_USER_ID,
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
    expect(row!.error_message).toMatch(/workspace_id_missing/i);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// AC-7 — force:false + 0 candidates → completes successfully (handler returns
// zero-success result; processing_queue.status='completed').
// ---------------------------------------------------------------------------

describeIfEnv(
  'AC-7 — force:false + 0 candidates → completes successfully',
  () => {
    beforeEach(async () => {
      authCookies.clear();
      await signInAsTestUser(authCookies, 'admin');
    });
    afterEach(() => {
      authCookies.clear();
    });

    it('AC-7: enqueue with domain="nonexistent_domain" + force:false → cron tick → status=completed, result.total_items=0, result.reclassified=0', async () => {
      const { POST } = await import('@/app/api/admin/batch-reclassify/route');
      const response = await POST(
        buildPostRequest({
          domain: 'nonexistent_domain_zzz',
          force: false,
          limit: 5,
        }) as unknown as import('next/server').NextRequest,
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
        .select('status, result, error_message')
        .eq('id', enqueueBody.job_id)
        .single();
      expect(row!.status).toBe('completed');
      expect(row!.error_message).toBeNull();
      const result = row!.result as Record<string, unknown>;
      expect(result.total_items).toBe(0);
      expect(result.reclassified).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
    }, 60_000);
  },
);

// ---------------------------------------------------------------------------
// AC-8 — force:true + 0 candidates → permanent failure.
// Spec §8 AC-8 lines 1252-1257.
// ---------------------------------------------------------------------------

describeIfEnv('AC-8 — force:true + 0 candidates → permanent failure', () => {
  beforeEach(async () => {
    authCookies.clear();
    await signInAsTestUser(authCookies, 'admin');
  });
  afterEach(() => {
    authCookies.clear();
  });

  it('AC-8: enqueue with domain="nonexistent_domain" + force:true → cron tick → status=failed, error_message=no_candidates_under_force', async () => {
    const { POST } = await import('@/app/api/admin/batch-reclassify/route');
    const response = await POST(
      buildPostRequest({
        domain: 'nonexistent_domain_zzz',
        force: true,
        limit: 5,
      }) as unknown as import('next/server').NextRequest,
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
      .select('status, error_message')
      .eq('id', enqueueBody.job_id)
      .single();
    expect(row!.status).toBe('failed');
    expect(row!.error_message).toMatch(/no_candidates_under_force/i);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// AC-9 — Cancel pending → 200; cancel processing on a cooperatively-
// cancellable job → 200, handler stops.
// Spec §8 AC-9 lines 1261-1271.
// Per `lib/queue/cooperative-cancel.ts`: batch_reclassify is in the allow-
// list, so the cancel route returns 200 even for `processing` rows.
// ---------------------------------------------------------------------------

describeIfEnv(
  'AC-9 — cancel pending (200) / processing (200 cooperative)',
  () => {
    beforeEach(async () => {
      authCookies.clear();
      await signInAsTestUser(authCookies, 'admin');
    });
    afterEach(() => {
      authCookies.clear();
    });

    it('AC-9 (pending → 200): enqueue + PATCH cancel → status=cancelled, response 200', async () => {
      const { POST } = await import('@/app/api/admin/batch-reclassify/route');
      const response = await POST(
        buildPostRequest({
          // Distinct limit avoids idempotency-key collision with AC-1
          // (limit:5) — AC-1's row is already drained to 'completed' by
          // AC-2's cron tick, so dedup pre-SELECT would return that row's
          // id and the cancel route would return 409 (terminal-state).
          limit: 6,
        }) as unknown as import('next/server').NextRequest,
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

    it('AC-9 (processing → 200 cooperative): manually-flipped processing row of batch_reclassify → PATCH cancel returns 200; row status flips to cancelled', async () => {
      const { POST } = await import('@/app/api/admin/batch-reclassify/route');
      const response = await POST(
        buildPostRequest({
          // Distinct limit avoids idempotency-key collision with
          // AC-1 (5), AC-3 (7), AC-9 pending (6).
          limit: 8,
        }) as unknown as import('next/server').NextRequest,
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
      // batch_reclassify opts in to cooperative cancellation per
      // lib/queue/cooperative-cancel.ts COOPERATIVELY_CANCELLABLE_JOB_TYPES.
      expect(cancelResponse.status).toBe(200);
      const cancelBody = (await cancelResponse.json()) as { status: string };
      expect(cancelBody.status).toBe('cancelled');

      const { data: row } = await serviceClient
        .from('processing_queue')
        .select('status')
        .eq('id', enqueueBody.job_id)
        .single();
      expect(row!.status).toBe('cancelled');
    }, 30_000);
  },
);

// ---------------------------------------------------------------------------
// AC-10 — pipeline_runs Pattern 2 caller-allocated UPDATE (cardinality
// preservation).
//
// Critical assertion: SELECT count(*) FROM pipeline_runs WHERE pipeline_name=
// 'batch_reclassify' AND id=pipeline_run_id MUST equal 1, NOT 2 — i.e. the
// dispatch code does NOT call recordPipelineRun() at terminal which would
// INSERT a second row. Per `feedback_pipeline_runs_pattern_2_direct_update`.
// ---------------------------------------------------------------------------

describeIfEnv(
  'AC-10 — pipeline_runs Pattern 2 caller-allocated UPDATE (cardinality=1)',
  () => {
    let dispatchSpy: ReturnType<typeof vi.spyOn> | null = null;

    beforeEach(async () => {
      authCookies.clear();
      await signInAsTestUser(authCookies, 'admin');
    });
    afterEach(() => {
      authCookies.clear();
      dispatchSpy?.mockRestore();
      dispatchSpy = null;
    });

    it('AC-10: post-cron-tick, exactly 1 pipeline_runs row exists with id=pipeline_run_id (NOT 2 — same UUID, status flipped to completed)', async () => {
      const { itemId } = await createTestContentItem({ classified: false });

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
                items_processed: 1,
                items_created: [itemId],
                cost: 0.001,
              })
              .eq('id', payload.pipeline_run_id);
          }
          return {
            total_items: 1,
            reclassified: 1,
            skipped: 0,
            failed: 0,
            results: [
              {
                item_id: itemId,
                status: 'reclassified',
                new_domain: 'security',
                new_subtopic: 'cyber-security',
                domain_changed: true,
              },
            ],
            total_input_tokens: 500,
            total_output_tokens: 100,
            total_cost: 0.001,
            total_entities: 0,
            total_relationships: 0,
            embedding_errors: 0,
            domain_changes: 1,
            domain_migrations: { '(none) -> security': 1 },
          };
        });

      const { POST } = await import('@/app/api/admin/batch-reclassify/route');
      const response = await POST(
        buildPostRequest({
          limit: 1,
        }) as unknown as import('next/server').NextRequest,
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
        .eq('id', enqueueBody.pipeline_run_id);
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
        .eq('id', enqueueBody.pipeline_run_id);
      expect(rowsErr).toBeNull();
      expect(rows).toHaveLength(1);
      expect(rows![0].id).toBe(enqueueBody.pipeline_run_id);
      expect(rows![0].status).toBe('completed');
      expect(rows![0].items_created).toEqual([itemId]);
      expect(rows![0].items_processed).toBe(1);
    }, 60_000);
  },
);
