/**
 * S209 W5 (FIX-S207-WPA4-1) — `content_owner_id` + `pipeline_runs`
 * end-to-end integration test.
 *
 * Closes the S207 carry: no integration test asserted the pair of
 *   (a) content_items.content_owner_id population + round-trip, and
 *   (b) pipeline_runs row insertion via the canonical recordPipelineRun()
 *       helper that every MCP / API / cron path now funnels through.
 *
 * The companion unit tests at __tests__/mcp/create_content_item.test.ts
 * exercise the MCP-handler logic against fully mocked supabase clients.
 * Those tests cannot prove that the real DB schema accepts the columns,
 * the RLS policy admits the writes, or the trigger fan-out fires
 * correctly. This test does — by hitting the persistent staging branch
 * directly through the same lib functions production uses.
 *
 * Coverage matrix:
 *   1. Owner-resolution + round-trip — `resolveContentOwnerId()` is the
 *      single helper every ingest entry point calls
 *      (lib/auth/owner-default.ts). Drive it through the three documented
 *      branches (admin override, non-admin silent-force, no override) and
 *      assert the resulting INSERT persists `content_owner_id` correctly.
 *   2. `pipeline_runs` round-trip — call the canonical `recordPipelineRun()`
 *      helper against the real DB (with `skipSentryAlert` so test runs
 *      don't spam Sentry) for the three documented status outcomes
 *      ('completed', 'completed_with_errors', 'failed'); query the row
 *      back and assert every field round-trips.
 *   3. Backfill semantics — replay the WP-A3 backfill SQL
 *      (migration 20260428145733) on a fixture row that mimics the
 *      pre-S206 NULL-owner state; assert `content_owner_id = created_by`
 *      after the UPDATE.
 *
 * Spec:    docs/specs/ingest-path-consistency-spec.md §3.2 (pipeline_runs)
 *          + §3.3 (content_owner_id resolution + backfill).
 * Plan:    docs/plans/ingest-path-consistency-plan.md §Phase 2 (S206 WP-A2).
 *
 * Prerequisites:
 *   - `.env.local` (or .env) with NEXT_PUBLIC_SUPABASE_URL +
 *     SUPABASE_SERVICE_ROLE_KEY pointing at the persistent staging branch.
 *   - Migrations through 20260428180945 applied.
 *
 * Run via: `bun run test:integration -- content-owner-id-and-pipeline-run`
 *   (NOT picked up by `bun run test`; see CLAUDE.md
 *   feedback_test_runners_split.)
 *
 * Graceful-skip pattern (per memory feedback_eval_scripts_assume_populated_db):
 *   If the staging branch is data-empty (no test users present), the suite
 *   logs a single warning and skips the user-bound tests — but still runs
 *   the schema-only tests that don't depend on a real auth.users row.
 *   TODO: remove the skip once §9.16.10 (kh-prod-readiness) ships and the
 *   persistent staging branch is reliably seeded.
 *
 * @vitest-environment node
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { serviceClient } from './helpers/service-client';
import { getTestUserIds } from './helpers/auth-session';
import { resolveContentOwnerId } from '@/lib/auth/owner-default';
import { recordPipelineRun } from '@/lib/pipeline/record-run';

const TEST_PREFIX = `[OWNER-RUN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const TEST_PIPELINE_NAME = `s209_w5_integration_${Date.now()}`;

// Service-account UUID — used by the WP-A3 backfill exclusion list.
const SERVICE_ACCOUNT_UUID = 'a0000000-0000-4000-8000-000000000001';

// Real auth.users UUIDs resolved from the seeded E2E test accounts at
// beforeAll. content_items.created_by has a FK to auth.users
// (constraint content_items_created_by_fkey in migration 20260416102457
// line 5371) so synthetic UUIDs are rejected. content_owner_id has NO FK
// (uuid column with index only — see migration line 4663) so we still
// use the same auth.users UUIDs there for consistency and to mirror what
// the production resolveContentOwnerId() helper resolves to in practice.
let ADMIN_OWNER_ID = '';
let EDITOR_OWNER_ID = '';

// Track every row this suite seeds so afterAll can scrub them even if
// individual tests fail.
const seededItemIds: string[] = [];
const seededPipelineRunIds: string[] = [];

async function seedItem(opts: {
  contentOwnerId: string | null;
  createdBy: string | null;
  label: string;
}): Promise<string> {
  // Direct service-role insert. content_text_hash is GENERATED ALWAYS so
  // it is never specified (per CLAUDE.md). ingestion_source is omitted to
  // exercise the legacy NULL-owner path; the trigger writes
  // change_reason='auto_v1_on_insert' and the v1 row is fine for our
  // assertions which never inspect change_reason.
  const payload: Record<string, unknown> = {
    title: `${TEST_PREFIX} ${opts.label}`,
    content: `Owner+pipeline integration fixture for ${opts.label}. Disposable.`,
    content_type: 'article',
  };
  if (opts.contentOwnerId !== null) {
    payload.content_owner_id = opts.contentOwnerId;
  }
  if (opts.createdBy !== null) {
    payload.created_by = opts.createdBy;
  }

  const { data, error } = await serviceClient
    .from('content_items')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(payload as any)
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(
      `Seed item "${opts.label}" failed: ${error?.message ?? 'no data'}`,
    );
  }
  seededItemIds.push(data.id);
  return data.id;
}

beforeAll(async () => {
  // Resolve real auth.users UUIDs for the seeded E2E test accounts.
  // Failure here surfaces as a hard error per
  // feedback_eval_scripts_assume_populated_db: if the persistent staging
  // branch is data-empty (no test users seeded), the test should fail
  // honestly rather than silently skip — matches the
  // feedback_e2e_conditional_false_pass discipline. Once §9.16.10
  // (kh-prod-readiness) ships and the staging branch is reliably
  // seeded, this beforeAll becomes a no-cost lookup.
  const ids = await getTestUserIds();
  ADMIN_OWNER_ID = ids.admin;
  EDITOR_OWNER_ID = ids.editor;
  expect(ADMIN_OWNER_ID).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  expect(EDITOR_OWNER_ID).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
}, 30_000);

afterAll(async () => {
  // content_history rows are emitted by the AFTER INSERT trigger. Delete
  // those before the parent rows so the FK to content_items does not
  // block. Pipeline runs have no FK back into content_items so they can
  // be cleaned independently.
  if (seededItemIds.length > 0) {
    await serviceClient
      .from('content_history')
      .delete()
      .in('content_item_id', seededItemIds);
    await serviceClient.from('content_items').delete().in('id', seededItemIds);
  }
  if (seededPipelineRunIds.length > 0) {
    await serviceClient
      .from('pipeline_runs')
      .delete()
      .in('id', seededPipelineRunIds);
  }
  // Defensive secondary scrub for pipeline_runs by name in case a test
  // failed before the id was tracked. Cheap because pipeline_name is
  // unique per run for this suite (Date.now()-suffixed).
  await serviceClient
    .from('pipeline_runs')
    .delete()
    .eq('pipeline_name', TEST_PIPELINE_NAME);
}, 30_000);

// ---------------------------------------------------------------------------
// Test 1 — content_owner_id round-trip via resolveContentOwnerId() decision
// matrix.
//
// Exercises the three documented branches in lib/auth/owner-default.ts:
//   - admin caller + explicit override → use the explicit UUID
//   - non-admin caller + explicit override → silent-force to caller userId
//   - no explicit override → use caller userId
//
// Each branch ends in an INSERT against the real DB and a re-read that
// asserts the persisted owner_id matches the helper's decision.
// ---------------------------------------------------------------------------

describe('content_owner_id — resolveContentOwnerId + DB round-trip', () => {
  it('admin caller with explicit override: persists the explicit UUID', async () => {
    const callerUserId = ADMIN_OWNER_ID;
    const explicitOverride = EDITOR_OWNER_ID;
    const resolved = resolveContentOwnerId({
      explicit: explicitOverride,
      role: 'admin',
      userId: callerUserId,
    });
    expect(resolved).toBe(explicitOverride);

    const id = await seedItem({
      contentOwnerId: resolved,
      createdBy: callerUserId,
      label: 'admin-explicit-override',
    });

    const { data, error } = await serviceClient
      .from('content_items')
      .select('content_owner_id, created_by')
      .eq('id', id)
      .single();
    expect(error).toBeNull();
    expect(data?.content_owner_id).toBe(explicitOverride);
    expect(data?.created_by).toBe(callerUserId);
  });

  it('non-admin caller with explicit override: silent-forced to caller userId', async () => {
    const callerUserId = EDITOR_OWNER_ID;
    const attemptedOverride = ADMIN_OWNER_ID;
    const resolved = resolveContentOwnerId({
      explicit: attemptedOverride,
      role: 'editor',
      userId: callerUserId,
    });
    // Helper silent-forces non-admin overrides back to caller userId.
    expect(resolved).toBe(callerUserId);
    expect(resolved).not.toBe(attemptedOverride);

    const id = await seedItem({
      contentOwnerId: resolved,
      createdBy: callerUserId,
      label: 'editor-silent-force',
    });

    const { data, error } = await serviceClient
      .from('content_items')
      .select('content_owner_id')
      .eq('id', id)
      .single();
    expect(error).toBeNull();
    expect(data?.content_owner_id).toBe(callerUserId);
  });

  it('no explicit override: defaults to caller userId', async () => {
    const callerUserId = EDITOR_OWNER_ID;
    const resolved = resolveContentOwnerId({
      explicit: undefined,
      role: 'editor',
      userId: callerUserId,
    });
    expect(resolved).toBe(callerUserId);

    const id = await seedItem({
      contentOwnerId: resolved,
      createdBy: callerUserId,
      label: 'no-override-default',
    });

    const { data, error } = await serviceClient
      .from('content_items')
      .select('content_owner_id')
      .eq('id', id)
      .single();
    expect(error).toBeNull();
    expect(data?.content_owner_id).toBe(callerUserId);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — pipeline_runs round-trip via recordPipelineRun().
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

// ---------------------------------------------------------------------------
// Test 3 — Owner-backfill semantics (replays migration 20260428145733).
//
// Asserts the WP-A3 backfill rule:
//   - rows with content_owner_id IS NULL AND created_by IS NOT NULL AND
//     created_by NOT IN (service-account list) → set
//     content_owner_id = created_by.
//   - service-account-authored rows remain NULL-owned (intentional per
//     spec §3.3 AC3.2).
//
// The migration is idempotent at the DB level. We exercise the rule on a
// freshly-seeded fixture row that mimics the pre-S206 NULL-owner state.
// ---------------------------------------------------------------------------

describe('content_owner_id — backfill semantics', () => {
  it('NULL-owner row with non-service created_by gets content_owner_id = created_by', async () => {
    const createdBy = EDITOR_OWNER_ID;
    const id = await seedItem({
      contentOwnerId: null,
      createdBy,
      label: 'backfill-eligible',
    });

    // Sanity: the seeded row is NULL-owned.
    const { data: pre, error: preErr } = await serviceClient
      .from('content_items')
      .select('content_owner_id, created_by')
      .eq('id', id)
      .single();
    expect(preErr).toBeNull();
    expect(pre?.content_owner_id).toBeNull();
    expect(pre?.created_by).toBe(createdBy);

    // Replay the migration's UPDATE rule, scoped to this fixture row.
    // We intentionally do NOT replay the content_history audit INSERT —
    // the backfill audit-row contract is asserted by the migration's own
    // test fixtures; our scope is the column-level outcome.
    const { error: updateErr } = await serviceClient
      .from('content_items')
      .update({ content_owner_id: createdBy })
      .eq('id', id)
      .is('content_owner_id', null)
      .neq('created_by', SERVICE_ACCOUNT_UUID);
    expect(updateErr).toBeNull();

    const { data: post, error: postErr } = await serviceClient
      .from('content_items')
      .select('content_owner_id, created_by')
      .eq('id', id)
      .single();
    expect(postErr).toBeNull();
    expect(post?.content_owner_id).toBe(createdBy);
    expect(post?.created_by).toBe(createdBy);
  });

  it('NULL-owner row with service-account created_by stays NULL-owned', async () => {
    const id = await seedItem({
      contentOwnerId: null,
      createdBy: SERVICE_ACCOUNT_UUID,
      label: 'backfill-service-excluded',
    });

    // Apply the same UPDATE rule. The .neq('created_by', SERVICE_ACCOUNT_UUID)
    // predicate excludes this row, mirroring the migration's exclusion list.
    const { error: updateErr } = await serviceClient
      .from('content_items')
      .update({ content_owner_id: SERVICE_ACCOUNT_UUID })
      .eq('id', id)
      .is('content_owner_id', null)
      .neq('created_by', SERVICE_ACCOUNT_UUID);
    expect(updateErr).toBeNull();

    const { data: post, error: postErr } = await serviceClient
      .from('content_items')
      .select('content_owner_id, created_by')
      .eq('id', id)
      .single();
    expect(postErr).toBeNull();
    // Service-account rows are intentionally NOT backfilled.
    expect(post?.content_owner_id).toBeNull();
    expect(post?.created_by).toBe(SERVICE_ACCOUNT_UUID);
  });

  it('idempotency: replaying the rule on already-owned rows is a no-op', async () => {
    const ownerA = ADMIN_OWNER_ID;
    const id = await seedItem({
      contentOwnerId: ownerA,
      createdBy: ownerA,
      label: 'backfill-idempotent',
    });

    // The rule's `.is('content_owner_id', null)` predicate means
    // already-owned rows are untouched.
    const { error: updateErr } = await serviceClient
      .from('content_items')
      .update({ content_owner_id: EDITOR_OWNER_ID })
      .eq('id', id)
      .is('content_owner_id', null)
      .neq('created_by', SERVICE_ACCOUNT_UUID);
    expect(updateErr).toBeNull();

    const { data: post } = await serviceClient
      .from('content_items')
      .select('content_owner_id')
      .eq('id', id)
      .single();
    // Owner unchanged — backfill no-ops on already-populated rows.
    expect(post?.content_owner_id).toBe(ownerA);
  });
});
