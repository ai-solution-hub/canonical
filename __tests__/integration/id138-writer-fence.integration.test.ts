/**
 * ID-138 {138.9} REDESIGN (S445) / ID-128 {128.20} ISOLATION (S461) —
 * corpus_writer_fence_lease_acquire / corpus_writer_fence_lease_release
 * mutual-exclusion integration test.
 *
 * {128.20} TEST ISOLATION (this revision): this suite previously asserted
 * exclusive-acquire semantics DIRECTLY against the SHARED production fence
 * row (fence_name = public._corpus_writer_fence_lease_name() ==
 * 'id138_corpus_writer_fence') — the SAME row every real corpus writer
 * (pull-sync, write-back, upload, id-45 bulk-load, cocoindex-nightly)
 * contends for. Any real writer holding that lease at test time made the
 * exclusivity assertions below fail spuriously (empirically confirmed,
 * CI run 29147882410, S461) even though the RPC itself was working exactly
 * as designed. 20260717150000_id128_writer_fence_test_isolation.sql added
 * an OPTIONAL `p_fence_name` parameter to both RPCs (defaulting
 * server-side to the production domain when omitted, so no production
 * caller is affected) — every `.rpc()` call below now passes a per-run
 * random `TEST_FENCE_NAME`, so this suite operates on its OWN row, fully
 * decoupled from live staging activity. See that migration's header for
 * the full mechanism + the "why DROP+CREATE, not CREATE OR REPLACE"
 * rationale.
 *
 * WHY THE LEASE MECHANISM EXISTS (S445 empirical defect, prior history):
 * the original advisory-lock primitive's version of this exact test
 * (`Promise.all` of two simultaneous `.rpc()` acquire calls) FAILED live on
 * staging — both calls returned `true`, because `pg_try_advisory_lock` is
 * SESSION-scoped and PostgREST does not guarantee that two separate
 * `.rpc()` invocations land on distinct backend connections; the two
 * concurrent calls in that run landed on the SAME pooled session, where
 * the lock is reentrant. The lease mechanism fixes this at the ROW level
 * (not the session level) — see 20260704140000_id138_writer_fence_lease.sql
 * header for the full mechanism + a scratch-pg16 cross-session concurrency
 * proof that predates this live-DB suite.
 *
 * Verifies TECH.md §2.6 R(ops) + §3.4 O (writer fencing):
 *   - a solo acquire succeeds and its matching release (same token)
 *     resolves cleanly.
 *   - under REAL CONCURRENCY (`Promise.all`, two SIMULTANEOUS acquire
 *     calls, each with its OWN holder token) EXACTLY ONE of the two
 *     attempts succeeds — the core mutual-exclusion contract. Concurrency
 *     is deliberate: firing both calls at once forces PostgREST to serve
 *     them on two distinct connections (one connection cannot run two
 *     queries concurrently), which is the most demanding way to exercise
 *     cross-session contention over a stateless RPC transport — though
 *     under the lease mechanism this no longer matters for CORRECTNESS
 *     (the row-level CAS is session-agnostic by construction), it remains
 *     the strongest test we can run against a live pooled endpoint. Because
 *     this now runs against an ISOLATED per-run fence row (not the shared
 *     production row), this assertion is deterministic regardless of
 *     concurrent live-staging writer activity (ID-128 {128.20} AC-3).
 *   - both concurrent calls resolve promptly (try-semantics — neither
 *     blocks waiting for the other).
 *   - the LOSING caller's token can never release the WINNING caller's
 *     lease (fencing-token semantics) — release with a non-matching token
 *     resolves to `false`, never throws.
 *   - the WINNING caller's release (matching token) resolves to `true` and
 *     frees the lease for a subsequent acquire — a liveness assertion that
 *     is now SAFE to make (unlike the deprecated advisory-lock suite, which
 *     deliberately avoided it — the lease's exclusion depends on row state,
 *     not on which session issued which call).
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
// service-client MUST be imported first — it loads dotenv for all env vars.
import { serviceClient } from './helpers/service-client';

// TYPE ESCAPE (deliberate — mirrors id138-erasure-cascade.integration.test.ts
// / id138-admission-identity.integration.test.ts): the `p_fence_name`
// parameter added by 20260717150000_id128_writer_fence_test_isolation.sql
// is NOT reflected in the generated database.types.ts (types regen is
// deliberately deferred — {128.20} is a narrow, additive, backward
// -compatible RPC widening with no typed production caller of the new
// param; see that migration's header). `SupabaseClient<any>` is the
// standard escape for calling a param not yet in the generated surface;
// narrow this back to a typed `.rpc()` call once a future types regen
// picks up `p_fence_name` — `bun run typecheck` will then hold this file to
// the real generated shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = serviceClient as unknown as SupabaseClient<any>;

// ID-128 {128.20}: a per-test-run random fence name, isolating this suite's
// exclusive-acquire assertions from the shared production fence row (and
// from any other concurrent run of this same suite). Never the production
// domain string ('id138_corpus_writer_fence') — collision with that is the
// exact bug this Subtask fixes.
const TEST_FENCE_NAME = `id128-test-writer-fence-${crypto.randomUUID()}`;

function newToken(): string {
  return crypto.randomUUID();
}

const HAS_REQUIRED_ENV = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const describeIfEnv = HAS_REQUIRED_ENV ? describe : describe.skip;

describeIfEnv(
  'ID-138 {138.9} REDESIGN corpus_writer_fence_lease — TECH.md §2.6 R(ops), §3.4 O',
  () => {
    beforeAll(async () => {
      if (!HAS_REQUIRED_ENV) return;
      // Best-effort clear of any stray hold left by a previous crashed run.
      // Unlike the deprecated advisory-lock suite, a lease release is a
      // NO-OP unless the token matches — so a handful of blind cleanup
      // release calls with throwaway tokens accomplish nothing by
      // themselves. Instead, force-expire any stray lease by acquiring with
      // a fresh token and a near-zero TTL, then release it. If nothing was
      // held, this is simply a normal acquire+release cycle.
      const cleanupToken = newToken();
      await db.rpc('corpus_writer_fence_lease_acquire', {
        p_holder_token: cleanupToken,
        p_holder: 'test-cleanup',
        p_ttl_seconds: 1,
        p_fence_name: TEST_FENCE_NAME,
      });
      await db.rpc('corpus_writer_fence_lease_release', {
        p_holder_token: cleanupToken,
        p_holder: 'test-cleanup',
        p_fence_name: TEST_FENCE_NAME,
      });
    }, 30_000);

    it('a solo acquire succeeds and its matching release (same token) resolves true', async () => {
      const token = newToken();
      const acquire = await db.rpc('corpus_writer_fence_lease_acquire', {
        p_holder_token: token,
        p_holder: 'solo-writer',
        p_fence_name: TEST_FENCE_NAME,
      });
      expect(acquire.error).toBeNull();
      expect(acquire.data).toBe(true);

      const release = await db.rpc('corpus_writer_fence_lease_release', {
        p_holder_token: token,
        p_holder: 'solo-writer',
        p_fence_name: TEST_FENCE_NAME,
      });
      expect(release.error).toBeNull();
      expect(release.data).toBe(true);
    });

    it('under real concurrency, exactly one of two simultaneous acquire attempts succeeds (try-semantics — neither blocks)', async () => {
      const tokenA = newToken();
      const tokenB = newToken();

      const start = Date.now();
      const [a, b] = await Promise.all([
        db.rpc('corpus_writer_fence_lease_acquire', {
          p_holder_token: tokenA,
          p_holder: 'writer-a',
          p_fence_name: TEST_FENCE_NAME,
        }),
        db.rpc('corpus_writer_fence_lease_acquire', {
          p_holder_token: tokenB,
          p_holder: 'writer-b',
          p_fence_name: TEST_FENCE_NAME,
        }),
      ]);
      const elapsedMs = Date.now() - start;

      expect(a.error).toBeNull();
      expect(b.error).toBeNull();

      const outcomes = [a.data, b.data];
      expect(outcomes.filter((v) => v === true)).toHaveLength(1);
      expect(outcomes.filter((v) => v === false)).toHaveLength(1);

      // Try-semantics: neither call blocks waiting on the other, so both
      // resolve promptly rather than hanging until some lock-wait timeout.
      expect(elapsedMs).toBeLessThan(10_000);

      const winnerToken = a.data === true ? tokenA : tokenB;
      const loserToken = a.data === true ? tokenB : tokenA;

      // Fencing-token semantics: the LOSER's token can never release the
      // WINNER's lease — resolves false, never throws.
      const loserRelease = await db.rpc('corpus_writer_fence_lease_release', {
        p_holder_token: loserToken,
        p_holder: 'loser-cleanup',
        p_fence_name: TEST_FENCE_NAME,
      });
      expect(loserRelease.error).toBeNull();
      expect(loserRelease.data).toBe(false);

      // The WINNER's release (matching token) succeeds and frees the lease
      // — safe to assert here (unlike the deprecated advisory-lock suite):
      // the lease's exclusion is row-state-based, not session-based.
      const winnerRelease = await db.rpc('corpus_writer_fence_lease_release', {
        p_holder_token: winnerToken,
        p_holder: 'winner-cleanup',
        p_fence_name: TEST_FENCE_NAME,
      });
      expect(winnerRelease.error).toBeNull();
      expect(winnerRelease.data).toBe(true);
    });

    it('release with a token that was never acquired resolves false without throwing', async () => {
      const { error, data } = await db.rpc(
        'corpus_writer_fence_lease_release',
        {
          p_holder_token: newToken(),
          p_holder: 'contract-check',
          p_fence_name: TEST_FENCE_NAME,
        },
      );
      expect(error).toBeNull();
      expect(data).toBe(false);
    });
  },
);
