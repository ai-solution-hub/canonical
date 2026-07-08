// {56.12} folder-drop upload client — ID-138 {138.13} T2 RE-POINT
//
// ── RETIREMENT (DR-020) ──────────────────────────────────────────────────
// This module used to stage bytes via POST {COCOINDEX_WORKER_URL}/stage
// (multipart file + destPath) then trigger POST /walk. DR-020 (decision
// register) confirms `/stage` is BROKEN FROM VERCEL — the Next.js app
// cannot reach the cocoindex worker's loopback-only `/stage` endpoint in
// production, so that leg never actually completed an admission for either
// caller of `stageAndWalk` (the folder-drop UI route below AND the MCP
// `create_content_item` source-less branch, `lib/mcp/tools/content.ts`).
// TECH.md §3.3 T2 retires it entirely: the upload leg becomes ONE flow —
// gate-pass (`assertCorpusRelativeDestPath`, unchanged) -> Storage PUT into
// the `corpus` bucket at `object_key = storage_path` (R(a), verbatim, the
// SAME uuid5 SEED-CONTRACT key the write-back re-point (`lib/edit-intent/
// write-back.ts`, {138.12} T1) targets) -> an admission-minted
// `source_documents` row via the M2 resolver
// (`resolve_or_mint_source_identity`, content_hash-first, R(id)). No more
// network hop to the cocoindex worker for the admission itself; ingestion
// into `content_items`/chunks/etc. still needs a later walk, which now
// depends on pull-sync ({138.14}, not yet built) to materialise the bucket
// bytes onto the VPS volume the Python engine walks — this leg's job is
// only to land the bytes + the durable identity, exactly as `write-back.ts`
// documents for its own Storage re-point.
//
// ── `stageAndWalk` name kept (deliberate) ────────────────────────────────
// The exported function name is UNCHANGED even though it no longer stages
// or walks. `lib/mcp/tools/content.ts` (`create_content_item`'s
// source-less branch) also calls this primitive via a dynamic
// `await import('@/lib/upload/folder-drop')` — invisible to static
// call-graph analysis (gitnexus found only ONE incoming edge, the route
// below; a `grep` sweep is what actually surfaces the second caller). That
// file sits OUTSIDE this Subtask's file-ownership boundary
// (`folder-drop.ts` + `app/api/ingest/folder-drop/route.ts` + their tests
// ONLY), and since DR-020 already establishes `/stage` never worked from
// Vercel for EITHER caller, keeping the exported name + a back-compatible
// input/output shape means content.ts's call site keeps compiling AND
// starts working (Storage PUT + RPC both function from Vercel — TECH §1.3
// fact 4) with ZERO edits there. `supabase` is an OPTIONAL input field for
// exactly this reason: the in-boundary route passes the authed caller's
// client (DI, mirrors the `write-back.ts` precedent); the out-of-boundary
// MCP caller omits it and gets an internally-created service-role client.
// Flagged as an out-of-scope observation for a follow-up Subtask to migrate
// content.ts onto a clearer name + explicit DI + updated response copy
// (its "materialising via pipeline... poll content_items" text predates
// the fact a real `sourceDocumentId` is now available synchronously).
//
// destPath contract (INV-1, mirrors `lib/edit-intent/write-back.ts`
// `resolveObjectKey`, renamed there from `resolveAbsolutePath` at {138.12}):
// the corpus-relative POSIX path is consumed VERBATIM — it is the uuid5 PK
// seed for the admitted row, so any re-normalisation here would mint a
// different identity downstream. This helper only REJECTS an absolute or
// `..`-escaping destPath; it never rewrites a valid relative path.
//
// Failure model: no silent failure. Every leg that can fail surfaces a
// thrown `FolderDropError` carrying the failing stage + detail. A missing
// corpus bucket is NOT treated as an idle-mode-equivalent degrade (contrast
// `write-back.ts`'s `CorpusBucketUnavailableError`, which falls through to
// a DB-only save for an EXISTING content_item edit): an upload has no prior
// durable copy anywhere, so admitting a `source_documents` row whose
// `storage_path` points at a bucket object that was never written would be
// a dangling reference from birth. This leg FAILS LOUDLY instead — the
// bytes+row apply together or not at all.
import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { CORPUS_BUCKET } from '@/lib/edit-intent/write-back';
import { logger } from '@/lib/logger';
import { sb } from '@/lib/supabase/safe';
import { createServiceClient } from '@/lib/supabase/server';
import {
  withWriterFence,
  WriterFenceBusyError,
} from '@/lib/corpus/writer-fence';
import type { Database } from '@/supabase/types/database.types';

/** Which leg of the admission flow failed — surfaced on the thrown error. */
/** @public */
export type FolderDropStage = 'destPath' | 'put' | 'identity' | 'fence';

/**
 * Retention classes assignable at the binding-admission gate (DR-025),
 * mirroring the `source_documents_retention_class_check` DB constraint
 * verbatim. `keep_and_watch` (re-walked on future syncs) and `ingest_once`
 * (extracted once, never re-walked) both apply to an actual bytes upload —
 * this module's remit. `live_connected` / `external_referenced` are
 * zero-byte connector bindings (driven by the sibling `locator`/`auth`/
 * `cadence` columns, not by an uploaded object) and are never assigned by
 * this leg; kept here only so the type stays a single source of truth
 * mirroring the DB CHECK.
 */
/** @public */
export type RetentionClass =
  | 'keep_and_watch'
  | 'ingest_once'
  | 'live_connected'
  | 'external_referenced';

/**
 * Loud, typed failure for the folder-drop upload flow. Carries the failing
 * leg plus detail so the API route can map it to an honest response (never
 * a silent accept).
 */
/** @public */
export class FolderDropError extends Error {
  readonly stage: FolderDropStage;
  readonly status?: number;
  readonly detail?: string;

  constructor(
    stage: FolderDropStage,
    message: string,
    opts?: { status?: number; detail?: string },
  ) {
    super(message);
    this.name = 'FolderDropError';
    this.stage = stage;
    this.status = opts?.status;
    this.detail = opts?.detail;
  }
}

/** Result of a successful gate-pass + Storage PUT + admission-mint pass. */
/** @public */
export interface FolderDropResult {
  /** The corpus-relative destPath, echoed verbatim (== the object key). */
  destPath: string;
  /**
   * The admission-minted (or content_hash-resolved) `source_documents.id`
   * (R(id), M2 `resolve_or_mint_source_identity`) — the durable identity a
   * caller can key follow-up reads/citations on immediately, synchronously.
   */
  sourceDocumentId: string;
  /**
   * The filename the UI correlates against `content_items.source_file` once
   * a later walk ingests this source. Basename of `destPath`.
   */
  sourceFile: string;
  /**
   * True when this call minted a brand-new identity; false when it resolved
   * to an EXISTING row by `content_hash` (idempotent re-upload of the same
   * bytes — R(id) content_hash-first resolution).
   */
  wasMinted: boolean;
}

/** Input for a single folder-drop upload admission pass. */
/** @public */
export interface StageAndWalkInput {
  /** Raw file bytes to PUT into the corpus bucket. */
  bytes: Uint8Array | ArrayBuffer;
  /** Original filename — forwarded to the M2 resolver as `p_filename`. */
  filename: string;
  /**
   * Corpus-relative destination path (POSIX). Consumed VERBATIM (uuid5 PK
   * seed, INV-1). Must be relative and must not escape the corpus. This IS
   * the Storage object key (R(a)) and the M2 resolver's `p_rel_path`.
   */
  destPath: string;
  /**
   * Unused since the /stage retirement (DR-020) — no transport forwards it
   * anywhere. Kept so existing call sites (`app/api/ingest/folder-drop/
   * route.ts`, `lib/mcp/tools/content.ts`) do not need to drop the field.
   */
  titlePrefix?: string;
  /** MIME type — stamped on the Storage object and forwarded as `p_mime_type`. */
  contentType?: string;
  /**
   * Retention class to assign at admission (DR-025). Defaults to
   * `keep_and_watch` when omitted — the pre-{131.24} behaviour, preserved
   * for the `lib/mcp/tools/content.ts` back-compat caller which does not
   * supply one.
   */
  retentionClass?: RetentionClass;
  /**
   * Supabase client for the Storage PUT + identity RPC + writer fence.
   * OPTIONAL — see the module header's "`stageAndWalk` name kept" note. The
   * in-boundary caller (`app/api/ingest/folder-drop/route.ts`) SHOULD pass
   * the authed route client (`auth.supabase`), mirroring the `write-back.ts`
   * T1 precedent. When omitted, a service-role client is created internally
   * (the `lib/mcp/tools/content.ts` MCP call site does not supply one).
   */
  supabase?: SupabaseClient<Database>;
}

/** Basename of a POSIX/Windows path — the `source_file` correlation key. */
function basename(p: string): string {
  const segments = p.split(/[\\/]/);
  return segments[segments.length - 1] ?? p;
}

/**
 * Reject an absolute or corpus-escaping destPath BEFORE any Storage/DB call.
 * A valid relative path is returned verbatim — never re-normalised (INV-1).
 */
export function assertCorpusRelativeDestPath(destPath: string): string {
  if (!destPath) {
    throw new FolderDropError(
      'destPath',
      'destPath must be a non-empty string',
    );
  }
  // Absolute (POSIX or Windows drive) — reject up front.
  if (destPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(destPath)) {
    throw new FolderDropError(
      'destPath',
      `destPath must be corpus-relative, not absolute: ${destPath}`,
    );
  }
  // `..` traversal in any segment escapes the corpus root.
  const segments = destPath.split(/[\\/]/);
  if (segments.some((s) => s === '..')) {
    throw new FolderDropError(
      'destPath',
      `destPath must not escape the corpus root: ${destPath}`,
    );
  }
  return destPath;
}

/** True when a Storage error message indicates the bucket itself is absent. */
function isBucketNotFoundMessage(message: string | undefined): boolean {
  return !!message && /bucket not found/i.test(message);
}

/** Short timeout for the fire-and-forget re-walk nudge (mirrors write-back.ts). */
const REWALK_NUDGE_TIMEOUT_MS = 5_000;

/**
 * Fire-and-forget nudge to the cocoindex worker's `/walk` endpoint after a
 * successful admission (mirrors `write-back.ts`'s `nudgeCorpusRewalk`
 * verbatim in shape — reimplemented locally rather than imported/exported,
 * since that module sits outside this Subtask's file-ownership boundary,
 * the same "reimplement across boundaries" precedent write-back.ts itself
 * documents for `lib/intelligence/pipeline.ts`'s `nudgeCocoindexWalk`).
 * Non-fatal: a skipped or failed nudge is a DELAY, never a loss — the
 * standing scheduled walk (and, once {138.14} pull-sync exists) bounds the
 * latency. Dual-accept env-var gate (ID-127.18, S436 D1): prefers the
 * dedicated `PIPELINE_TRIGGER_SECRET`, falling back to the legacy shared
 * `CRON_SECRET` during the rotation window.
 */
function nudgeCorpusRewalk(objectKey: string): void {
  const workerUrl = process.env.COCOINDEX_WORKER_URL;
  if (!workerUrl) {
    logger.warn(
      { objectKey },
      '[folder-drop] COCOINDEX_WORKER_URL unset — skipping re-walk nudge; the upload will be picked up by the next scheduled walk (once pull-sync exists).',
    );
    return;
  }
  // ID-127.18 (S436 D1): prefer the dedicated PIPELINE_TRIGGER_SECRET once
  // the env rollout has set it; fall back to the legacy shared CRON_SECRET
  // so the nudge keeps firing before every pipeline Coolify app + Vercel
  // deployment has the new secret. server.py's /walk auth dual-accepts
  // both during the transition, so either value authenticates (mirrors
  // lib/intelligence/pipeline.ts's nudgeCocoindexWalk verbatim).
  const pipelineTriggerSecret =
    process.env.PIPELINE_TRIGGER_SECRET || process.env.CRON_SECRET;
  if (!pipelineTriggerSecret) {
    logger.warn(
      { objectKey },
      '[folder-drop] PIPELINE_TRIGGER_SECRET/CRON_SECRET unset — skipping re-walk nudge; the upload will be picked up by the next scheduled walk (once pull-sync exists).',
    );
    return;
  }

  void fetch(`${workerUrl.replace(/\/$/, '')}/walk`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pipelineTriggerSecret}` },
    signal: AbortSignal.timeout(REWALK_NUDGE_TIMEOUT_MS),
  })
    .then((res) => {
      if (!res.ok) {
        logger.warn(
          { status: res.status, objectKey },
          '[folder-drop] Re-walk nudge rejected by cocoindex worker — the upload will be picked up by the next scheduled walk.',
        );
      }
    })
    .catch((err: unknown) => {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), objectKey },
        '[folder-drop] Re-walk nudge failed — the upload will be picked up by the next scheduled walk.',
      );
    });
}

/** Row shape returned by the M2 `resolve_or_mint_source_identity` resolver. */
interface ResolveOrMintRow {
  source_document_id: string;
  was_minted: boolean;
}

/**
 * Gate-pass an uploaded file, PUT its bytes into the `corpus` Storage bucket
 * at `object_key = destPath` (R(a), verbatim), and admission-mint (or
 * content_hash-resolve) its `source_documents` identity via the M2 resolver
 * — all inside ONE writer-fence hold (TECH §2.6 R(ops), §3.3 T2).
 *
 * On success returns the durable `sourceDocumentId`, the echoed `destPath`,
 * and the `sourceFile` correlation key a later walk ingests under. Retention
 * class defaults to `keep_and_watch` (R(b) — the upload default) but a
 * caller may assign any class via `input.retentionClass` (DR-025, {131.24});
 * `admission_status` defaults to `admitted` (M1 column default);
 * `logical_path := storage_path` on mint (M2, server-side).
 *
 * Idempotent: re-uploading the SAME bytes (any destPath) resolves to the
 * SAME `sourceDocumentId` with `wasMinted: false` (content_hash-first, R(id)).
 *
 * Throws a `FolderDropError` on any failure — a missing/unprovisioned corpus
 * bucket is NOT a graceful idle-mode fallback here (contrast `write-back.ts`
 * `CorpusBucketUnavailableError`): a brand-new upload with no bucket to land
 * bytes in has no legitimate "DB-only" outcome, since that would admit a
 * `source_documents` row whose object was never written. See the module
 * header for the full rationale.
 */
export async function stageAndWalk(
  input: StageAndWalkInput,
): Promise<FolderDropResult> {
  const destPath = assertCorpusRelativeDestPath(input.destPath);
  const supabase = input.supabase ?? createServiceClient();

  const bytes =
    input.bytes instanceof ArrayBuffer
      ? new Uint8Array(input.bytes)
      : input.bytes;
  // SEED-CONTRACT match with the Python pipeline's
  // `hashlib.sha256(bytes).hexdigest()` (flow.py:3793/3855) — the M2
  // resolver's content_hash-first resolution depends on both sides hashing
  // the identical raw bytes the same way.
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const fileSize = bytes.byteLength;
  const bucket = supabase.storage.from(CORPUS_BUCKET);

  let resolved: ResolveOrMintRow;
  try {
    resolved = await withWriterFence(
      supabase,
      async () => {
        // ── Storage PUT (object key ≡ storage_path verbatim, R(a)) ──────────
        // upsert:true — a re-upload of the SAME bytes at the SAME destPath
        // must succeed (idempotent), not 409.
        const { error: uploadError } = await bucket.upload(
          destPath,
          Buffer.from(bytes),
          { upsert: true, contentType: input.contentType },
        );
        if (uploadError) {
          if (isBucketNotFoundMessage(uploadError.message)) {
            throw new FolderDropError(
              'put',
              `corpus bucket "${CORPUS_BUCKET}" is not provisioned in this project — upload rejected (object key "${destPath}")`,
              { detail: uploadError.message },
            );
          }
          throw new FolderDropError(
            'put',
            `Storage PUT failed for "${destPath}"`,
            { detail: uploadError.message },
          );
        }

        // ── Admission-minted identity (M2 resolver, R(id)) ──────────────────
        // The generated RPC Args type marks `p_mime_type` as required
        // `string` even though the underlying column is NULLable — same
        // generated-type quirk `lib/mcp/tools/content.ts`'s `reference_ingest`
        // call casts around (B-25); the RPC body inserts straight into a
        // nullable column, so this cast is safe (DB is source of truth).
        const identityArgs = {
          p_content_hash: contentHash,
          p_rel_path: destPath,
          p_filename: input.filename,
          p_mime_type: input.contentType ?? null,
          p_file_size: fileSize,
          p_origin_type: 'upload',
          p_retention_class: input.retentionClass ?? 'keep_and_watch',
        };
        const rows = await sb<ResolveOrMintRow[]>(
          supabase.rpc(
            'resolve_or_mint_source_identity',
            identityArgs as unknown as Database['public']['Functions']['resolve_or_mint_source_identity']['Args'],
          ),
          'upload.admit.resolve-or-mint-source-identity',
        );
        const row = rows[0];
        if (!row) {
          throw new Error('resolve_or_mint_source_identity returned no rows');
        }
        return row;
      },
      'upload',
    );
  } catch (err) {
    if (err instanceof FolderDropError) {
      throw err;
    }
    if (err instanceof WriterFenceBusyError) {
      throw new FolderDropError(
        'fence',
        'corpus writer fence busy — retry shortly',
        { detail: err.message },
      );
    }
    throw new FolderDropError(
      'identity',
      `admission identity resolution failed for "${destPath}"`,
      { detail: err instanceof Error ? err.message : String(err) },
    );
  }

  const sourceFile = basename(destPath);

  logger.info(
    {
      destPath,
      sourceFile,
      sourceDocumentId: resolved.source_document_id,
      wasMinted: resolved.was_minted,
    },
    `[folder-drop] admitted upload — Storage PUT + source_documents ${
      resolved.was_minted ? 'minted' : 'resolved'
    }`,
  );

  // Happy path only — best-effort, non-fatal (see nudgeCorpusRewalk header).
  nudgeCorpusRewalk(destPath);

  return {
    destPath,
    sourceDocumentId: resolved.source_document_id,
    sourceFile,
    wasMinted: resolved.was_minted,
  };
}
