/**
 * ID-138 {138.9} REDESIGN (S445) — corpus_writer_fence_lease_acquire /
 * corpus_writer_fence_lease_release mutual-exclusion integration test.
 *
 * RED UNTIL GO: migration 20260704120000_id138_writer_fence_lease.sql is
 * AUTHORED but NOT YET APPLIED (owner-gated coordinated GO; id138 serial
 * {138.5}->{138.6}->{138.7}->{138.9}). Until the GO, neither lease RPC
 * exists and every call below fails — that IS the expected pre-GO state,
 * not a test bug. (The PRIOR advisory-lock RPCs from
 * 20260703160400_id138_writer_fence.sql ARE already applied staging+prod,
 * but this suite no longer exercises them — see the REDESIGN rationale
 * below.)
 *
 * WHY THIS SUITE WAS REWORKED (S445 empirical defect): the original
 * advisory-lock primitive's version of this exact test (`Promise.all` of
 * two simultaneous `.rpc()` acquire calls) FAILED live on staging — both
 * calls returned `true`, because `pg_try_advisory_lock` is SESSION-scoped
 * and PostgREST does not guarantee that two separate `.rpc()` invocations
 * land on distinct backend connections; the two concurrent calls in that
 * run landed on the SAME pooled session, where the lock is reentrant. The
 * lease mechanism below fixes this at the ROW level (not the session
 * level) — see 20260704120000_id138_writer_fence_lease.sql header for the
 * full mechanism + a scratch-pg16 cross-session concurrency proof that
 * predates this live-DB suite.
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
 *     the strongest test we can run against a live pooled endpoint.
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

// TYPE ESCAPE (deliberate, temporary — see file header "RED UNTIL GO", and
// mirrors id138-erasure-cascade.integration.test.ts / id138-admission-
// identity.integration.test.ts): corpus_writer_fence_lease_acquire /
// corpus_writer_fence_lease_release are authored but NOT YET in the
// generated database.types.ts — apply is an owner-gated coordinated GO, and
// FR-003 forbids regenerating/reading that generated file from this
// Subtask. `SupabaseClient<any>` is the standard escape for calling a
// not-yet-generated surface; DELETE this cast (revert to the plain typed
// `serviceClient` import) once the coordinated GO regenerates types — `bun
// run typecheck` will then hold this file to the real generated shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = serviceClient as unknown as SupabaseClient<any>;

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
      });
      await db.rpc('corpus_writer_fence_lease_release', {
        p_holder_token: cleanupToken,
        p_holder: 'test-cleanup',
      });
    }, 30_000);

    it('a solo acquire succeeds and its matching release (same token) resolves true', async () => {
      const token = newToken();
      const acquire = await db.rpc('corpus_writer_fence_lease_acquire', {
        p_holder_token: token,
        p_holder: 'solo-writer',
      });
      expect(acquire.error).toBeNull();
      expect(acquire.data).toBe(true);

      const release = await db.rpc('corpus_writer_fence_lease_release', {
        p_holder_token: token,
        p_holder: 'solo-writer',
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
        }),
        db.rpc('corpus_writer_fence_lease_acquire', {
          p_holder_token: tokenB,
          p_holder: 'writer-b',
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
      });
      expect(loserRelease.error).toBeNull();
      expect(loserRelease.data).toBe(false);

      // The WINNER's release (matching token) succeeds and frees the lease
      // — safe to assert here (unlike the deprecated advisory-lock suite):
      // the lease's exclusion is row-state-based, not session-based.
      const winnerRelease = await db.rpc('corpus_writer_fence_lease_release', {
        p_holder_token: winnerToken,
        p_holder: 'winner-cleanup',
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
        },
      );
      expect(error).toBeNull();
      expect(data).toBe(false);
    });
  },
);
