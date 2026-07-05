/**
 * `pipeline_runs` round-trip via `recordPipelineRun()` — real DB integration test.
 *
 * ID-131.19 M6 GO tail (Checker PASS_WITH_NOTES on e819261b) — extracted verbatim
 * (self-contained, zero content_items dependency) from the deleted
 * `content-owner-id-and-pipeline-run.integration.test.ts` (git show
 * 7abf7097:__tests__/integration/content-owner-id-and-pipeline-run.integration.test.ts).
 * That file's OTHER two describe blocks ("content_owner_id — resolveContentOwnerId
 * + DB round-trip" and "content_owner_id — backfill semantics") asserted
 * content_items columns/backfill semantics for a table DROPPED at M6 and were
 * correctly retired with the rest of the file. This block never called `seedItem`
 * or touched `content_items` at all — it hits `pipeline_runs` directly via the
 * canonical `recordPipelineRun()` helper (lib/pipeline/record-run.ts), which has
 * 18+ live production callers (every MCP / API / cron path that records a
 * pipeline run funnels through it). No other test proves the real DB schema/RLS
 * accepts its three status payloads: `__tests__/lib/pipeline/record-run.test.ts`
 * is mock-only, `record-run-discipline` is a static grep guard, and
 * `pipeline-runs-admin-update` covers UPDATE, not INSERT. Deleting this coverage
 * alongside the content_items-era file would have been a real regression.
 *
 * Coverage:
 *   Call recordPipelineRun() against the real DB (with `skipSentryAlert` so test
 *   runs don't spam Sentry) for the three documented status outcomes
 *   ('completed', 'completed_with_errors', 'failed'); query the row back and
 *   assert every field round-trips.
 *
 * Spec: docs/specs/ingest-path-consistency-spec.md §3.2 (pipeline_runs).
 * Plan: docs/plans/ingest-path-consistency-plan.md §Phase 2 (S206 WP-A2).
 *
 * Prerequisites:
 *   - `.env.local` (or .env) with NEXT_PUBLIC_SUPABASE_URL +
 *     SUPABASE_SERVICE_ROLE_KEY pointing at the persistent staging branch.
 *
 * Run via: `bun run test:integration -- pipeline-runs-record-run`
 *   (NOT picked up by `bun run test`; see CLAUDE.md
 *   feedback_test_runners_split.)
 *
 * @vitest-environment node
 */

import { describe, it, expect, afterAll } from 'vitest';
import { serviceClient } from './helpers/service-client';
import { recordPipelineRun } from '@/lib/pipeline/record-run';

const TEST_PIPELINE_NAME = `id131_19_pipeline_runs_integration_${Date.now()}`;

// Track every row this suite seeds so afterAll can scrub them even if
// individual tests fail.
const seededPipelineRunIds: string[] = [];

afterAll(async () => {
  if (seededPipelineRunIds.length > 0) {
    await serviceClient
      .from('pipeline_runs')
      .delete()
      .in('id', seededPipelineRunIds);
  }
  // Defensive secondary scrub by name in case a test failed before the id
  // was tracked. Cheap because pipeline_name is unique per run for this
  // suite (Date.now()-suffixed).
  await serviceClient
    .from('pipeline_runs')
    .delete()
    .eq('pipeline_name', TEST_PIPELINE_NAME);
}, 30_000);

// ---------------------------------------------------------------------------
// pipeline_runs round-trip via recordPipelineRun().
//
// Asserts the canonical helper at lib/pipeline/record-run.ts writes the
// three documented status outcomes correctly. `skipSentryAlert: true`
// suppresses the alert path so test runs don't pollute Sentry. Every row
// is captured by id and scrubbed in afterAll. The pipeline_name field is
// suffixed with Date.now() so concurrent runs don't collide.
// ---------------------------------------------------------------------------

describe('pipeline_runs — recordPipelineRun end-to-end', () => {
  it("status='completed' round-trips with itemsProcessed + result payload", async () => {
    const itemsCreated = ['11111111-2222-4333-8444-aaaaaaaaaaaa'];
    const result = { phase: 's209_w5_test_completed', source: 'integration' };

    await recordPipelineRun({
      supabase: serviceClient,
      pipelineName: TEST_PIPELINE_NAME,
      status: 'completed',
      itemsProcessed: 7,
      itemsCreated,
      result,
      skipSentryAlert: true,
    });

    const { data, error } = await serviceClient
      .from('pipeline_runs')
      .select(
        'id, pipeline_name, status, items_processed, items_created, result, error_message, completed_at',
      )
      .eq('pipeline_name', TEST_PIPELINE_NAME)
      .eq('status', 'completed')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    seededPipelineRunIds.push(data!.id);
    expect(data!.pipeline_name).toBe(TEST_PIPELINE_NAME);
    expect(data!.status).toBe('completed');
    expect(data!.items_processed).toBe(7);
    expect(data!.items_created).toEqual(itemsCreated);
    expect(data!.result).toMatchObject(result);
    expect(data!.error_message).toBeNull();
    expect(data!.completed_at).not.toBeNull();
  });

  it("status='completed_with_errors' persists errorMessage", async () => {
    const errorMessage = 'partial-failure: 2 of 10 sub-tasks errored';

    await recordPipelineRun({
      supabase: serviceClient,
      pipelineName: TEST_PIPELINE_NAME,
      status: 'completed_with_errors',
      itemsProcessed: 10,
      errorMessage,
      skipSentryAlert: true,
    });

    const { data, error } = await serviceClient
      .from('pipeline_runs')
      .select('id, status, error_message, items_processed')
      .eq('pipeline_name', TEST_PIPELINE_NAME)
      .eq('status', 'completed_with_errors')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    expect(error).toBeNull();
    seededPipelineRunIds.push(data!.id);
    expect(data!.status).toBe('completed_with_errors');
    expect(data!.error_message).toBe(errorMessage);
    expect(data!.items_processed).toBe(10);
  });

  it("status='failed' persists errorMessage and items_created=null", async () => {
    const errorMessage = 'integration-test simulated failure';

    await recordPipelineRun({
      supabase: serviceClient,
      pipelineName: TEST_PIPELINE_NAME,
      status: 'failed',
      itemsProcessed: 0,
      itemsCreated: null,
      errorMessage,
      skipSentryAlert: true,
    });

    const { data, error } = await serviceClient
      .from('pipeline_runs')
      .select('id, status, error_message, items_created, items_processed')
      .eq('pipeline_name', TEST_PIPELINE_NAME)
      .eq('status', 'failed')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    expect(error).toBeNull();
    seededPipelineRunIds.push(data!.id);
    expect(data!.status).toBe('failed');
    expect(data!.error_message).toBe(errorMessage);
    expect(data!.items_created).toBeNull();
    expect(data!.items_processed).toBe(0);
  });
});
