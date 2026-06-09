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

// ---------------------------------------------------------------------------
// Content-item version history (ID-59 {59.12} user-edit Diff-UI)
// ---------------------------------------------------------------------------
//
// Wire shapes for GET /api/items/[id]/history (summary list) and
// GET /api/items/[id]/history/[versionId] (full body). Used by the
// compare-two-versions affordance in components/item-detail/version-history.tsx
// — TanStack Query exclusively (no raw fetch in the compare path).

/** Summary row returned by GET /api/items/[id]/history. */
export interface ItemHistoryEntry {
  id: string;
  content_item_id: string;
  version: number;
  change_summary: string | null;
  change_reason: string | null;
  change_type: string;
  created_by: string | null;
  created_at: string;
}

/** Paginated list response from GET /api/items/[id]/history. */
export interface ItemHistoryListResponse {
  versions: ItemHistoryEntry[];
  total: number;
  limit: number;
  offset: number;
}

/** Full revision body from GET /api/items/[id]/history/[versionId]. */
export interface ItemHistoryVersionDetail {
  id: string;
  content_item_id: string;
  version: number;
  title: string;
  content: string;
  brief: string | null;
  detail: string | null;
  reference: string | null;
  change_summary: string | null;
  change_type: string;
  created_by: string | null;
  created_at: string;
  /** Structured edit-intent classification ({59.5}); null for older rows. */
  edit_intent: string | null;
}

/** Fetch the version-history summary list for a content item. */
export async function fetchItemHistoryList(
  itemId: string,
  limit = 50,
): Promise<ItemHistoryListResponse> {
  return fetchJson<ItemHistoryListResponse>(
    `/api/items/${itemId}/history?limit=${limit}`,
  );
}

/** Fetch the full body of a single content-history revision. */
export async function fetchItemHistoryVersion(
  itemId: string,
  versionId: string,
): Promise<ItemHistoryVersionDetail> {
  return fetchJson<ItemHistoryVersionDetail>(
    `/api/items/${itemId}/history/${versionId}`,
  );
}

/** Response shape for GET /api/admin/taxonomy-sync/status */
/** @public */
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

import type { MarkdownIngestAnalysis } from '@/types/ingest';

/** Per-file override on the wire (snake_case mirror of MarkdownPerFileOverride). */
export interface MarkdownPerFileOverrideWire {
  filename: string;
  excluded?: boolean;
  draft_or_final?: 'draft' | 'final';
  /** Admin-only — silently ignored for editors per spec §8.2. */
  skip_dedup?: boolean;
}

/** Batch-wide options on the wire (mirror of MarkdownBatchOptions.batch). */
/** @public */
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
/** @public */
export interface PipelineRunRow {
  id: string;
  pipeline_name: string;
  // S226 §5.4.4 W1-IMPL: 'cancelled' added — pipeline_runs.status now
  // includes user-initiated cancellation (cooperative-cancel flow per
  // §10 D-8 ratified flip — markdown_batch opts in).
  // S309 bl-224: 'in_progress' added — cocoindex writes in_progress rows and
  // the CHECK constraint admits it; the row schema must accept it on read.
  status:
    | 'running'
    | 'in_progress'
    | 'completed'
    | 'completed_with_errors'
    | 'failed'
    | 'cancelled';
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
 * Response shape returned by POST /api/ingest/markdown phase=import
 * post-§5.4.4 W1-IMPL (S226). The route now returns HTTP 202 with a
 * job_id + pipeline_run_id; the UI continues polling against
 * `GET /api/pipeline-runs/[id]` (Pattern E preserved) until terminal
 * state. Per .planning/.archive/.specs/§5.4.4-ep2-markdown-batch-migration-spec.md
 * §7.5 + §7.6 step 1.
 */
/** @public */
export interface ImportMarkdownQueuedResponse {
  /** UUID of the processing_queue row (the worker job). */
  job_id: string;
  /** UUID of the pipeline_runs row pre-INSERTed by the producer
   *  (Pattern 2 + Pattern E). The UI polls
   *  `GET /api/pipeline-runs/${pipeline_run_id}` until terminal state. */
  pipeline_run_id: string;
  /** Always 'queued' on first call; reflects the queue lifecycle entry
   *  point. Subsequent polling reads pipeline_runs.status which evolves
   *  to 'running' (orchestrator at-start) → 'completed' /
   *  'completed_with_errors' / 'failed' / 'cancelled'. */
  status: 'queued';
  /** True when the idempotency-key dedup matched an existing job (e.g.
   *  AJAX retry of a same-batch POST). The UI shows a toast "Already
   *  importing — joining the existing batch…" rather than starting
   *  fresh polling. */
  deduplicated: boolean;
}

/**
 * Import-phase fetcher — POST multipart to /api/ingest/markdown with
 * phase='import' + options JSON-stringified.
 *
 * Post-§5.4.4 (S226 W1-IMPL): the route returns HTTP 202 immediately
 * with `{ job_id, pipeline_run_id, status: 'queued', deduplicated }`.
 * The UI continues polling against `GET /api/pipeline-runs/[id]` (Pattern
 * E preserved) until terminal state. Per spec §7.5 + §7.6.
 *
 * `MarkdownBatchResultsSummary` is no longer in the POST response — it
 * lives on `pipeline_runs.result` post-completion (orchestrator's
 * finaliseRun writes it). Consumers should read it off the polling
 * response (`PipelineRunRow.result.results_summary`).
 */
export async function importMarkdownBatch(args: {
  files: File[];
  options: MarkdownBatchWireOptions;
}): Promise<ImportMarkdownQueuedResponse> {
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
  return res.json() as Promise<ImportMarkdownQueuedResponse>;
}

/**
 * Cancel an in-flight markdown_batch job. Per §5.4.4 §10 D-8 ratified
 * flip: markdown_batch opts in to cooperative cancellation (poll
 * cadence=1 — check before every file).
 *
 * PATCH /api/jobs/${jobId}/cancel:
 *   - 200 + { jobId, status: 'cancelled' } on success (pending OR
 *     processing-and-cooperative).
 *   - 409 on race-loss (job already terminal). UI surfaces "Job
 *     already finished — refresh for results."
 *   - 404 on unknown job_id.
 *   - 401 / 403 on auth failure.
 */
export async function cancelMarkdownBatchJob(
  jobId: string,
): Promise<{ jobId: string; status: 'cancelled' }> {
  const res = await fetch(`/api/jobs/${jobId}/cancel`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<{ jobId: string; status: 'cancelled' }>;
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

// ---------------------------------------------------------------------------
// Awaiting-publication queue (tab 6 of /review)
// ---------------------------------------------------------------------------
//
// Spec: docs/specs/review-page-tabs-refactor-spec.md §8 (f).
// Re-uses the GET /api/review/queue REST route widened with the
// ?publication_status=in_review query param (NOT a new RPC). Returns the
// shared ReviewQueueResponse shape so callers can re-use the existing
// type. Only the in_review filter is bound here; tab-orthogonal filters
// (domain, content_type, source_file) are accepted as opt-in extensions
// via the `filters` arg so admin in-tab finer slicing keeps working.

import type { ReviewQueueResponse } from '@/types/review';

export interface PublicationReviewQueueFilters {
  domain?: string[];
  content_type?: string[];
  source_file?: string;
  source_document_id?: string;
  limit?: number;
  offset?: number;
}

/**
 * Fetch the awaiting-publication queue for tab 6 of /review.
 *
 * Wire shape:
 *   GET /api/review/queue?publication_status=in_review[&domain=…][&content_type=…]…
 *
 * The route widening (`app/api/review/queue/route.ts` §publication-review
 * branch) bypasses the standard verified_at + governance filters when
 * `publication_status=in_review` is present, since the publication-review
 * tab is orthogonal to governance state per spec §6.7 line 1196.
 */
export async function fetchPublicationReviewQueue(
  filters: PublicationReviewQueueFilters = {},
): Promise<ReviewQueueResponse> {
  const params = new URLSearchParams();
  params.set('publication_status', 'in_review');

  if (filters.domain?.length) {
    for (const d of filters.domain) params.append('domain', d);
  }
  if (filters.content_type?.length) {
    for (const ct of filters.content_type) params.append('content_type', ct);
  }
  if (filters.source_file) {
    params.set('source_file', filters.source_file);
  }
  if (filters.source_document_id) {
    params.set('source_document_id', filters.source_document_id);
  }
  if (filters.limit !== undefined) {
    params.set('limit', String(filters.limit));
  }
  if (filters.offset !== undefined) {
    params.set('offset', String(filters.offset));
  }

  return fetchJson<ReviewQueueResponse>(
    `/api/review/queue?${params.toString()}`,
  );
}

// ---------------------------------------------------------------------------
// Admin Cross-System Dedup Review (§1.7)
// ---------------------------------------------------------------------------

/**
 * A row surfaced by the admin dedup queue. Mirrors the columns that
 * `/api/admin/content-dedup/queue` selects from `content_items`. Note
 * `dedup_status` is intentionally typed as `string` rather than the CHECK
 * enum because the API may surface intermediate states during transitions
 * and the UI tolerates anything starting with `'suspected_duplicate'`.
 */
export interface SuspectedDuplicateRow {
  id: string;
  title: string | null;
  content: string | null;
  dedup_status: string;
  created_at: string;
  primary_domain: string | null;
  content_owner_id: string | null;
  ingest_source: string | null;
  superseded_by: string | null;
  publication_status: string;
  metadata: Record<string, unknown> | null;
}

/** @public */
export interface DedupQueueResponse {
  items: SuspectedDuplicateRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface DedupQueueFilters {
  domain?: string;
  cursor?: string;
  limit?: number;
  sort?: 'created_at_desc' | 'similarity_desc';
}

/** Fetch the admin dedup queue (suspected_duplicate rows pending review). */
export async function fetchAdminDedupQueue(
  filters: DedupQueueFilters = {},
): Promise<DedupQueueResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return fetchJson<DedupQueueResponse>(
    `/api/admin/content-dedup/queue${qs ? `?${qs}` : ''}`,
  );
}

/** @public */
export interface DedupItemResponse {
  subject: SuspectedDuplicateRow;
  canonical: SuspectedDuplicateRow | null;
  similarity: number;
}

/** Fetch a single dedup queue item plus its canonical match. */
export async function fetchAdminDedupItem(
  id: string,
): Promise<DedupItemResponse> {
  return fetchJson<DedupItemResponse>(`/api/admin/content-dedup/${id}`);
}

/**
 * Response shape for POST /api/admin/content-dedup/[id]/supersede.
 *
 * `pathId` is always the dedup-queue row (subject). `retiredId` is the
 * row whose `superseded_by` got set. `direction` echoes the request.
 * `pathDedupStatus` is only present when direction =
 * `'subject-supersedes-canonical'` (the kept-subject flips to
 * `'confirmed_unique'`); for the default direction the path IS the
 * retired side, so a separate path status would duplicate
 * `retiredDedupStatus`.
 *
 * Spec: docs/specs/§1.7-admin-dedup-supersede-fix-spec.md §2.9
 */
/** @public */
export interface DedupSupersedeResponse {
  pathId: string;
  retiredId: string;
  canonicalId: string;
  direction: 'canonical-supersedes-subject' | 'subject-supersedes-canonical';
  retiredDedupStatus: 'superseded';
  pathDedupStatus?: 'confirmed_unique';
}

// ---------------------------------------------------------------------------
// Admin Near-Duplicate Merge Dashboard (§1.9)
// ---------------------------------------------------------------------------

/**
 * A near-duplicate pair surfaced by `find_duplicate_pairs` RPC, shaped
 * for the §1.9 dashboard list view. Aliases the RPC's
 * `id1/title1/type1/domain1/id2/...` columns into `left*`/`right*` so
 * downstream UI doesn't think in terms of the raw RPC ordinals.
 */
export interface NearDupPair {
  pairId: string;
  similarity: number;
  left: {
    id: string;
    title: string | null;
    contentType: string | null;
    primaryDomain: string | null;
  };
  right: {
    id: string;
    title: string | null;
    contentType: string | null;
    primaryDomain: string | null;
  };
}

/** @public */
export interface NearDupPairsResponse {
  pairs: NearDupPair[];
  threshold: number;
  total: number;
}

/**
 * Per-row detail returned by GET
 * `/api/admin/content-dedup/near-duplicates/[pairId]`. Mirrors the
 * `content_items` columns the detail view reads (per spec §4.1).
 */
export interface NearDupPairMember {
  id: string;
  title: string | null;
  content: string | null;
  dedup_status: string;
  created_at: string;
  primary_domain: string | null;
  content_type: string | null;
  content_owner_id: string | null;
  ingest_source: string | null;
  superseded_by: string | null;
  archived_at: string | null;
  publication_status: string;
}

/** @public */
export interface NearDupPairDetail {
  left: NearDupPairMember;
  right: NearDupPairMember;
  similarity: number;
}

/** Response shape for the merge POST endpoint. */
/** @public */
export interface NearDupMergeResult {
  pairId: string;
  oldId: string;
  newId: string;
  dedup_status: 'superseded';
}

/** Response shape for the confirm-unique POST endpoint. */
/** @public */
export interface NearDupConfirmUniqueResult {
  pairId: string;
  leftDedupStatus: 'confirmed_unique';
  rightDedupStatus: 'confirmed_unique';
}

/** Filters accepted by the list-view fetcher. */
/** @public */
export interface NearDupPairsFilters {
  threshold?: number;
  domain?: string;
  limit?: number;
}

/** Fetch near-duplicate candidate pairs above the threshold. */
export async function fetchAdminNearDupPairs(
  filters: NearDupPairsFilters = {},
): Promise<NearDupPairsResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return fetchJson<NearDupPairsResponse>(
    `/api/admin/content-dedup/near-duplicates${qs ? `?${qs}` : ''}`,
  );
}

/** Fetch a single near-duplicate pair detail (both rows + similarity). */
export async function fetchAdminNearDupPair(
  pairId: string,
): Promise<NearDupPairDetail> {
  return fetchJson<NearDupPairDetail>(
    `/api/admin/content-dedup/near-duplicates/${pairId}`,
  );
}

/**
 * POST merge — supersede `oldId` by `newId`. Both ids must be members
 * of the pair identified by `pairId`. Server returns 409 on
 * SupersessionError preconditions; the UI handles 409 as a non-fatal
 * toast + redirect (matches §1.7 pattern).
 *
 * `similarity_at_resolution` + `threshold_at_resolution` carry OQ2
 * audit context (similarity score the admin saw + filter threshold
 * that surfaced the pair). They are persisted to
 * `content_history.metadata` on the merge audit row.
 */
export async function postAdminNearDupMerge(
  pairId: string,
  body: {
    oldId: string;
    newId: string;
    note?: string;
    similarity_at_resolution?: number;
    threshold_at_resolution?: number;
  },
): Promise<NearDupMergeResult> {
  return mutationFetchJson<NearDupMergeResult>(
    `/api/admin/content-dedup/near-duplicates/${pairId}/merge`,
    body,
  );
}

/**
 * POST confirm-unique — flip both rows to `confirmed_unique`.
 *
 * `similarity_at_resolution` + `threshold_at_resolution` carry OQ2
 * audit context, mirroring the merge payload so the per-row history
 * snapshots written by `resolve_near_dup_confirm_unique` carry the
 * resolution context.
 */
export async function postAdminNearDupConfirmUnique(
  pairId: string,
  body: {
    note?: string;
    similarity_at_resolution?: number;
    threshold_at_resolution?: number;
  },
): Promise<NearDupConfirmUniqueResult> {
  return mutationFetchJson<NearDupConfirmUniqueResult>(
    `/api/admin/content-dedup/near-duplicates/${pairId}/confirm-unique`,
    body,
  );
}

// ---------------------------------------------------------------------------
// Publication bulk-action (§5.3 publication approval gate, Wave 1)
// ---------------------------------------------------------------------------
//
// Spec: .planning/.archive/.specs/publication-approval-gate-spec.md §4.4 (response shape — archived S220 W4 close-out).
// The wire shape mirrors the schema-defined request body verbatim.
// `mutationFetchJson` defaults to `method: 'POST'` (set explicitly here
// per the brief — never inherit a default) and applies `Content-Type:
// application/json`.

import type { PublicationBulkActionBody } from '@/lib/validation/schemas';

/** Per-item result statuses emitted by the bulk-action endpoint. */
export type PublicationBulkActionResultStatus =
  | 'success'
  | 'conflict'
  | 'forbidden'
  | 'not_found'
  | 'error';

/** Per-item result envelope returned in `results[]`. */
export interface PublicationBulkActionResult {
  id: string;
  status: PublicationBulkActionResultStatus;
  previousStatus?: 'draft' | 'in_review' | 'published' | 'archived';
  newStatus?: 'draft' | 'in_review' | 'published' | 'archived';
  reason?: string;
  error?: string;
}

/** Top-level response envelope returned by POST /api/review/publication-bulk-action. */
export interface PublicationBulkActionResponse {
  action: 'approve' | 'return_to_draft';
  totalRequested: number;
  successCount: number;
  failureCount: number;
  results: PublicationBulkActionResult[];
}

/**
 * POST `/api/review/publication-bulk-action` — bulk-approve /
 * bulk-return-to-draft for items currently in `publication_status='in_review'`.
 *
 * Always resolves to a 200 envelope (even when `successCount === 0`) per
 * spec §7.2. Throws `ApiError` only on route-level failures (auth,
 * rate-limit, validation, route-handler crash). Per-item failures are
 * surfaced inside `results[]` with structured statuses, NOT thrown.
 *
 * The hook layer (Wave 2) calls this fetcher, then invalidates the
 * relevant `queryKeys.review.*` keys on success. Cap of 50 items per
 * request enforced by the Zod schema (D-3 RATIFIED S217 close-out).
 */
export async function mutationBulkPublicationAction(
  body: PublicationBulkActionBody,
): Promise<PublicationBulkActionResponse> {
  return mutationFetchJson<PublicationBulkActionResponse>(
    '/api/review/publication-bulk-action',
    body,
    { method: 'POST' },
  );
}
