// app/api/ingest/markdown/route.ts
//
// EP2 §1.11 markdown-batch UI ingest — dedicated POST route.
// Spec sources:
//   - docs/specs/ep2-markdown-ui-ingest-spec.md §5.1-§5.5
//     (D-D9 dedicated route resolved S199 WP3.1).
//   - docs/specs/§5.4.4-ep2-markdown-batch-migration-spec.md §7.5
//     (S226 W1-IMPL queue migration: phase=import flips to 202+enqueue).
// Plan: docs/plans/§1.11-ep2-build-plan.md EP2-T4 row.
//
// Two phases (post-§5.4.4 phase asymmetry per R8):
//   - phase=analyse → SYNC — read-only pre-flight; returns 200 with
//                     `{ analysis }`. No `pipeline_runs` row. Unchanged
//                     by S226 (analyse is fast + read-only; no progress
//                     signal needed). Inherits AC-11.
//   - phase=import  → QUEUED (S226) — pre-allocates `pipelineRunId`,
//                     INSERTs `pipeline_runs` row at-enqueue (Pattern 2 +
//                     Pattern E preservation per spec §6.3), enqueues
//                     `markdown_batch` job, returns 202 with
//                     `{ job_id, pipeline_run_id, status: 'queued',
//                       deduplicated }`.
//                     The cron worker (lib/queue/dispatch.ts case
//                     'markdown_batch') invokes runMarkdownBatchJob which
//                     delegates to the existing orchestrateMarkdownBatch
//                     unchanged — Pattern E mid-flight progress writes
//                     preserved (D-10 RATIFIED MANDATORY).
//
// Auth: admin OR editor (spec §5.3 D-1). Editors get silent-ignore on
// admin-only override flags inside the orchestrator (skip_dedup,
// auto_supersede) — the route forwards everything verbatim.
//
// maxDuration=60 (S226 §10 D-7 ratified default — symmetric with §5.4.1
// + §5.4.2 producer routes). Pre-S226 the route held the AJAX connection
// open for the full sync batch (~80-100s for 10 files); post-S226 it
// pre-INSERTs the pipeline_runs row + enqueues the job in milliseconds.
//
// Validation:
//   - `parseBody(BatchOptionsSchema, parsed)` for the JSON `options` field
//     (memory `feedback_validation_sweep_safeparse_ban` — never inline
//     `.safeParse`).
//   - File-shape validation is done inline (multipart File objects, not
//     a JSON body) — extension / size / count / UTF-8 decode.
//
// pipeline_runs Pattern 2 (per spec §6.3 +
// `feedback_pipeline_runs_pattern_2_direct_update`): the producer pre-
// INSERTs the row at-enqueue using the service-role client (RLS bypass
// because pipeline_runs has admin-only INSERT and no UPDATE/DELETE
// policies — orchestrator L728-732 documents this). The orchestrator's
// at-start INSERT inside the worker idempotently adopts the pre-existing
// row via the §7.7 Path B UPSERT (D-11 ratified) so no PK collision.
//
// Idempotency (per spec §3.2 + D-9 ratified flip): the dedup formula is
//   markdown_batch:${pipelineRunId}:${YYYY-MM-DD}:${fileSetHash}
// where fileSetHash = sha256( JSON.stringify( files.sort by filename,
// then [{filename, contentSha256: sha256(contentBytes)}] ) ) sliced 16
// hex chars. D-9 RATIFIED FLIP: per-file content SHA-256 nested in the
// file-set JSON, NOT a single concatenated buffer (the original authored
// default was filenames+sizes only — flipped to per-file content hash for
// collision-resistance over memory efficiency).

import { createHash, randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  type AuthorisedResult,
} from '@/lib/auth';
import { parseBody } from '@/lib/validation';
import { safeErrorMessage } from '@/lib/error';
import {
  orchestrateMarkdownBatch,
  type MarkdownIngestFile,
} from '@/lib/ingest/markdown-orchestrator';
import { BatchOptionsSchema } from '@/lib/ingest/markdown-batch-schema';
import { enqueueQueueJob } from '@/lib/queue/enqueue';
import { buildIdempotencyKey } from '@/lib/queue/envelope';
import type { MarkdownBatchBody } from '@/lib/queue/handlers/markdown-batch';
import { sb } from '@/lib/supabase/safe';
import { createServiceClient } from '@/lib/supabase/server';
import type { Json } from '@/supabase/types/database.types';

// Per-route Vercel function-duration budget. Post-§5.4.4 the route does
// pre-conditions + INSERT + enqueue → bounded to ~seconds. 60s matches
// the §5.4.1 + §5.4.2 producer ratified default per spec §10 D-7.
export const maxDuration = 60;

/** Per-file size ceiling (D6: 1 MB). */
const MAX_FILE_SIZE_BYTES = 1_048_576;
/** Total batch size ceiling (D6: 5 MB). */
const MAX_BATCH_SIZE_BYTES = 5_242_880;
/** Per-batch file-count ceiling (spec §5.2 + §10.7). */
const MAX_FILES_PER_BATCH = 10;

/** Shorthand for a 400 response. */
function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Shorthand for a 413 response. */
function payloadTooLarge(message: string) {
  return NextResponse.json({ error: message }, { status: 413 });
}

/** Shorthand for a 415 response. */
function unsupportedMediaType(message: string) {
  return NextResponse.json({ error: message }, { status: 415 });
}

/**
 * Decode a `File` to a UTF-8 string. Returns null when the file is not
 * valid UTF-8 (spec §5.5: 415).
 *
 * `File.text()` does not throw on malformed UTF-8 — it substitutes U+FFFD
 * replacement characters silently. To detect a truly invalid encoding we
 * read the raw bytes and use `TextDecoder('utf-8', { fatal: true })`.
 */
async function decodeUtf8(file: File): Promise<string | null> {
  try {
    const buffer = await file.arrayBuffer();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return decoder.decode(new Uint8Array(buffer));
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  // ────────────────────────────────────────────────────────────────────
  // Auth: admin OR editor (spec §5.3 D-1).
  // ────────────────────────────────────────────────────────────────────
  const auth: AuthorisedResult = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) return authFailureResponse(auth);
  const { supabase, user, role } = auth;

  try {
    // ──────────────────────────────────────────────────────────────────
    // Multipart parse.
    // ──────────────────────────────────────────────────────────────────
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return badRequest('Invalid multipart form-data body');
    }

    const phaseRaw = formData.get('phase');
    if (phaseRaw !== 'analyse' && phaseRaw !== 'import') {
      return badRequest("Invalid 'phase' — must be 'analyse' or 'import'");
    }
    const phase: 'analyse' | 'import' = phaseRaw;

    // Pull files. Use `getAll('files[]')` per spec §5.2.
    //
    // Duck-type check rather than `instanceof File` — in jsdom test
    // environments the File constructor crosses realm boundaries and
    // `instanceof File` returns false even for genuine File entries. In
    // production (Vercel runtime) and in browsers, File entries always
    // expose `name` (string), `size` (number), and `arrayBuffer()`.
    const fileEntries = formData.getAll('files[]');
    const files: File[] = fileEntries.filter((entry): entry is File => {
      if (typeof entry === 'string') return false;
      if (entry === null) return false;
      const candidate = entry as {
        name?: unknown;
        size?: unknown;
        arrayBuffer?: unknown;
      };
      return (
        typeof candidate.name === 'string' &&
        typeof candidate.size === 'number' &&
        typeof candidate.arrayBuffer === 'function'
      );
    });

    if (files.length === 0) {
      return badRequest(
        "'files[]' is required and must contain at least one file",
      );
    }

    if (files.length > MAX_FILES_PER_BATCH) {
      return badRequest('Maximum 10 files per batch');
    }

    // Extension + size validation (spec §5.5).
    let totalSize = 0;
    let nonMarkdownFound = false;
    for (const file of files) {
      const lowerName = file.name.toLowerCase();
      if (!lowerName.endsWith('.md')) {
        nonMarkdownFound = true;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        return payloadTooLarge(
          `File '${file.name}' exceeds the 1 MB per-file limit`,
        );
      }
      totalSize += file.size;
    }

    if (nonMarkdownFound) {
      // Mixed batch (e.g. .md + .pdf) → 400 per spec §10.7.
      const allNonMarkdown = files.every(
        (f) => !f.name.toLowerCase().endsWith('.md'),
      );
      if (allNonMarkdown) {
        // Whole batch is non-.md → 415 per spec §5.5.
        return unsupportedMediaType(
          'Markdown batch mode requires all files to be .md',
        );
      }
      return badRequest('Markdown batch mode requires all files to be .md');
    }

    if (totalSize > MAX_BATCH_SIZE_BYTES) {
      return payloadTooLarge('Total batch size exceeds the 5 MB limit');
    }

    // Decode each file to UTF-8. Failures → 415 per spec §5.5.
    const decodedFiles: MarkdownIngestFile[] = [];
    for (const file of files) {
      const content = await decodeUtf8(file);
      if (content === null) {
        return unsupportedMediaType(`File '${file.name}' is not valid UTF-8`);
      }
      decodedFiles.push({
        filename: file.name,
        content,
        sizeBytes: file.size,
      });
    }

    // ──────────────────────────────────────────────────────────────────
    // Phase routing.
    // ──────────────────────────────────────────────────────────────────
    if (phase === 'analyse') {
      // Analyse phase: no options validation required (per spec §5.2 the
      // analyse phase has no options field). Read-only — orchestrator
      // does NOT write a pipeline_runs row.
      const result = await orchestrateMarkdownBatch({
        phase: 'analyse',
        files: decodedFiles,
        supabase,
      });
      return NextResponse.json(result, { status: 200 });
    }

    // Import phase: parse + validate the optional `options` JSON field.
    const optionsRaw = formData.get('options');
    let parsedOptions: unknown = {};
    if (typeof optionsRaw === 'string' && optionsRaw.length > 0) {
      try {
        parsedOptions = JSON.parse(optionsRaw);
      } catch {
        return badRequest("'options' is not valid JSON");
      }
    }

    const optionsValidation = parseBody(BatchOptionsSchema, parsedOptions);
    if (!optionsValidation.success) {
      return optionsValidation.response;
    }
    const validatedOptions = optionsValidation.data;

    // ──────────────────────────────────────────────────────────────────
    // S226 §5.4.4 W1-IMPL: phase=import is QUEUED.
    //
    // Pattern E client-UUID flow (S212 W2 + spec §7.5): adopt
    // validatedOptions.pipeline_run_id when the UI pre-generates one;
    // else generate fresh server-side. Either way, the UI polls against
    // /api/pipeline-runs/[id] using the SAME UUID.
    // ──────────────────────────────────────────────────────────────────
    const pipelineRunId = validatedOptions.pipeline_run_id ?? randomUUID();
    const callerRole: 'admin' | 'editor' =
      role === 'admin' ? 'admin' : 'editor';

    // ──────────────────────────────────────────────────────────────────
    // Pre-INSERT pipeline_runs row at-enqueue (Pattern 2 per spec §6.3 +
    // `feedback_pipeline_runs_pattern_2_direct_update`).
    //
    // Uses the service-role client because pipeline_runs has admin-only
    // INSERT and NO UPDATE/DELETE policies — the orchestrator at L728-732
    // documents the same RLS chokepoint. Pre-INSERTing here means the UI
    // polling endpoint resolves the row from t=0, before the cron worker
    // has even claimed the job (Pattern E preservation per D-10 RATIFIED).
    //
    // The orchestrator's at-start INSERT inside the worker uses the
    // §7.7 Path B UPSERT (D-11 ratified) so this pre-INSERT does not
    // collide on the primary key.
    // ──────────────────────────────────────────────────────────────────
    const serviceClient = createServiceClient();
    const initialProgress = {
      step: 'enqueued',
      files_completed: 0,
      files_total: decodedFiles.length,
      detail: `Queued ${decodedFiles.length} file(s); awaiting worker claim…`,
    } as const;
    await sb(
      serviceClient
        .from('pipeline_runs')
        .insert({
          id: pipelineRunId,
          pipeline_name: 'upload_markdown_batch',
          status: 'running',
          started_at: new Date(Date.now()).toISOString(),
          created_by: user.id,
          progress: initialProgress as unknown as Json,
          items_created: [] as string[],
        })
        .select('id'),
      'markdown_batch.producer.pipeline_runs.insert',
    );

    // ──────────────────────────────────────────────────────────────────
    // Compute fileSetHash per spec §3.2 + §10 D-9 RATIFIED FLIP.
    //
    // Verbatim from spec §10 D-9 (ratified):
    //   "Full file content (SHA-256 of concatenated content) — collision-
    //    resistant. Cost: buffers all 10 MB of file content into the hash
    //    buffer. Memory cost is ~10 MB peak per enqueue (briefly). For
    //    10-file batches at 1 MB/file this is well within Lambda memory
    //    budget; no real cost. Liam may prefer this for collision-
    //    resistance peace-of-mind."
    //
    // The fileSetHash is SHA-256( JSON.stringify( files.sort by filename,
    // then [{filename, contentSha256: sha256(contentBytes)}] ) ) sliced
    // 16 hex chars. Per-file content SHA-256 is nested in the file-set
    // JSON, NOT a single concatenated buffer (avoids buffer-allocation
    // peak; each per-file digest is a constant 32-byte hash regardless
    // of file size).
    // ──────────────────────────────────────────────────────────────────
    const fileSetCanonical = decodedFiles
      .map((f) => ({
        filename: f.filename,
        contentSha256: createHash('sha256')
          .update(f.content, 'utf8')
          .digest('hex'),
      }))
      .sort((a, b) => a.filename.localeCompare(b.filename));
    const fileSetHash = createHash('sha256')
      .update(JSON.stringify(fileSetCanonical))
      .digest('hex')
      .slice(0, 16);

    // Idempotency formula per spec §3.2:
    //   markdown_batch:${pipelineRunId}:${YYYY-MM-DD}:${fileSetHash}
    // Date bucket is mandatory (per infra spec §5.5 + Liam D-1 ratified).
    const idempotencyKey = buildIdempotencyKey({
      jobType: 'markdown_batch',
      scopedId: pipelineRunId,
      requestHash: fileSetHash,
    });

    // ──────────────────────────────────────────────────────────────────
    // Enqueue the markdown_batch job.
    // ──────────────────────────────────────────────────────────────────
    const body: MarkdownBatchBody = {
      files: decodedFiles.map((f) => ({
        filename: f.filename,
        content: f.content,
        sizeBytes: f.sizeBytes ?? Buffer.byteLength(f.content, 'utf8'),
      })),
      pipeline_run_id: pipelineRunId,
      caller_user_id: user.id,
      caller_role: callerRole,
      ...(validatedOptions.batch ? { batch: validatedOptions.batch } : {}),
      ...(validatedOptions.per_file_overrides
        ? { per_file_overrides: validatedOptions.per_file_overrides }
        : {}),
    };

    const enqueueResult = await enqueueQueueJob({
      supabase,
      jobType: 'markdown_batch',
      body,
      authContext: {
        user_id: user.id,
        role: callerRole,
        // workspace_id omitted — markdown-batch has no stable workspace
        // UUID per spec §3.4 (inherits §5.4.2 D-8 ratified default).
      },
      idempotencyKey,
      pipelineRunId,
      priority: 0,
      maxAttempts: 3,
    });

    return NextResponse.json(
      {
        job_id: enqueueResult.jobId,
        pipeline_run_id: pipelineRunId,
        status: 'queued',
        deduplicated: enqueueResult.deduplicated,
      },
      { status: 202 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to ingest markdown batch') },
      { status: 500 },
    );
  }
}
