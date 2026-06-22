import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger, withRequestContext } from '@/lib/logger';
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

// TODO(OPS-T1): author ResponseSchema
export const POST = withRequestContext(
  defineRoute(z.unknown(), async (request: NextRequest) => {
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

      const safeName = sanitiseFilename(file.name || 'upload');
      // destPath is corpus-relative POSIX, consumed verbatim by the worker
      // (uuid5 PK seed, INV-1). Build it with POSIX join so the segment separator
      // is `/` regardless of host OS.
      const destPath = path.posix.join(DROP_SUBDIR, safeName);
      // Fail a mis-wire loudly before the bytes leave the process.
      assertCorpusRelativeDestPath(destPath);

      const bytes = await file.arrayBuffer();

      const result = await stageAndWalk({
        bytes,
        filename: safeName,
        destPath,
        titlePrefix: '',
        contentType: file.type || undefined,
      });

      logger.info(
        { sourceFile: result.sourceFile, destPath: result.destPath },
        'folder-drop staged + walk triggered',
      );

      return NextResponse.json(
        {
          sourceFile: result.sourceFile,
          destPath: result.destPath,
          stageRequestId: result.stageRequestId,
        },
        { status: 202 },
      );
    } catch (err) {
      if (err instanceof FolderDropError) {
        // A destPath mis-wire is the caller's fault (400). Every other leg
        // (config/stage/walk) is a worker-side failure → 502 Bad Gateway. The
        // message is honest about whether the bytes landed.
        const status = err.stage === 'destPath' ? 400 : 502;
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
