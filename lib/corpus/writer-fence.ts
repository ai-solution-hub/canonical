/**
 * lib/corpus/writer-fence.ts
 *
 * ID-138 {138.9} REDESIGN (S445) — cross-language writer-fence barrier
 * primitive (TS leg), reworked from a session-scoped advisory lock onto a
 * pooling-agnostic row-based holder-token LEASE. TECH.md §2.6 R(ops) /
 * §3.4 O (writer fencing); PLAN.md §2 ("Writer fencing is a shared
 * cross-language primitive"). Wraps the `corpus_writer_fence_lease_acquire`
 * / `corpus_writer_fence_lease_release` RPCs
 * (supabase/migrations/20260704120000_id138_writer_fence_lease.sql) that
 * gate the FIVE ID-138 corpus writers — write-back ({138.12}), upload
 * ({138.13}), pull-sync ({138.14}, the cocoindex incremental walk runs
 * UNDER the pull-sync fence hold with no separate acquisition), and the
 * id-45 ({45.7}) operator bulk-load — so they cannot interleave
 * bucket/volume writes.
 *
 * WHY THE REDESIGN — S445 empirical defect: the original
 * `pg_try_advisory_lock`-based primitive
 * (20260703160400_id138_writer_fence.sql, now DEPRECATED) is SESSION-scoped
 * and therefore NOT mutually exclusive through PostgREST — two "concurrent"
 * `.rpc()` acquire calls were observed landing on the SAME pooled backend
 * session on staging, where `pg_try_advisory_lock` is reentrant, so BOTH
 * returned true. The lease mechanism below fixes this by making a durable
 * ROW (not a session) the source of truth: acquire is an atomic
 * `INSERT ... ON CONFLICT ... WHERE <free-or-expired> RETURNING`, which
 * Postgres serialises correctly across ANY connection/session — pooled
 * PostgREST or direct asyncpg alike (see the migration header for the full
 * mechanism + best-practice citations + scratch-pg16 concurrency proof).
 *
 * TRY-SEMANTICS, NOT BLOCKING (unchanged from the original primitive): a
 * second writer that cannot acquire gets `false` back immediately rather
 * than hanging a PostgREST connection. `acquireWriterFence` returning
 * `false` is a NORMAL outcome (the fence is busy) — callers decide whether
 * to abort or retry with backoff. It is NOT thrown as an error. A thrown
 * `SupabaseError` means the RPC round trip itself failed (network/DB
 * error), a materially different failure mode.
 *
 * FENCING-TOKEN SEMANTICS: every acquire mints a fresh `crypto.randomUUID()`
 * holder token; release must present the SAME token to succeed. A `false`
 * from `releaseWriterFence` now means "this token no longer matches the
 * lease's current holder" — either the lease already expired (TTL, default
 * 3600s server-side — see migration header for the TTL rationale) and was
 * reclaimed by a NEWER holder, or it was never held. This is a WARNING to
 * investigate, never a hard failure (a stale/crashed holder's release is a
 * safe no-op by construction — it can never release someone else's active
 * lease). `withWriterFence` mints one token per call and threads it through
 * both the acquire and the matching release, so callers never handle the
 * token directly.
 *
 * Never a raw client — `sb()` only, per CLAUDE.md.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { sb } from '@/lib/supabase/safe';
import { logger } from '@/lib/logger';

// TYPE ESCAPE (deliberate, temporary — mirrors the precedent set by the
// {138.6}/{138.7} integration tests, e.g.
// __tests__/integration/id138-erasure-cascade.integration.test.ts): the two
// RPCs this file calls are authored
// (20260704120000_id138_writer_fence_lease.sql) but NOT YET in the
// generated `database.types.ts` — apply is an owner-gated coordinated GO,
// and FR-003 forbids regenerating/reading that generated file from this
// Subtask. `SupabaseClient<any>` is the standard escape for calling a
// not-yet-generated RPC surface, confined to the two `.rpc()` call sites
// below — the PUBLIC functions in this file still accept/return the
// properly-typed `SupabaseClient<Database>`. DELETE this escape (call
// `.rpc()` directly on the typed client) once the coordinated GO
// regenerates types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UntypedRpcClient = SupabaseClient<any>;

/**
 * Thrown by `withWriterFence` when the fence could not be acquired (busy —
 * another writer holds it). Distinguish from a `SupabaseError` (RPC
 * failure) so callers can decide whether to retry-with-backoff (busy) or
 * surface an infra error (RPC failure).
 */
export class WriterFenceBusyError extends Error {
  readonly name = 'WriterFenceBusyError';

  constructor(holder?: string) {
    super(
      `corpus writer-fence busy — another writer holds it${
        holder ? ` (requested by ${holder})` : ''
      }`,
    );
  }
}

/**
 * Try to acquire the corpus writer-fence lease. Returns `false` if another
 * writer currently holds an unexpired lease — a normal, expected outcome;
 * this function NEVER blocks. Throws `SupabaseError` on an RPC failure
 * (network/DB error).
 *
 * @param holderToken a caller-generated UUID identifying THIS acquisition
 *   (fencing-token semantics) — the matching `releaseWriterFence` call MUST
 *   present the SAME token. Prefer `withWriterFence`, which mints and
 *   threads this token automatically; call this directly only if you need
 *   acquire/release as two separate steps.
 * @param holder optional identifier for observability (e.g. `'write-back'`,
 *   `'upload'`, `'pull-sync'`) — logged server-side by the RPC via
 *   `RAISE LOG`, never used for acquire/release logic itself.
 * @param ttlSeconds optional lease TTL override (server default: 3600s —
 *   see the migration header for the TTL rationale). Pass a shorter value
 *   for a known-short critical section (e.g. a single Storage PUT).
 */
export async function acquireWriterFence(
  supabase: SupabaseClient<Database>,
  holderToken: string,
  holder?: string,
  ttlSeconds?: number,
): Promise<boolean> {
  const rpcClient = supabase as unknown as UntypedRpcClient;
  return sb<boolean>(
    rpcClient.rpc('corpus_writer_fence_lease_acquire', {
      p_holder_token: holderToken,
      p_holder: holder ?? null,
      ...(ttlSeconds === undefined ? {} : { p_ttl_seconds: ttlSeconds }),
    }),
    'corpus_writer_fence_lease_acquire',
  );
}

/**
 * Release the corpus writer-fence lease. Returns `false` if `holderToken`
 * does not match the lease's CURRENT holder — fencing-token semantics: this
 * happens when the lease already expired (TTL) and was reclaimed by a
 * NEWER holder, or was never held by this token. Treat `false` as a
 * WARNING to investigate, not a hard failure — it can never mean this call
 * released someone else's active lease. Throws `SupabaseError` on an RPC
 * failure.
 */
export async function releaseWriterFence(
  supabase: SupabaseClient<Database>,
  holderToken: string,
  holder?: string,
): Promise<boolean> {
  const rpcClient = supabase as unknown as UntypedRpcClient;
  return sb<boolean>(
    rpcClient.rpc('corpus_writer_fence_lease_release', {
      p_holder_token: holderToken,
      p_holder: holder ?? null,
    }),
    'corpus_writer_fence_lease_release',
  );
}

/**
 * Guard a critical section with the corpus writer-fence: mint a fresh
 * holder token, acquire, run `fn`, always attempt release (with the SAME
 * token) in `finally`.
 *
 * PUBLIC SIGNATURE UNCHANGED across the {138.9} REDESIGN — callers wiring
 * onto this ({138.12}/{138.13}/{138.14}) need no changes.
 *
 * @throws WriterFenceBusyError if the fence could not be acquired (caller
 *   decides retry/backoff — not retried here).
 *
 * A release failure inside `finally` is logged, never masks an exception
 * thrown by `fn` (a plain try/finally in JS would otherwise let a thrown
 * release error silently replace `fn`'s original error).
 */
export async function withWriterFence<T>(
  supabase: SupabaseClient<Database>,
  fn: () => Promise<T>,
  holder?: string,
): Promise<T> {
  const holderToken = crypto.randomUUID();
  const acquired = await acquireWriterFence(supabase, holderToken, holder);
  if (!acquired) {
    throw new WriterFenceBusyError(holder);
  }

  try {
    return await fn();
  } finally {
    try {
      await releaseWriterFence(supabase, holderToken, holder);
    } catch (err) {
      logger.warn(
        { err, holder },
        'withWriterFence: releaseWriterFence failed in finally block',
      );
    }
  }
}
