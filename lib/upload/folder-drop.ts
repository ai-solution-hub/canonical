// {56.12} folder-drop staging client — Path B async ingest (stage + walk)
//
// Server-side helper for the folder-drop upload flow (ID-56 Path B). It mirrors
// the cocoindex worker's wire contracts:
//
//   1. POST {COCOINDEX_WORKER_URL}/stage  — multipart { file, destPath,
//      titlePrefix } drops the raw bytes into the watched corpus dir
//      (`COCOINDEX_SOURCE_PATH`). `/stage` does NOT trigger ingestion
//      (scripts/cocoindex_pipeline/server.py `_stage_handler`, ID-83/bl-221).
//   2. POST {COCOINDEX_WORKER_URL}/walk   — bearer-gated one-shot incremental
//      corpus walk (`_walk_handler`). cocoindex is incremental, so a walk after
//      staging one file processes only the new file.
//
// The UI then polls `content_items` filtered by `source_file` = the dropped
// filename (see `hooks/useContentIngestPolling.ts`) until the row appears.
//
// destPath contract (INV-1, mirrors `lib/edit-intent/write-back.ts`
// `resolveAbsolutePath`): the corpus-relative POSIX path is consumed VERBATIM —
// it is the uuid5 PK seed for the ingested row, so any re-normalisation here
// would mint a different identity downstream. This helper only REJECTS an
// absolute or `..`-escaping destPath (the worker rejects these too with a named
// 400); it never rewrites a valid relative path.
//
// Failure model: no silent failure. Every leg that can fail surfaces a thrown
// `FolderDropError` carrying the failing stage + the worker's status/body. A
// missing `COCOINDEX_WORKER_URL` / `CRON_SECRET` is a loud configuration error,
// not a skipped no-op (this is an interactive upload — the user is waiting on
// the result, unlike the fire-and-forget walk nudge in
// `lib/intelligence/pipeline.ts`).

import { logger } from '@/lib/logger';

/** Which leg of the stage→walk flow failed — surfaced on the thrown error. */
/** @public */
export type FolderDropStage = 'config' | 'destPath' | 'stage' | 'walk';

/**
 * Loud, typed failure for the folder-drop flow. Carries the failing leg plus
 * the worker's HTTP status/body when the failure originated worker-side so the
 * API route can map it to an honest response (never a silent accept).
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

/** Result of a successful stage + walk pass. */
/** @public */
export interface FolderDropResult {
  /** The corpus-relative path the worker echoed back from /stage. */
  destPath: string;
  /** Informational request id from /stage (worker correlation). */
  stageRequestId: string;
  /**
   * The filename the UI correlates against `content_items.source_file`. This is
   * the basename of `destPath` — the value cocoindex stamps onto the ingested
   * row's `source_file` column.
   */
  sourceFile: string;
}

/** Input for a single folder-drop staging + walk pass. */
/** @public */
export interface StageAndWalkInput {
  /** Raw file bytes to stage into the corpus. */
  bytes: Uint8Array | ArrayBuffer;
  /** Original filename (used for the multipart `file` part filename). */
  filename: string;
  /**
   * Corpus-relative destination path (POSIX). Consumed VERBATIM by the worker
   * (uuid5 PK seed, INV-1). Must be relative and must not escape the corpus.
   */
  destPath: string;
  /** Informational title prefix forwarded to /stage (no in-byte injection). */
  titlePrefix?: string;
  /** Optional MIME type for the multipart `file` part. */
  contentType?: string;
}

/** Short, interactive-upload-appropriate timeouts (ms). */
const STAGE_TIMEOUT_MS = 30_000;
const WALK_TIMEOUT_MS = 10_000;

/**
 * Reject an absolute or corpus-escaping destPath BEFORE the network hop. The
 * worker performs the authoritative realpath containment check; this is the
 * fast client-side mirror so a mis-wire fails as a named `destPath` error
 * rather than a worker round-trip. A valid relative path is returned verbatim —
 * never re-normalised (INV-1).
 */
export function assertCorpusRelativeDestPath(destPath: string): string {
  if (!destPath) {
    throw new FolderDropError(
      'destPath',
      'destPath must be a non-empty string',
    );
  }
  // Absolute (POSIX or Windows drive) — the worker discards the corpus root
  // when joined with an absolute path, so reject up front.
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

/** Resolve the worker base URL + bearer secret, or throw a loud config error. */
function resolveWorkerConfig(): { workerUrl: string; cronSecret: string } {
  const workerUrl = process.env.COCOINDEX_WORKER_URL;
  if (!workerUrl) {
    throw new FolderDropError(
      'config',
      'COCOINDEX_WORKER_URL is unset — folder-drop ingest is unavailable',
    );
  }
  // Validate the scheme so a malformed or non-http(s) URL fails loudly here
  // rather than silently at fetch time.
  let parsedWorkerUrl: URL;
  try {
    parsedWorkerUrl = new URL(workerUrl);
  } catch {
    throw new FolderDropError(
      'config',
      `COCOINDEX_WORKER_URL is not a valid URL (${workerUrl}) — folder-drop ingest is unavailable`,
    );
  }
  if (
    parsedWorkerUrl.protocol !== 'http:' &&
    parsedWorkerUrl.protocol !== 'https:'
  ) {
    throw new FolderDropError(
      'config',
      `COCOINDEX_WORKER_URL must use http(s) (${parsedWorkerUrl.protocol}) — folder-drop ingest is unavailable`,
    );
  }
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new FolderDropError(
      'config',
      'CRON_SECRET is unset — /walk auth unavailable',
    );
  }
  // Trim a single trailing slash so `${workerUrl}/stage` never doubles up.
  return { workerUrl: workerUrl.replace(/\/$/, ''), cronSecret };
}

/** Basename of a POSIX/Windows path — the `source_file` correlation key. */
function basename(p: string): string {
  const segments = p.split(/[\\/]/);
  return segments[segments.length - 1] ?? p;
}

/**
 * Stage one file into the cocoindex corpus, then trigger an incremental walk.
 *
 * On success returns the echoed destPath, the stage requestId, and the
 * `sourceFile` correlation key (basename of destPath). On any failure throws a
 * `FolderDropError` carrying the failing leg — the caller (API route) is
 * responsible for mapping it to an honest HTTP response. Nothing is swallowed.
 */
export async function stageAndWalk(
  input: StageAndWalkInput,
): Promise<FolderDropResult> {
  const { workerUrl, cronSecret } = resolveWorkerConfig();
  const destPath = assertCorpusRelativeDestPath(input.destPath);

  // --- Leg 1: POST /stage (multipart file + destPath + titlePrefix) ---
  const form = new FormData();
  // Normalise to a fresh ArrayBuffer-backed view so the BlobPart type is
  // unambiguous (a Uint8Array may be SharedArrayBuffer-backed, which Blob's
  // typings reject). Slicing a Uint8Array copies into a plain ArrayBuffer.
  const bytePart: BlobPart =
    input.bytes instanceof ArrayBuffer
      ? input.bytes
      : input.bytes.slice().buffer;
  const blob = new Blob(
    [bytePart],
    input.contentType ? { type: input.contentType } : undefined,
  );
  form.append('file', blob, input.filename);
  form.append('destPath', destPath);
  if (input.titlePrefix) {
    form.append('titlePrefix', input.titlePrefix);
  }

  let stageRes: Response;
  try {
    stageRes = await fetch(`${workerUrl}/stage`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(STAGE_TIMEOUT_MS),
    });
  } catch (err) {
    throw new FolderDropError(
      'stage',
      '/stage request failed to reach the worker',
      {
        detail: err instanceof Error ? err.message : String(err),
      },
    );
  }

  if (!stageRes.ok) {
    // The body read is best-effort diagnostic context for the thrown error; a
    // failure to read it must not mask the real /stage rejection below.
    const body = await stageRes.text().catch((_err) => '');
    throw new FolderDropError(
      'stage',
      `/stage rejected the upload (${stageRes.status})`,
      {
        status: stageRes.status,
        detail: body.slice(0, 500),
      },
    );
  }

  // A non-JSON 2xx body is an unexpected worker contract break; map it to a
  // missing-destPath error below rather than throwing an opaque parse error.
  const staged = (await stageRes.json().catch((_err) => null)) as {
    destPath?: string;
    requestId?: string;
  } | null;
  if (!staged?.destPath) {
    throw new FolderDropError(
      'stage',
      '/stage returned no destPath in its response body',
    );
  }

  const echoedDestPath = staged.destPath;
  const sourceFile = basename(echoedDestPath);

  // --- Leg 2: POST /walk (bearer CRON_SECRET, incremental) ---
  // Order is load-bearing: stage MUST land the bytes before the walk enumerates
  // the corpus, otherwise the incremental walk sees nothing.
  let walkRes: Response;
  try {
    walkRes = await fetch(`${workerUrl}/walk`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cronSecret}` },
      signal: AbortSignal.timeout(WALK_TIMEOUT_MS),
    });
  } catch (err) {
    throw new FolderDropError(
      'walk',
      'file staged but /walk failed to reach the worker — ingestion not triggered',
      { detail: err instanceof Error ? err.message : String(err) },
    );
  }

  // 409 = a walk is already in flight (single-flight guard). The freshly staged
  // file WILL be picked up by the in-flight incremental walk, so 409 is a
  // SUCCESS for our purposes — the bytes are landed and a walk is running.
  if (walkRes.status === 409) {
    logger.info(
      { destPath: echoedDestPath, sourceFile },
      '[folder-drop] /walk already in flight (409) — staged file joins the running walk',
    );
    return {
      destPath: echoedDestPath,
      stageRequestId: staged.requestId ?? '',
      sourceFile,
    };
  }

  if (!walkRes.ok) {
    // Best-effort diagnostic body; read failure must not mask the /walk error.
    const body = await walkRes.text().catch((_err) => '');
    throw new FolderDropError(
      'walk',
      `file staged but /walk was rejected (${walkRes.status}) — ingestion not triggered`,
      { status: walkRes.status, detail: body.slice(0, 500) },
    );
  }

  logger.info(
    { destPath: echoedDestPath, sourceFile, stageRequestId: staged.requestId },
    '[folder-drop] staged + walk triggered',
  );

  return {
    destPath: echoedDestPath,
    stageRequestId: staged.requestId ?? '',
    sourceFile,
  };
}
