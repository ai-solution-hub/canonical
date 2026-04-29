/**
 * Shared fetch helpers for TanStack Query.
 *
 * Wrap fetch() with standard error handling so individual hooks don't need
 * to repeat the pattern.
 */

/** API error with optional code + structured payload for differentiated handling. */
export class ApiError extends Error {
  readonly code: string | undefined;
  readonly status: number;
  readonly data: Record<string, unknown> | undefined;

  constructor(
    message: string,
    status: number,
    code?: string,
    data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

/** Fetch JSON from an API route, throwing ApiError on non-OK responses. */
export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch((_err) => ({}));
    const data = body as Record<string, unknown>;
    const message =
      (data.error as string) ??
      (data.message as string) ??
      `Request failed: ${res.status}`;
    const code = data.code as string | undefined;
    throw new ApiError(message, res.status, code, data);
  }
  return res.json() as Promise<T>;
}

/**
 * POST/PATCH/DELETE JSON to an API route, throwing on non-OK responses.
 *
 * Use inside `useMutation({ mutationFn })` to keep mutation handlers DRY.
 * Defaults to POST if no method is specified in `init`.
 */
/** Fetch per-item provenance data (admin-only). */
export async function fetchItemProvenance(id: string) {
  return fetchJson<
    import('@/lib/provenance/item-provenance').ItemProvenanceResponse
  >(`/api/provenance/item/${id}`);
}

/** Response shape for GET /api/admin/taxonomy-sync/status */
export interface TaxonomySyncStatus {
  in_sync: boolean;
  last_sync_at: string | null;
  current_hash: string;
  synced_hash: string | null;
}

/** Fetch taxonomy sync drift-detection status (admin-only). */
export async function fetchTaxonomySyncStatus(): Promise<TaxonomySyncStatus> {
  return fetchJson<TaxonomySyncStatus>('/api/admin/taxonomy-sync/status');
}

// ---------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------

/** Shape returned by GET/PUT /api/notifications/preferences */
export interface NotificationPreferences {
  email_weekly_change_report: boolean;
  email_review_assigned: boolean;
  email_owned_content_flagged: boolean;
  auto_generate_change_reports: boolean;
  updated_at: string | null;
}

/** Fetch the current user's notification preferences. */
export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  const result = await fetchJson<{ preferences: NotificationPreferences }>(
    '/api/notifications/preferences',
  );
  return result.preferences;
}

/** Update one or more notification preference booleans. */
export async function updateNotificationPreferences(
  body: Partial<
    Pick<
      NotificationPreferences,
      | 'email_weekly_change_report'
      | 'email_review_assigned'
      | 'email_owned_content_flagged'
      | 'auto_generate_change_reports'
    >
  >,
): Promise<NotificationPreferences> {
  const result = await fetchJson<{ preferences: NotificationPreferences }>(
    '/api/notifications/preferences',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return result.preferences;
}

// ---------------------------------------------------------------------------
// EP2 §1.11 markdown-batch ingest fetchers
// ---------------------------------------------------------------------------
//
// Both endpoints POST multipart form-data to /api/ingest/markdown — the route
// rejects JSON bodies (it calls req.formData()). Files are sent as `files[]`
// and the import-phase options blob is JSON-stringified into the `options`
// field per spec §5.2.
//
// Wire shape uses snake_case (see lib/ingest/markdown-batch-schema.ts) — the
// route maps to camelCase before calling the orchestrator.

import type {
  MarkdownIngestAnalysis,
  MarkdownBatchResultsSummary,
} from '@/types/ingest';

/** Per-file override on the wire (snake_case mirror of MarkdownPerFileOverride). */
export interface MarkdownPerFileOverrideWire {
  filename: string;
  excluded?: boolean;
  draft_or_final?: 'draft' | 'final';
  /** Admin-only — silently ignored for editors per spec §8.2. */
  skip_dedup?: boolean;
}

/** Batch-wide options on the wire (mirror of MarkdownBatchOptions.batch). */
export interface MarkdownBatchWireOptions {
  per_file_overrides?: MarkdownPerFileOverrideWire[];
  batch?: {
    tag?: string | null;
    author?: string | null;
    /** Admin-only — silently ignored for editors per spec §5.2. */
    auto_supersede?: boolean;
  };
  /**
   * Pre-generated pipeline_run_id (Pattern E client-UUID flow — S212 W2).
   * The client generates `crypto.randomUUID()` BEFORE firing the import
   * mutation so polling against `GET /api/pipeline-runs/[id]` can begin
   * immediately. The server's at-start INSERT adopts this id verbatim.
   */
  pipeline_run_id?: string;
}

/** Throw an ApiError parsed from a non-OK fetch response. */
async function throwApiError(res: Response): Promise<never> {
  // Body may be empty / non-JSON for some error responses; the catch is the
  // intentional fall-back path (NOT a silent swallow — control immediately
  // re-throws with a synthetic ApiError below).
  const body = await res.json().catch((_err) => ({}));
  const data = body as Record<string, unknown>;
  const message =
    (data.error as string) ??
    (data.message as string) ??
    `Request failed: ${res.status}`;
  const code = data.code as string | undefined;
  throw new ApiError(message, res.status, code, data);
}

// ---------------------------------------------------------------------------
// Pipeline runs — single-row polling (S212 W2 Pattern E)
// ---------------------------------------------------------------------------
//
// The markdown-batch importer (and any future Pattern E pipeline) generates a
// pipeline_run_id client-side BEFORE firing the import mutation, then polls
// `GET /api/pipeline-runs/[id]` on a 1.5s interval to surface progress
// (`progress.detail`, `progress.files_completed/files_total`) until the
// mutation resolves. `fetchPipelineRun` tolerates 404 by returning null so
// the polling query can survive the racy at-start window where the
// server's INSERT hasn't landed yet (~sub-100ms after mutation send).

/** Row shape returned by GET /api/pipeline-runs/[id]. */
export interface PipelineRunRow {
  id: string;
  pipeline_name: string;
  status: 'running' | 'completed' | 'completed_with_errors' | 'failed';
  progress: {
    step?: string;
    steps_completed?: number;
    steps_total?: number;
    files_completed?: number;
    files_total?: number;
    detail?: string;
    [k: string]: unknown;
  } | null;
  source_filename: string | null;
  items_created: string[] | null;
  items_processed: number | null;
  workspace_id: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
  created_by: string | null;
  result: unknown;
}

/**
 * Fetch a single `pipeline_runs` row by id. Returns `null` on 404 so polling
 * can tolerate the racy at-start window where the row has not yet been
 * inserted by the server (Pattern E: client generates the id BEFORE the
 * import mutation; the server's at-start INSERT lands shortly after).
 *
 * Any other error status throws an `ApiError` so the caller can surface
 * the failure (auth/role/network/server).
 */
export async function fetchPipelineRun(
  id: string,
): Promise<PipelineRunRow | null> {
  try {
    return await fetchJson<PipelineRunRow>(`/api/pipeline-runs/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Analyse-phase fetcher — POST multipart to /api/ingest/markdown with
 * phase='analyse'. Returns per-file MarkdownIngestAnalysis records.
 *
 * Read-only: orchestrator does NOT open a pipeline_runs row.
 */
export async function analyseMarkdownBatch(
  files: File[],
): Promise<{ analysis: MarkdownIngestAnalysis[] }> {
  const formData = new FormData();
  formData.append('phase', 'analyse');
  for (const file of files) {
    formData.append('files[]', file);
  }
  const res = await fetch('/api/ingest/markdown', {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<{ analysis: MarkdownIngestAnalysis[] }>;
}

/**
 * Import-phase fetcher — POST multipart to /api/ingest/markdown with
 * phase='import' + options JSON-stringified. Blocks for ~80-100s while the
 * orchestrator runs the per-file pipeline (spec §4.4 / §7.2 Pattern E).
 */
export async function importMarkdownBatch(args: {
  files: File[];
  options: MarkdownBatchWireOptions;
}): Promise<{
  pipeline_run_id: string;
  results_summary: MarkdownBatchResultsSummary;
}> {
  const { files, options } = args;
  const formData = new FormData();
  formData.append('phase', 'import');
  for (const file of files) {
    formData.append('files[]', file);
  }
  formData.append('options', JSON.stringify(options));
  const res = await fetch('/api/ingest/markdown', {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<{
    pipeline_run_id: string;
    results_summary: MarkdownBatchResultsSummary;
  }>;
}

export async function mutationFetchJson<T>(
  url: string,
  body: unknown,
  init?: RequestInit & { signal?: AbortSignal },
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...init,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch((_err) => ({}));
    const record = data as Record<string, unknown>;
    // OPS-23: propagate structured error code + payload (e.g. DIGEST_TOO_MANY_ITEMS
    // carries item_count + max in `data` — clients read typed fields, not regex).
    const code = record.code as string | undefined;
    const message =
      (record.error as string) ??
      (record.message as string) ??
      `Request failed: ${res.status}`;
    throw new ApiError(message, res.status, code, record);
  }
  return res.json() as Promise<T>;
}
