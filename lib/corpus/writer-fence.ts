/**
 * lib/corpus/writer-fence.ts
 *
 * ID-138 {138.9} — cross-language writer-fence barrier primitive (TS leg).
 * TECH.md §2.6 R(ops) / §3.4 O (writer fencing); PLAN.md §2 ("Writer fencing
 * is a shared cross-language primitive"). Wraps the
 * `corpus_writer_fence_try_acquire` / `corpus_writer_fence_release` RPCs
 * (supabase/migrations/20260703160400_id138_writer_fence.sql) that gate the
 * FIVE ID-138 corpus writers — write-back ({138.12}), upload ({138.13}),
 * pull-sync ({138.14}, the cocoindex incremental walk runs UNDER the
 * pull-sync fence hold with no separate acquisition), and the id-45 ({45.7})
 * operator bulk-load — so they cannot interleave bucket/volume writes.
 *
 * TRY-SEMANTICS, NOT BLOCKING (full rationale in the migration file header):
 * a second writer that cannot acquire gets `false` back immediately rather
 * than hanging a PostgREST connection. `acquireWriterFence` returning
 * `false` is a NORMAL outcome (the fence is busy) — callers decide whether
 * to abort or retry with backoff. It is NOT thrown as an error. A thrown
 * `SupabaseError` means the RPC round trip itself failed (network/DB
 * error), a materially different failure mode.
 *
 * KNOWN LIMITATION — PostgREST session affinity (see the migration header
 * for the full writeup, and `runbooks/corpus-writer-fence.md` for the
 * operational posture): `pg_advisory_lock`/`pg_advisory_unlock` are
 * SESSION-scoped. supabase-js `.rpc()` calls are mediated by PostgREST,
 * which does not guarantee that two separate `.rpc()` invocations (one
 * acquire, a later release) land on the SAME backend Postgres connection.
 * If a release call lands on a different connection than its paired
 * acquire, `releaseWriterFence` returns `false` ("not held by this
 * session") even though the caller conceptually still holds the fence — the
 * lock then stays held on its original connection until PostgREST recycles
 * it. Keep the acquire -> work -> release window as SHORT as possible. The
 * Python leg (`scripts/cocoindex_pipeline/writer_fence.py`) does not have
 * this problem — it holds one asyncpg connection for the whole critical
 * section by construction.
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
// RPCs this file calls are authored (20260703160400_id138_writer_fence.sql)
// but NOT YET in the generated `database.types.ts` — apply is an
// owner-gated coordinated GO, and FR-003 forbids regenerating/reading that
// generated file from this Subtask. `SupabaseClient<any>` is the standard
// escape for calling a not-yet-generated RPC surface, confined to the two
// `.rpc()` call sites below — the PUBLIC functions in this file still
// accept/return the properly-typed `SupabaseClient<Database>`. DELETE this
// escape (call `.rpc()` directly on the typed client) once the coordinated
// GO regenerates types.
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
 * Try to acquire the corpus writer-fence. Returns `false` if another writer
 * currently holds it — a normal, expected outcome; this function NEVER
 * blocks. Throws `SupabaseError` on an RPC failure (network/DB error).
 *
 * @param holder optional identifier for observability (e.g. `'write-back'`,
 *   `'upload'`, `'pull-sync'`) — logged server-side by the RPC via
 *   `RAISE LOG`, never used for acquire/release logic itself.
 */
export async function acquireWriterFence(
  supabase: SupabaseClient<Database>,
  holder?: string,
): Promise<boolean> {
  const rpcClient = supabase as unknown as UntypedRpcClient;
  return sb<boolean>(
    rpcClient.rpc('corpus_writer_fence_try_acquire', {
      p_holder: holder ?? null,
    }),
    'corpus_writer_fence_try_acquire',
  );
}

/**
 * Release the corpus writer-fence. Returns `false` if this session did not
 * hold it — see the KNOWN LIMITATION note above (PostgREST session
 * affinity): a `false` result does not necessarily mean the fence was never
 * acquired by this logical caller. Throws `SupabaseError` on an RPC
 * failure.
 */
export async function releaseWriterFence(
  supabase: SupabaseClient<Database>,
  holder?: string,
): Promise<boolean> {
  const rpcClient = supabase as unknown as UntypedRpcClient;
  return sb<boolean>(
    rpcClient.rpc('corpus_writer_fence_release', {
      p_holder: holder ?? null,
    }),
    'corpus_writer_fence_release',
  );
}

/**
 * Guard a critical section with the corpus writer-fence: acquire, run `fn`,
 * always attempt release in `finally`.
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
  const acquired = await acquireWriterFence(supabase, holder);
  if (!acquired) {
    throw new WriterFenceBusyError(holder);
  }

  try {
    return await fn();
  } finally {
    try {
      await releaseWriterFence(supabase, holder);
    } catch (err) {
      logger.warn(
        { err, holder },
        'withWriterFence: releaseWriterFence failed in finally block',
      );
    }
  }
}
