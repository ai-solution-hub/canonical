/**
 * {59.9} — file-first write-back adapter with compensating restore (UC1/UC4
 * file leg).
 *
 * PRODUCT PC-1 (INV-1 dual-write, path-preserved) + PC-2 (INV-2 atomic save).
 * S330 RATIFICATION 1: file-first + compensating-restore is V1 — NOT deferred
 * behind Spike#3.
 *
 * ── {138.12} T1 RE-POINT — the file leg now targets Storage, not the volume ──
 * TECH §3.3 T1/T4, §2.1 R(a), §1.3 facts 4-5 (id-138-corpus-durable-home). The
 * corpus bucket is DEMOTED (DR-025) to the kept-evidence store — the file leg
 * below PUTs bytes into the private `corpus` Supabase Storage bucket at
 * `object_key = source_documents.storage_path` (the SAME key the VPS-volume
 * write used to target), rather than rewriting a `COCOINDEX_SOURCE_PATH`-
 * joined file on disk. The VPS-volume mirror catches up on the next
 * cocoindex pull-sync ({138.14}, out of this Subtask's scope) — write-back's
 * job is only to land the canonical bytes durably in the bucket and nudge a
 * re-walk so the pipeline picks the edit up as soon as pull-sync exists.
 *
 * ── The atomicity model (INV-2) ──────────────────────────────────────────────
 * A file-backed content_item's canonical bytes live in the `corpus` bucket,
 * keyed by `source_documents.storage_path` (`flow.py:1981`
 * `"storage_path": rel_path`, where `rel_path = path.relative_to(source_path)
 * .as_posix()` — `flow.py:1574`), and that same rel_path is ALSO the uuid5
 * seed for the per-document PKs (`content_item_id = uuid5(_KH_PIPELINE_DOC_NS,
 * "ci:" + rel_path)` — `flow.py:1952`). The object key is FROZEN at first
 * bundle publication (R(a), TECH §2.1) — writing under a DIFFERENT key would
 * mint a NEW identity on the next walk and orphan the old content — INV-1's
 * "MUST NOT write to a different path" hazard. So the Storage leg PUTs to the
 * EXACT existing `storage_path`, never a derived or normalised key.
 *
 * Ordering (file-first):
 *   1. snapshot the prior object bytes (Storage download);
 *   2. PUT the new bytes to the exact object key, FENCED (`withWriterFence`,
 *      `lib/corpus/writer-fence.ts` — one of the FIVE ID-138 corpus writers
 *      serialised against bucket/volume writes); on PUT failure -> abort
 *      BEFORE the DB write, so there is exactly ONE failure state (the DB is
 *      never touched and the object is never partially ahead of the DB);
 *   3. DB leg (the {59.8} content_items + content_history write, injected as
 *      `applyDbLeg`); on DB-write failure AFTER a successful PUT ->
 *      RESTORE the prior bytes (read-then-restore compensating PUT, also
 *      fenced) so neither leg is left applied.
 *
 * This is NOT a true two-phase commit. There is a residual crash-window:
 * if the process dies between a successful PUT and the DB write (or before
 * the compensating restore completes), the bucket object is ahead of the DB.
 * That divergence is self-healing — the next cocoindex pull-sync + walk
 * recomputes `content_text_hash` from the bucket bytes and reconciles the DB
 * row, so the window closes on the following ingest rather than leaving a
 * permanent split. (Risks — documented, accepted for V1.)
 *
 * The user always sees ONE save outcome: either the save succeeded, or it
 * failed and nothing was left applied. A compensating restore that itself
 * degrades (e.g. the bucket becomes unreachable mid-save) is surfaced as a
 * non-fatal warning via the returned `warnings` list — it never masks the
 * original DB failure, which is always re-raised.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { withWriterFence } from '@/lib/corpus/writer-fence';
import { logger } from '@/lib/logger';
import { tryQuery, isOk, type PostgrestLike } from '@/lib/supabase/safe';
import type { Database } from '@/supabase/types/database.types';

/**
 * The private Supabase Storage bucket the corpus's kept-evidence bytes live
 * in (TECH §2.1 R(a); provisioned per-project by
 * `scripts/provision-corpus-bucket.ts`, {138.8}). Kept as a plain literal
 * here (not imported from `scripts/`) — app code (`lib/`, `app/`) does not
 * import from `scripts/` in this codebase; the two modules share the string
 * by convention, documented at both ends.
 */
export const CORPUS_BUCKET = 'corpus';

/**
 * MIME type stamped on every corpus object write. Write-back content is
 * always the canonical markdown source (or a `__qa__/` sidecar markdown
 * file) — mirrors the existing `text/markdown` precedent
 * (`lib/mcp/tools/content.ts:752`).
 */
const CORPUS_OBJECT_CONTENT_TYPE = 'text/markdown';

/**
 * The DB leg of the save — the caller's {59.8} content_items +
 * content_history write. Injected (rather than performed here) so the
 * adapter owns ONLY the file-first ordering and the compensating restore;
 * the canonical DB mutation stays in the items route where it already lives.
 * It is invoked exactly once, AFTER a successful Storage PUT.
 */
export type ApplyDbLeg = () => Promise<void>;

/**
 * True when a Supabase Storage error indicates the `corpus` bucket itself
 * does not exist in this project. This is the STORAGE-LEG GATING EQUIVALENT
 * of the old `COCOINDEX_SOURCE_PATH`-unset idle-mode check (TECH §2.1 R(a)
 * re-point decision, journaled on {138.12}):
 *
 *   - OLD (volume): `COCOINDEX_SOURCE_PATH` unset was a static, deploy-time
 *     env-var toggle meaning "no source-binding folder is bound here" — the
 *     file leg was skipped, DB-only.
 *   - NEW (bucket): there is no equivalent static env var — the bucket name
 *     is a fixed literal (`CORPUS_BUCKET`) and its EXISTENCE is a per-project
 *     runtime fact set by {138.8}'s provisioning script, not a deploy toggle.
 *     A project that has not yet been provisioned (local dev, CI, a
 *     not-yet-onboarded client project) is detected empirically off the
 *     Storage API's own error, mirroring the exact "Bucket not found"
 *     message-sniff idiom already used by `ensureCorpusBucket` /
 *     `ensureBrandingBucket` (`scripts/provision-corpus-bucket.ts:117-123`,
 *     `scripts/reseed-tenant-instance.ts:178-184`) — rather than inventing a
 *     new config surface that would need wiring into every deployment.
 *
 * Degrades to the SAME graceful DB-only outcome the old idle-mode check gave
 * (`fileBacked: false`, save still lands, no error surfaced). Any OTHER
 * Storage error (network, auth, quota, an object genuinely missing inside an
 * EXISTING bucket) is a real failure and is NOT treated as idle mode — it
 * aborts the save before the DB leg, preserving the one-failure-state
 * guarantee.
 */
function isBucketNotFoundError(error: { message?: string } | null): boolean {
  return !!error?.message && /bucket not found/i.test(error.message);
}

/**
 * Thrown when the `corpus` bucket does not exist in this Supabase project —
 * the Storage-leg idle-mode-equivalent (see {@link isBucketNotFoundError}).
 * Callers catch this specifically to fall through to their existing DB-only
 * path; any other thrown error is a genuine failure.
 */
export class CorpusBucketUnavailableError extends Error {
  readonly name = 'CorpusBucketUnavailableError';

  constructor(objectKey: string) {
    super(
      `corpus bucket "${CORPUS_BUCKET}" is not provisioned in this project ` +
        `(object key "${objectKey}") — Storage-leg idle-mode equivalent.`,
    );
  }
}

/** Short timeout for the fire-and-forget re-walk nudge (mirrors D-3). */
const REWALK_NUDGE_TIMEOUT_MS = 5_000;

/**
 * Fire-and-forget nudge to the cocoindex worker's `/walk` endpoint after a
 * successful Storage PUT (TECH §3.3 T1: "then nudge a re-walk"). Mirrors
 * `nudgeCocoindexWalk` (`lib/intelligence/pipeline.ts:539`, ID-75 WP-E D-3)
 * verbatim in shape — reimplemented locally rather than imported/exported
 * from `pipeline.ts`, which sits outside this Subtask's file-ownership
 * boundary. Same env-var gate (`COCOINDEX_WORKER_URL` + `CRON_SECRET`), same
 * non-fatal fire-and-forget contract: a skipped or failed nudge is a DELAY,
 * never a loss — the standing scheduled walk (and, once {138.14} lands,
 * pull-sync) bounds the latency. NEVER called on the compensating-restore
 * path (a reverted edit must not nudge a walk of stale-again content).
 */
function nudgeCorpusRewalk(objectKey: string): void {
  const workerUrl = process.env.COCOINDEX_WORKER_URL;
  if (!workerUrl) {
    logger.warn(
      { objectKey },
      '[write-back] COCOINDEX_WORKER_URL unset — skipping re-walk nudge; the edit will be picked up by the next scheduled walk.',
    );
    return;
  }
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logger.warn(
      { objectKey },
      '[write-back] CRON_SECRET unset — skipping re-walk nudge; the edit will be picked up by the next scheduled walk.',
    );
    return;
  }

  void fetch(`${workerUrl}/walk`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cronSecret}` },
    signal: AbortSignal.timeout(REWALK_NUDGE_TIMEOUT_MS),
  })
    .then((res) => {
      if (!res.ok) {
        logger.warn(
          { status: res.status, objectKey },
          '[write-back] Re-walk nudge rejected by cocoindex worker — the edit will be picked up by the next scheduled walk.',
        );
      }
    })
    .catch((err: unknown) => {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), objectKey },
        '[write-back] Re-walk nudge failed — the edit will be picked up by the next scheduled walk.',
      );
    });
}

/**
 * {59.28} — the file-first ordering core, extracted from `writeBackFileFirst`
 * so the content-leg adapter AND both Q&A sidecar emit legs ({59.29}/{59.30})
 * share ONE ordering primitive (NEW-OQ-26-1: the DRY extraction, not a
 * Q&A-local duplicate).
 *
 * {138.12} T1/T4 RE-POINT: `absPath` (an OS filesystem path) is replaced by
 * `objectKey` (the `corpus` bucket key, consumed verbatim — see the module
 * header). Both callers (`writeBackFileFirst` below, and the q_a-pairs
 * write-back branch, `app/api/q-a-pairs/[id]/route.ts`) now pass a Storage
 * object key rather than an OS-joined path, and both now supply `supabase`
 * so this primitive can call Storage + the writer-fence RPC directly.
 *
 * Invariant (file-first, compensating-restore): given a bucket object key
 * expected to ALREADY exist (the caller is write-BACKing an existing
 * object, never minting a new one — see `writeNewCorpusObject` for the
 * no-prior-object case), snapshot → PUT (fenced) → applyDbLeg →
 * restore-on-DB-failure (fenced).
 *   1. snapshot the prior object bytes (Storage download). A "bucket not
 *      found" error here throws {@link CorpusBucketUnavailableError} — the
 *      caller's Storage-leg idle-mode-equivalent fallback. Any OTHER
 *      download error (including an object missing from an EXISTING
 *      bucket — a genuine cross-store anomaly) throws as-is, BEFORE the DB
 *      leg, matching the original ENOENT-throws strictness.
 *   2. PUT the new bytes to the EXACT object key (fenced — a single Storage
 *      PUT critical section, `withWriterFence`); on failure -> throw BEFORE
 *      applyDbLeg, so the DB is never touched (one failure state).
 *   3. applyDbLeg; on DB-leg failure AFTER a successful PUT -> RESTORE the
 *      prior bytes (read-then-restore compensating PUT, also fenced) so
 *      neither leg is left applied. The restore is best-effort: if it
 *      degrades, collect a warning but ALWAYS re-raise the original DB error
 *      so the user sees ONE save outcome (the failure), never a swallowed
 *      error.
 *   4. on the happy path only, fire the re-walk nudge (never on the
 *      restore/failure path — a reverted edit must not nudge a walk of
 *      stale-again content).
 *
 * Returns the non-fatal `warnings` accrued on the happy path (currently
 * always empty — a degraded restore only ever surfaces on the thrown
 * error's `writeBackWarnings`, since a DB failure always rejects).
 */
export interface WriteFileFirstWithRestoreParams {
  supabase: SupabaseClient<Database>;
  /** The `corpus` bucket object key ≡ `storage_path` verbatim (R(a)). */
  objectKey: string;
  /** The new canonical bytes to PUT. */
  newContent: string;
  /** The DB leg. Runs exactly once, AFTER a successful PUT. */
  applyDbLeg: ApplyDbLeg;
}

export async function writeFileFirstWithRestore(
  params: WriteFileFirstWithRestoreParams,
): Promise<{ warnings: readonly string[] }> {
  const { supabase, objectKey, newContent, applyDbLeg } = params;
  const bucket = supabase.storage.from(CORPUS_BUCKET);

  // ── (1) Snapshot prior bytes (Storage download) ─────────────────────────
  const { data: priorBlob, error: downloadError } =
    await bucket.download(objectKey);
  if (downloadError) {
    if (isBucketNotFoundError(downloadError)) {
      throw new CorpusBucketUnavailableError(objectKey);
    }
    throw downloadError;
  }
  const priorBytes = priorBlob ? await priorBlob.text() : '';

  // ── (2) PUT the new bytes to the EXACT existing object key, FENCED ──────
  // On failure this throws BEFORE the DB leg — one failure state, DB untouched.
  await withWriterFence(
    supabase,
    async () => {
      const { error } = await bucket.upload(objectKey, newContent, {
        upsert: true,
        contentType: CORPUS_OBJECT_CONTENT_TYPE,
      });
      if (error) throw error;
    },
    'write-back',
  );

  // ── (3) DB leg; compensating restore on failure ────────────────────────
  const warnings: string[] = [];
  try {
    await applyDbLeg();
  } catch (dbErr) {
    // RESTORE: read-then-restore the snapshot (fenced) so neither leg is
    // left applied. The restore is best-effort — if IT degrades, collect a
    // warning but ALWAYS re-raise the original DB error so the user sees ONE
    // save outcome (the failure), never a swallowed error.
    try {
      await withWriterFence(
        supabase,
        async () => {
          const { error } = await bucket.upload(objectKey, priorBytes, {
            upsert: true,
            contentType: CORPUS_OBJECT_CONTENT_TYPE,
          });
          if (error) throw error;
        },
        'write-back-restore',
      );
    } catch (restoreErr) {
      warnings.push(
        'Save failed and the object could not be restored to its prior state — ' +
          'the next ingest/pull-sync will reconcile it.',
      );
      const augmented =
        dbErr instanceof Error
          ? dbErr
          : new Error(typeof dbErr === 'string' ? dbErr : 'Save failed');
      (augmented as Error & { writeBackWarnings?: readonly string[] }).cause =
        restoreErr;
      (
        augmented as Error & { writeBackWarnings?: readonly string[] }
      ).writeBackWarnings = warnings;
      throw augmented;
    }
    throw dbErr;
  }

  // Happy path only — see the module/function header on why the restore
  // path never nudges.
  nudgeCorpusRewalk(objectKey);

  return { warnings };
}

/**
 * {138.12} T4 — the no-prior-object counterpart to
 * `writeFileFirstWithRestore`, for the q_a-pairs MATERIALISE-ON-FIRST-EDIT
 * branch (`app/api/q-a-pairs/[id]/route.ts`, INV-13): there is no prior
 * sidecar to snapshot/restore, so this is a plain fenced PUT + happy-path
 * nudge, mirroring the original `writeFile`-then-`applyDbLeg` MATERIALISE
 * shape verbatim (a DB-leg failure after this call leaves an orphan object
 * the next walk/pull-sync reconciles — same accepted risk as before).
 *
 * `upsert: true` (not `false`) deliberately matches the ORIGINAL `writeFile`
 * call's tolerant semantics: `writeFile` always succeeds even if a stray
 * file happened to already exist at that path (e.g. a prior partial
 * materialise attempt); `upsert: false` would introduce a NEW failure mode
 * (a conflict error) that did not exist pre-re-point.
 *
 * Throws {@link CorpusBucketUnavailableError} when the bucket is not
 * provisioned in this project (Storage-leg idle-mode equivalent) — the
 * caller decides its own DB-only fallback, exactly as it did for the
 * write-back branch.
 */
export interface WriteNewCorpusObjectParams {
  supabase: SupabaseClient<Database>;
  /** The `corpus` bucket object key to mint. */
  objectKey: string;
  /** The new object's full bytes. */
  newContent: string;
}

export async function writeNewCorpusObject(
  params: WriteNewCorpusObjectParams,
): Promise<void> {
  const { supabase, objectKey, newContent } = params;
  const bucket = supabase.storage.from(CORPUS_BUCKET);

  await withWriterFence(
    supabase,
    async () => {
      const { error } = await bucket.upload(objectKey, newContent, {
        upsert: true,
        contentType: CORPUS_OBJECT_CONTENT_TYPE,
      });
      if (error) {
        if (isBucketNotFoundError(error)) {
          throw new CorpusBucketUnavailableError(objectKey);
        }
        throw error;
      }
    },
    'write-back-materialise',
  );

  nudgeCorpusRewalk(objectKey);
}

export interface WriteBackParams {
  supabase: SupabaseClient<Database>;
  /** content_item PK — used only to resolve the linked source_document. */
  contentItemId: string;
  /** The new canonical bytes to write to the file (and that the DB leg stores). */
  newContent: string;
  /** The {59.8} content_items + content_history write. Runs after the file leg. */
  applyDbLeg: ApplyDbLeg;
  /** Optional structured-log context tag for the storage_path read. */
  context?: string;
}

export interface WriteBackResult {
  /** True once both legs that apply DID apply (file leg only when fileBacked). */
  applied: true;
  /** True when the item is backed by a source_document with a storage_path. */
  fileBacked: boolean;
  /**
   * Non-fatal warnings — currently only a degraded compensating restore.
   * Empty on the happy path. Surface these via `warningsEnvelope()` at the
   * route boundary so the user still sees ONE save outcome.
   */
  warnings: readonly string[];
}

/**
 * The flat storage_path resolution shape the resolver consumes. Populated by
 * TWO plain per-table reads (content_items.source_document_id, then
 * source_documents.storage_path by PK) — NOT a PostgREST FK embed: the
 * content_items -> source_documents FK was deliberately DROPPED in migration
 * 20260602073942 (ID-64.3 BUG-E — the cocoindex autocommit write model cannot
 * satisfy cross-target FKs), so an embedded `source_documents(...)` select
 * fails with PGRST200 against the live schema (bl-286 C1 regression).
 */
interface StoragePathRow {
  source_document_id: string | null;
  storage_path: string | null;
}

/**
 * Resolve the `corpus` bucket object key for a file-backed content_item.
 *
 * {138.12} T1 RE-POINT: the object key ≡ `storage_path` verbatim — NO
 * env-rooted join. Prior to this Subtask this function joined
 * `COCOINDEX_SOURCE_PATH` (the VPS source-binding folder) with `storage_path`
 * to compute an OS filesystem path; the Storage bucket target has no
 * deploy-time root to join against (R(a): the object key freeze IS the whole
 * address). See `isBucketNotFoundError` / `CorpusBucketUnavailableError` for
 * where the old "is the target configured here" question now lives — it is
 * answered at Storage-call time (a runtime fact), not here (a structural
 * fact about the DB row).
 *
 * Returns `null` when the item is not file-backed (no source_document_id or
 * no storage_path) — the ONLY remaining reason this returns null. (Renamed
 * from `resolveAbsolutePath`; private to this module, no external callers.)
 */
function resolveObjectKey(row: StoragePathRow): string | null {
  if (!row.source_document_id || !row.storage_path) return null;
  return row.storage_path;
}

/**
 * File-first write-back with compensating restore.
 *
 * See the module header for the full atomicity model. Throws if the
 * storage_path read fails, if the Storage PUT fails (DB untouched), or if the
 * DB leg fails (object restored). On a thrown DB-leg failure the prior bytes
 * are restored before the error propagates; a degraded restore is logged as a
 * warning on the re-raised error's `writeBackWarnings` property AND would be
 * present on a successful result — but a DB failure always rejects.
 */
export async function writeBackFileFirst(
  params: WriteBackParams,
): Promise<WriteBackResult> {
  const { supabase, contentItemId, newContent, applyDbLeg, context } = params;

  // ── Resolve the file leg target ────────────────────────────────────────────
  // Step 1: read source_document_id off content_items via tryQuery
  // (lib/supabase/safe.ts) — never a raw client. A failed read aborts the
  // whole save BEFORE either leg touches anything.
  //
  // bl-286 C1: this MUST be a plain column read, NOT an embedded
  // `source_documents(storage_path)` select — the content_items ->
  // source_documents FK was dropped in migration 20260602073942 (BUG-E), so
  // PostgREST has no relationship to embed through and the embed fails with
  // PGRST200, which 500'd every content-bytes PATCH.
  const itemResolution = await tryQuery<{
    source_document_id: string | null;
  }>(
    supabase
      .from('content_items')
      .select('source_document_id')
      .eq('id', contentItemId)
      .maybeSingle() as unknown as PostgrestLike<{
      source_document_id: string | null;
    }>,
    context ?? 'edit-intent.write-back.resolve-storage-path',
  );
  if (!isOk(itemResolution)) {
    throw itemResolution.error;
  }

  const sourceDocumentId = itemResolution.data?.source_document_id ?? null;

  // ── {59.10} / PC-3 (INV-3) — source-less content_item GUARD (bl-266) ─────────
  // S330 RATIFICATION 2 + Liam steer: a content_item with NO linked
  // source_document is an ANOMALY TO GUARD, not a first-class write path. We do
  // NOT write a file, do NOT auto-create a source_document, and do NOT mint a
  // connector='mcp' storage path (the "opt-in materialise-to-file" affordance is
  // explicitly NOT built — v1.1 at most, and only if bl-266 enforcement doesn't
  // first eliminate the population). The KH-DB-only leg (the {59.8} content_items
  // + content_history write WITH edit_intent) STILL runs so the user's save
  // applies, but we emit a structured anomaly log so the source-less population
  // is observable + traceable to bl-266 (a CONSUMED cross_doc_link —
  // docs/reference/backlog/266.md; bl-266 enforces later, this slice only
  // surfaces the anomaly NOW). OQ-59-3 prod sweep sizes the population so the
  // anomaly-log volume is understood (TECH Open-item-2).
  if (!sourceDocumentId) {
    logger.warn(
      {
        event: 'source_less_content_item_edit_back',
        contentItemId,
        caller: context ?? 'edit-intent.write-back.resolve-storage-path',
      },
      'Edit-back on a source-less content_item — no source_document linked; ' +
        'wrote KH-DB-only (no file, no auto-created source_document, no mcp ' +
        'storage-path mint). Tracked to bl-266.',
    );
    await applyDbLeg();
    return { applied: true, fileBacked: false, warnings: [] };
  }

  // Step 2: resolve storage_path directly off source_documents by PK — the
  // FK-less counterpart of the former embed (see Step 1 note).
  const docResolution = await tryQuery<{ storage_path: string | null }>(
    supabase
      .from('source_documents')
      .select('storage_path')
      .eq('id', sourceDocumentId)
      .maybeSingle() as unknown as PostgrestLike<{
      storage_path: string | null;
    }>,
    context ?? 'edit-intent.write-back.resolve-storage-path',
  );
  if (!isOk(docResolution)) {
    throw docResolution.error;
  }

  // With the FK dropped, ON DELETE SET NULL no longer auto-fires — a deleted
  // source_documents row can leave content_items.source_document_id dangling.
  // Surface the dangling reference (observable, distinct from the source-less
  // anomaly) and fall through to the DB-only path so the save still lands.
  if (docResolution.data === null) {
    logger.warn(
      {
        event: 'dangling_source_document_reference',
        contentItemId,
        sourceDocumentId,
        caller: context ?? 'edit-intent.write-back.resolve-storage-path',
      },
      'Edit-back found content_items.source_document_id pointing at a ' +
        'missing source_documents row (dangling post-FK-drop, migration ' +
        '20260602073942); wrote KH-DB-only — no file leg.',
    );
    await applyDbLeg();
    return { applied: true, fileBacked: false, warnings: [] };
  }

  const objectKey = resolveObjectKey({
    source_document_id: sourceDocumentId,
    storage_path: docResolution.data.storage_path ?? null,
  });

  // ── Source-backed but no storage_path to key an object on ──────────────────
  // The item HAS a linked source_document but its storage_path is absent, so
  // there is no bucket object to write. DB-only path applies the canonical
  // {59.8} write as the single source of the save outcome.
  if (!objectKey) {
    await applyDbLeg();
    return { applied: true, fileBacked: false, warnings: [] };
  }

  // ── Storage-leg write ({59.28} extraction, {138.12} T1 re-point) ────────────
  // snapshot -> PUT (fenced) -> applyDbLeg -> restore-on-DB-failure (fenced).
  // Extracted to `writeFileFirstWithRestore` so the Q&A sidecar emit legs
  // ({59.29}/{59.30}) share the IDENTICAL ordering primitive; the content
  // adapter's observable behaviour is unchanged (its tests are the regression
  // gate). On a degraded restore the original DB error is re-raised with
  // `writeBackWarnings`; on success the (currently always empty) warnings flow
  // out on the result.
  try {
    const { warnings } = await writeFileFirstWithRestore({
      supabase,
      objectKey,
      newContent,
      applyDbLeg,
    });
    return { applied: true, fileBacked: true, warnings };
  } catch (err) {
    if (err instanceof CorpusBucketUnavailableError) {
      // Storage-leg gating equivalent of the old COCOINDEX_SOURCE_PATH-unset
      // idle mode (see resolveObjectKey / isBucketNotFoundError docs above):
      // the corpus bucket is not provisioned in this project. Graceful
      // DB-only fallback — the save still lands.
      logger.warn(
        {
          event: 'corpus_bucket_unconfigured',
          contentItemId,
          objectKey,
          caller: context ?? 'edit-intent.write-back.resolve-storage-path',
        },
        'Edit-back found no corpus bucket provisioned for this project — ' +
          'wrote KH-DB-only, no Storage leg (Storage-leg idle-mode equivalent).',
      );
      await applyDbLeg();
      return { applied: true, fileBacked: false, warnings: [] };
    }
    throw err;
  }
}
