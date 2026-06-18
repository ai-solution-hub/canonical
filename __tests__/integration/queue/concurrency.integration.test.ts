/**
 * S223 W3-C — §5.4 background-queue worker AC-11 integration test.
 *
 * Covers AC-11 verbatim from docs/specs/background-queue-infra-spec.md
 * §8 lines 1122-1127:
 *
 *   AC-11 — Two concurrent worker invocations do not double-claim. Test
 *   spawns two parallel `claim_next_job` calls in two separate
 *   transactions → exactly one returns the row, the other returns 0
 *   rows. Vitest asserts via parallel `Promise.all` + row-id comparison
 *   that only one worker receives the job.
 *
 * The contract being asserted is the `FOR UPDATE SKIP LOCKED` clause in
 * the SQL function `public.claim_next_job` (see
 * supabase/migrations/20260416102457_pre_squash_reconciliation.sql:372-385).
 * That clause is what guarantees exactly-one-claim semantics across
 * concurrent worker invocations on the same pending row. The only way
 * to validate the locking contract is against the real database — a
 * mocked Supabase client cannot exercise PostgreSQL row-level locks, so
 * this suite hits the persistent staging branch
 * via two independent service-role clients.
 *
 * Two independent clients = two independent PostgREST connections =
 * two independent transactions on the database side. We obtain them by
 * importing the shared `serviceClient` (which dotenv-loads the env
 * vars at import time) AND building a second client inline by calling
 * `createClient` directly with the same SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY. Each `createClient` invocation yields its
 * own fetch-based PostgREST client, ensuring the two RPC calls in
 * `Promise.all` do not share a connection.
 *
 * Coverage:
 *   1. Seed exactly ONE pending row → two parallel claim_next_job →
 *      exactly one client returns the row, the other returns 0 rows.
 *      The single returned row matches the seeded id and has
 *      status='processing'.
 *   2. Symmetric/robustness case: seed TWO pending rows → two parallel
 *      claim_next_job → each call returns a distinct row (no overlap),
 *      no row returned twice.
 *
 * Spec:    docs/specs/background-queue-infra-spec.md §8 AC-11
 *          (lines 1122-1127).
 * Schema:  processing_queue table — supabase/migrations/
 *          20260416102457_pre_squash_reconciliation.sql + S221 W1
 *          (20260502233917_s221_w1_queue_infra_d1_d2_d3.sql) for
 *          idempotency_key column.
 *
 * Prerequisites:
 *   - `.env.local` with NEXT_PUBLIC_SUPABASE_URL +
 *     SUPABASE_SERVICE_ROLE_KEY pointing at the persistent staging
 *     branch. Loaded eagerly by the shared service-client helper.
 *
 * Run via: `bun run test:integration -- concurrency`
 *   (NOT picked up by `bun run test`; integration suites are split per
 *   feedback_test_runners_split.)
 *
 * Hard-expect discipline (per feedback_e2e_conditional_false_pass): no
 * conditional `if (...)` skips. The whole describe is gated by a
 * single env-presence check in `describe.skipIf` so a misconfigured
 * machine can't silently false-pass; once we're inside the suite,
 * every assertion is a hard `expect`.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { DB_OPTION } from '@/lib/supabase/schema';
import { serviceClient } from '../helpers/service-client';

// Idempotency-key prefix unique to this test run. Used both to scope
// seeded rows and to bypass the partial UNIQUE index on idempotency_key
// (status IN ('pending','processing','completed')) when multiple suites
// run in parallel against the same staging branch.
const TEST_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_PREFIX = `[S223-CONCURRENCY-${TEST_RUN_ID}]`;

// Track every seeded row so afterAll scrubs them even on test failure.
const seededRowIds: string[] = [];

// Built lazily in beforeAll so the env-presence check in describe.skipIf
// runs first. Once initialised, both clients are real, distinct PostgREST
// connections targeting the same staging project with service-role
// credentials.
let clientA: SupabaseClient<Database>;
let clientB: SupabaseClient<Database>;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const stagingReachable =
  Boolean(SUPABASE_URL) && Boolean(SUPABASE_SERVICE_ROLE_KEY);

/**
 * Insert a single pending job using the shared `serviceClient` (RLS
 * bypassed). The label feeds the idempotency_key so each seeded row is
 * unique even if seed() is called multiple times in one test run.
 */
async function seedPendingJob(label: string): Promise<string> {
  const idempotencyKey = `${TEST_PREFIX}:${label}`;
  const { data, error } = await serviceClient
    .from('processing_queue')
    .insert({
      job_type: 'embed',
      payload: { test: TEST_PREFIX, label },
      status: 'pending',
      priority: 0,
      idempotency_key: idempotencyKey,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(
      `Seed pending job "${label}" failed: ${error?.message ?? 'no data returned'}`,
    );
  }
  seededRowIds.push(data.id);
  return data.id;
}

beforeAll(async () => {
  if (!stagingReachable) return;
  // Build TWO independent service-role clients. Each createClient() call
  // returns a separate fetch-based PostgREST handle, so the two RPC
  // invocations in Promise.all run on independent HTTP connections,
  // which on the database side become independent transactions. This is
  // what AC-11 requires ("two separate transactions").
  // ID-115 (S9): route to the exposed api schema
  clientA = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    ...DB_OPTION,
  });
  clientB = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    ...DB_OPTION,
  });

  // Cross-run isolation: scrub orphan pending rows older than 10 minutes on
  // the persistent staging branch. AC-11 asserts global cardinality
  // (`totalRowsClaimed === 1`) which is only meaningful on a clean DB.
  // Prior interrupted CI runs can leak pending rows that race with the
  // seeded row. CI is serial (`fileParallelism: false`) and staging is
  // dedicated, so the 10-min age gate is safe.
  await serviceClient
    .from('processing_queue')
    .delete()
    .eq('status', 'pending')
    .lt('created_at', new Date(Date.now() - 10 * 60_000).toISOString());
});

afterAll(async () => {
  if (!stagingReachable) return;
  // Defensive: scrub by tracked id list AND by idempotency_key prefix so
  // any row that escaped the id-tracking (e.g. seeded but the test
  // crashed before pushing the id) still gets cleaned up. The
  // idempotency_key carries the unique TEST_PREFIX so this is
  // workspace-safe — no risk of clobbering rows from another test run
  // or production data.
  if (seededRowIds.length > 0) {
    await serviceClient
      .from('processing_queue')
      .delete()
      .in('id', seededRowIds);
  }
  await serviceClient
    .from('processing_queue')
    .delete()
    .like('idempotency_key', `${TEST_PREFIX}%`);
}, 30_000);

// `describe.skipIf` instead of an in-test conditional: if the staging
// project isn't reachable we skip the entire suite with a single
// honest signal, rather than embedding `if (...)` fallbacks per test
// (which would silently false-pass on an empty DB —
// feedback_e2e_conditional_false_pass).
describe.skipIf(!stagingReachable)(
  'processing_queue.claim_next_job — concurrency safety (AC-11)',
  () => {
    it('AC-11: two parallel claim_next_job on one pending row → exactly one claim, one zero-row response (spec §8 lines 1122-1127)', async () => {
      // Seed exactly one pending row. The two clients will race for it.
      const seededId = await seedPendingJob('ac11-single-row');

      // Sanity: the row exists and is pending.
      const { data: pre, error: preErr } = await serviceClient
        .from('processing_queue')
        .select('id, status')
        .eq('id', seededId)
        .single();
      expect(preErr).toBeNull();
      expect(pre?.id).toBe(seededId);
      expect(pre?.status).toBe('pending');

      // Two parallel RPC invocations on independent clients. The
      // function returns SETOF processing_queue, so the response shape
      // is { data: Row[] | null, error }.
      const [resA, resB] = await Promise.all([
        clientA.rpc('claim_next_job'),
        clientB.rpc('claim_next_job'),
      ]);

      expect(resA.error).toBeNull();
      expect(resB.error).toBeNull();

      // Type-narrow: data may be null per supabase-js's RPC return
      // type. We don't tolerate null here — the RPC always returns an
      // array (possibly empty) on success.
      const rowsA = resA.data ?? [];
      const rowsB = resB.data ?? [];
      expect(Array.isArray(rowsA)).toBe(true);
      expect(Array.isArray(rowsB)).toBe(true);

      // Hard contract on the seeded row: exactly one parallel claim hit
      // our row. This is the AC-11 invariant — `claim_next_job` cannot
      // serve the same id twice across independent transactions.
      // Filtering to seededId keeps the assertion meaningful even if a
      // sub-10-min pending row leaked past the beforeAll scrub.
      const seededClaimed = [...rowsA, ...rowsB].filter(
        (r) => r.id === seededId,
      );
      expect(seededClaimed).toHaveLength(1);

      // Global cardinality on a clean staging branch: both claims combined
      // returned exactly one row. Stronger than the seededId check; will
      // surface if scrub failed to clear staging or if a parallel CI run
      // leaks pending rows in the test window.
      const totalRowsClaimed = rowsA.length + rowsB.length;
      expect(totalRowsClaimed).toBe(1);

      // Identify the winner. Exactly one of (rowsA.length, rowsB.length)
      // must be 1 and the other 0. The XOR check is a strong
      // formulation of "exactly one wins".
      const aWon = rowsA.length === 1 && rowsB.length === 0;
      const bWon = rowsB.length === 1 && rowsA.length === 0;
      expect(aWon !== bWon).toBe(true); // logical XOR: exactly one true.

      const winningRow = aWon ? rowsA[0] : rowsB[0];

      // The winning row's id MUST match the seeded id (no other
      // pending rows were created with this prefix; if some unrelated
      // pending row existed it would still be the FIFO ordering's
      // candidate, but we asserted above that our seed is the row).
      // Equivalently: row-id comparison per AC-11.
      expect(winningRow.id).toBe(seededId);

      // The function transitioned status to 'processing' atomically
      // with the claim — that's the UPDATE in the SQL body.
      expect(winningRow.status).toBe('processing');

      // Re-read the row through the shared service client to confirm
      // the DB-side state matches what the winning RPC returned. This
      // is the observable DB state transition AC-11 cares about.
      const { data: post, error: postErr } = await serviceClient
        .from('processing_queue')
        .select('id, status, started_at')
        .eq('id', seededId)
        .single();
      expect(postErr).toBeNull();
      expect(post?.id).toBe(seededId);
      expect(post?.status).toBe('processing');
      expect(post?.started_at).not.toBeNull();
    });

    it('AC-11 (robustness): two parallel claim_next_job on two pending rows → each claim a distinct row, no overlap', async () => {
      // Seed two pending rows. With SKIP LOCKED + FIFO ordering, both
      // workers should succeed simultaneously, each picking up a
      // different row. The exact pairing (A→row1/B→row2 vs
      // A→row2/B→row1) is non-deterministic; the only guarantee is
      // that the union covers both rows and the two are distinct.
      const idOne = await seedPendingJob('ac11-two-rows-one');
      const idTwo = await seedPendingJob('ac11-two-rows-two');

      const [resA, resB] = await Promise.all([
        clientA.rpc('claim_next_job'),
        clientB.rpc('claim_next_job'),
      ]);

      expect(resA.error).toBeNull();
      expect(resB.error).toBeNull();

      const rowsA = resA.data ?? [];
      const rowsB = resB.data ?? [];

      // Each call returned exactly one row.
      expect(rowsA).toHaveLength(1);
      expect(rowsB).toHaveLength(1);

      // The two winning ids cover both seeded rows AND are distinct
      // (no double-claim).
      const winnerA = rowsA[0]!.id;
      const winnerB = rowsB[0]!.id;
      expect(winnerA).not.toBe(winnerB);
      expect(new Set([winnerA, winnerB])).toEqual(new Set([idOne, idTwo]));

      // Both rows are now 'processing' on the DB side.
      const { data: post, error: postErr } = await serviceClient
        .from('processing_queue')
        .select('id, status')
        .in('id', [idOne, idTwo])
        .order('id', { ascending: true });
      expect(postErr).toBeNull();
      expect(post).toHaveLength(2);
      for (const row of post ?? []) {
        expect(row.status).toBe('processing');
      }
    });
  },
);
