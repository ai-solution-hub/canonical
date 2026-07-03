/**
 * ID-138 {138.9} — corpus_writer_fence_try_acquire / corpus_writer_fence_release
 * mutual-exclusion integration test.
 *
 * RED UNTIL GO: migration 20260703160400_id138_writer_fence.sql is AUTHORED
 * but NOT YET APPLIED (owner-gated coordinated GO; id138 serial
 * {138.5}->{138.6}->{138.7}->{138.9}). Until the GO, neither RPC exists and
 * every call below fails — that IS the expected pre-GO state, not a test bug.
 *
 * Verifies TECH.md §2.6 R(ops) + §3.4 O (writer fencing):
 *   - a solo acquire succeeds and its matching release resolves cleanly.
 *   - under REAL CONCURRENCY (`Promise.all`, two SIMULTANEOUS acquire
 *     calls) EXACTLY ONE of the two attempts succeeds — the core mutual-
 *     exclusion contract. Concurrency is deliberate: two SEQUENTIAL calls
 *     could coincidentally reuse the same PostgREST-pooled backend
 *     connection, and session-scoped advisory locks are re-entrant for the
 *     SAME session, which would make a sequential "second call is refused"
 *     assertion unreliable. Firing both calls at once forces PostgREST to
 *     serve them on two distinct connections (one connection cannot run two
 *     queries concurrently), which is the only way to deterministically
 *     exercise cross-session contention over a stateless RPC transport.
 *   - both concurrent calls resolve promptly (try-semantics — neither
 *     blocks waiting for the other; see the migration header for why a
 *     blocking `pg_advisory_lock` would be unsound here).
 *   - `release()` resolves without throwing (contract-level check only —
 *     it deliberately does NOT assert that release always frees the lock
 *     for a LATER, unrelated call: the migration header's KNOWN LIMITATION
 *     documents that PostgREST does not guarantee an acquire and a later
 *     release land on the same backend session, so a strict cross-call
 *     liveness assertion here would itself be flaky by design, not a test
 *     bug).
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
// service-client MUST be imported first — it loads dotenv for all env vars.
import { serviceClient } from './helpers/service-client';

// TYPE ESCAPE (deliberate, temporary — see file header "RED UNTIL GO", and
// mirrors id138-erasure-cascade.integration.test.ts / id138-admission-
// identity.integration.test.ts): corpus_writer_fence_try_acquire /
// corpus_writer_fence_release are authored but NOT YET in the generated
// database.types.ts — apply is an owner-gated coordinated GO, and FR-003
// forbids regenerating/reading that generated file from this Subtask.
// `SupabaseClient<any>` is the standard escape for calling a not-yet-
// generated surface; DELETE this cast (revert to the plain typed
// `serviceClient` import) once the coordinated GO regenerates types — `bun
// run typecheck` will then hold this file to the real generated shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = serviceClient as unknown as SupabaseClient<any>;

const HAS_REQUIRED_ENV = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const describeIfEnv = HAS_REQUIRED_ENV ? describe : describe.skip;

describeIfEnv(
  'ID-138 {138.9} corpus_writer_fence — TECH.md §2.6 R(ops), §3.4 O',
  () => {
    beforeAll(async () => {
      if (!HAS_REQUIRED_ENV) return;
      // Best-effort clear of any stray hold left by a previous crashed run.
      // Advisory locks are session-scoped; a hard-killed test process could
      // in principle leave one held on its backend connection until
      // PostgREST recycles it. A handful of release attempts across
      // whatever connections PostgREST happens to hand out is a pragmatic
      // mitigation, not a guarantee (see the migration header's KNOWN
      // LIMITATION) — this suite tolerates an occasional stray hold rather
      // than depending on a clean slate.
      for (let i = 0; i < 5; i += 1) {
        await db.rpc('corpus_writer_fence_release', {
          p_holder: 'test-cleanup',
        });
      }
    }, 30_000);

    it('a solo acquire succeeds and its matching release resolves cleanly', async () => {
      const acquire = await db.rpc('corpus_writer_fence_try_acquire', {
        p_holder: 'solo-writer',
      });
      expect(acquire.error).toBeNull();
      expect(acquire.data).toBe(true);

      const release = await db.rpc('corpus_writer_fence_release', {
        p_holder: 'solo-writer',
      });
      expect(release.error).toBeNull();
    });

    it('under real concurrency, exactly one of two simultaneous acquire attempts succeeds (try-semantics — neither blocks)', async () => {
      const start = Date.now();
      const [a, b] = await Promise.all([
        db.rpc('corpus_writer_fence_try_acquire', { p_holder: 'writer-a' }),
        db.rpc('corpus_writer_fence_try_acquire', { p_holder: 'writer-b' }),
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

      // Best-effort release of whichever holder actually won, so the fence
      // doesn't stay stuck for the rest of the suite.
      await db.rpc('corpus_writer_fence_release', {
        p_holder: outcomes[0] === true ? 'writer-a' : 'writer-b',
      });
    });

    it('release resolves without throwing (contract-level check — see file header for the cross-session liveness caveat)', async () => {
      const { error } = await db.rpc('corpus_writer_fence_release', {
        p_holder: 'contract-check',
      });
      expect(error).toBeNull();
    });
  },
);
