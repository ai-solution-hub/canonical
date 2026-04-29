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
export interface DedupSupersedeResponse {
  pathId: string;
  retiredId: string;
  canonicalId: string;
  direction: 'canonical-supersedes-subject' | 'subject-supersedes-canonical';
  retiredDedupStatus: 'superseded';
  pathDedupStatus?: 'confirmed_unique';
}
