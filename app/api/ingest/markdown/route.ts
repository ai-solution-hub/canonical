// app/api/ingest/markdown/route.ts
//
// EP2 §1.11 markdown-batch UI ingest — dedicated POST route.
// Spec: docs/specs/ep2-markdown-ui-ingest-spec.md §5.1-§5.5
//   (D-D9 dedicated route resolved S199 WP3.1).
// Plan: docs/plans/§1.11-ep2-build-plan.md EP2-T4 row.
//
// Two phases:
//   - phase=analyse → read-only pre-flight; returns `{ analysis }`.
//                     No `pipeline_runs` row.
//   - phase=import  → full pipeline; orchestrator opens pipeline_runs row,
//                     inserts content_items, returns
//                     `{ pipeline_run_id, results_summary }`.
//
// Auth: admin OR editor (spec §5.3 D-1). Editors get silent-ignore on
// admin-only override flags inside the orchestrator (skip_dedup,
// auto_supersede) — the route forwards everything verbatim.
//
// `maxDuration=300` is scoped to THIS route only — EP3's
// `app/api/upload/route.ts:12` keeps `maxDuration=60` unchanged.
//
// Validation:
//   - `parseBody(BatchOptionsSchema, parsed)` for the JSON `options` field
//     (memory `feedback_validation_sweep_safeparse_ban` — never inline
//     `.safeParse`).
//   - File-shape validation is done inline (multipart File objects, not
//     a JSON body) — extension / size / count / UTF-8 decode.
//
// All pipeline_runs writes happen INSIDE `orchestrateMarkdownBatch` —
// the route is a thin delegator (spec §5.4 + plan EP2-T4 row guidance).

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

// Per-route Vercel function-duration budget. EP2 imports can take ~80-100s
// for 10 files (spec §5.4 line 587). Scoped to this route only.
export const maxDuration = 300;

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
  const auth: AuthorisedResult = await getAuthorisedClient([
    'admin',
    'editor',
  ]);
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
      const candidate = entry as { name?: unknown; size?: unknown; arrayBuffer?: unknown };
      return (
        typeof candidate.name === 'string' &&
        typeof candidate.size === 'number' &&
        typeof candidate.arrayBuffer === 'function'
      );
    });

    if (files.length === 0) {
      return badRequest("'files[]' is required and must contain at least one file");
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
      return payloadTooLarge(
        'Total batch size exceeds the 5 MB limit',
      );
    }

    // Decode each file to UTF-8. Failures → 415 per spec §5.5.
    const decodedFiles: MarkdownIngestFile[] = [];
    for (const file of files) {
      const content = await decodeUtf8(file);
      if (content === null) {
        return unsupportedMediaType(
          `File '${file.name}' is not valid UTF-8`,
        );
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

    // Map the wire shape (snake_case) to the orchestrator's camelCase
    // contract on `MarkdownBatchOptions`.
    const orchestratorOptions = {
      perFileOverrides: validatedOptions.per_file_overrides?.map((o) => ({
        filename: o.filename,
        excluded: o.excluded,
        draftOrFinal: o.draft_or_final,
        skipDedup: o.skip_dedup,
      })),
      tag: validatedOptions.batch?.tag ?? null,
      author: validatedOptions.batch?.author ?? null,
      autoSupersede: validatedOptions.batch?.auto_supersede,
    };

    const result = await orchestrateMarkdownBatch({
      phase: 'import',
      files: decodedFiles,
      supabase,
      callerUserId: user.id,
      callerRole: role === 'admin' ? 'admin' : 'editor',
      options: orchestratorOptions,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to ingest markdown batch') },
      { status: 500 },
    );
  }
}
