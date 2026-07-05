import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger, withRequestContext } from '@/lib/logger';
import { parseBody } from '@/lib/validation';
import {
  assertCorpusRelativeDestPath,
  FolderDropError,
  stageAndWalk,
} from '@/lib/upload/folder-drop';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { z } from 'zod';

export const maxDuration = 60;

/** Maximum file size: 50 MB (mirrors the synchronous /api/upload limit). */
const MAX_FILE_SIZE = 52_428_800;

/** Corpus subfolder the folder-drop flow stages into. */
const DROP_SUBDIR = 'folder-drop';

/**
 * Sanitise a browser-supplied filename into a single safe path segment.
 *
 * Strips any directory component (defends against a malicious `name` carrying
 * `../`), then collapses characters that are unsafe in a corpus path. The
 * RESULT becomes the basename of `destPath`, which cocoindex stamps onto
 * `content_items.source_file` — so this is also the value the UI polls on.
 */
function sanitiseFilename(raw: string): string {
  const base = path.basename(raw);
  // Keep word chars, dot, space, hyphen; replace the rest with `_`. Collapse
  // runs of whitespace. Never empty (fall back to a timestamped name).
  const cleaned = base
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : `upload-${Date.now()}`;
}

const FolderDropResponseSchema = z.object({
  sourceFile: z.string(),
  destPath: z.string(),
  // {138.13} T2 RE-POINT: the admission-minted `source_documents.id` (M2
  // resolver), returned synchronously — replaces the old /stage worker's
  // opaque `stageRequestId` correlation token (DR-020 retirement).
  sourceDocumentId: z.string(),
  wasMinted: z.boolean(),
  // ID-131.24 (G-UPLOAD-GATE, DR-025): the retention class actually applied
  // at admission — echoed back so the UI can confirm the binding choice.
  retentionClass: z.enum(['keep_and_watch', 'ingest_once']),
});

/**
 * Retention classes selectable at THIS route (DR-025). Only the two classes
 * that apply to an actual bytes upload — `live_connected` /
 * `external_referenced` are zero-byte connector bindings (driven by
 * `source_documents.locator`/`auth`/`cadence`, DR-025) with no meaningful
 * "uploaded object" and are never offered here.
 */
const UploadRetentionClassSchema = z.enum(['keep_and_watch', 'ingest_once']);

export const POST = withRequestContext(
  defineRoute(FolderDropResponseSchema, async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);

      let formData: FormData;
      try {
        formData = await request.formData();
      } catch {
        return NextResponse.json(
          { error: 'Request must be multipart/form-data with a file part' },
          { status: 400 },
        );
      }

      const file = formData.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: "Missing 'file' part in the multipart body" },
          { status: 400 },
        );
      }

      if (file.size === 0) {
        return NextResponse.json({ error: 'File is empty' }, { status: 400 });
      }
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File exceeds the ${MAX_FILE_SIZE} byte limit` },
          { status: 400 },
        );
      }

      // ID-131.24 (G-UPLOAD-GATE, DR-025): an optional retention_class form
      // field lets the caller pick the binding-admission class; omitted ->
      // stageAndWalk's own keep_and_watch default applies.
      const retentionClassRaw = formData.get('retention_class');
      let retentionClass: 'keep_and_watch' | 'ingest_once' | undefined;
      if (retentionClassRaw !== null) {
        const parsedRetention = parseBody(
          z.object({ retention_class: UploadRetentionClassSchema }),
          { retention_class: retentionClassRaw },
        );
        if (!parsedRetention.success) return parsedRetention.response;
        retentionClass = parsedRetention.data.retention_class;
      }

      const safeName = sanitiseFilename(file.name || 'upload');
      // destPath is corpus-relative POSIX, consumed verbatim by the worker
      // (uuid5 PK seed, INV-1). Build it with POSIX join so the segment separator
      // is `/` regardless of host OS.
      const destPath = path.posix.join(DROP_SUBDIR, safeName);
      // Fail a mis-wire loudly before the bytes leave the process.
      assertCorpusRelativeDestPath(destPath);

      const bytes = await file.arrayBuffer();

      // {138.13} T2 RE-POINT: gate-pass -> Storage PUT + admission-minted
      // source_documents row, in one fenced flow (DR-020 /stage retirement).
      // Pass the AUTHED route client (mirrors the write-back.ts {138.12} T1
      // precedent) rather than relying on stageAndWalk's internal
      // service-role default.
      const result = await stageAndWalk({
        bytes,
        filename: safeName,
        destPath,
        titlePrefix: '',
        contentType: file.type || undefined,
        supabase: auth.supabase,
        ...(retentionClass ? { retentionClass } : {}),
      });

      logger.info(
        {
          sourceFile: result.sourceFile,
          destPath: result.destPath,
          sourceDocumentId: result.sourceDocumentId,
          wasMinted: result.wasMinted,
          retentionClass: retentionClass ?? 'keep_and_watch',
        },
        'folder-drop admitted — Storage PUT + source_documents row',
      );

      return NextResponse.json(
        {
          sourceFile: result.sourceFile,
          destPath: result.destPath,
          sourceDocumentId: result.sourceDocumentId,
          wasMinted: result.wasMinted,
          retentionClass: retentionClass ?? 'keep_and_watch',
        },
        { status: 202 },
      );
    } catch (err) {
      if (err instanceof FolderDropError) {
        // A destPath mis-wire is the caller's fault (400). A busy writer
        // fence is a transient, retry-shortly condition (409). Every other
        // leg (put/identity) is an infra failure -> 502 Bad Gateway. The
        // message is honest about whether the bytes landed.
        const status =
          err.stage === 'destPath' ? 400 : err.stage === 'fence' ? 409 : 502;
        logger.error(
          { stage: err.stage, status: err.status, detail: err.detail },
          `folder-drop failed at the ${err.stage} stage`,
        );
        return NextResponse.json(
          { error: err.message, stage: err.stage },
          { status },
        );
      }
      logger.error({ err }, 'folder-drop ingest failed');
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Folder-drop ingest failed') },
        { status: 500 },
      );
    }
  }),
);
