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
// Q&A pair revision history (ID-59 {59.16} user-edit Diff-UI, Q&A leg)
// ---------------------------------------------------------------------------
//
// Wire shape for GET /api/q-a-pairs/[id]/history. Source = q_a_pair_history
// (INV-14). Each row carries the full revision body (question + answers) plus
// the `edit_intent` snapshot, so the compare-two-versions affordance computes
// the diff client-side from two list rows — no per-version detail route, no
// diff table (INV-15/INV-17). TanStack Query exclusively (no raw fetch).

/** A single q_a_pair_history revision row from GET /api/q-a-pairs/[id]/history. */
export interface QAPairHistoryEntry {
  id: string;
  q_a_pair_id: string;
  version: number;
  question_text: string;
  answer_standard: string;
  answer_advanced: string | null;
  /** Provenance of the snapshotted revision (no change_type column on Q&A history). */
  origin_kind: string;
  publication_status: string;
  changed_at: string;
  changed_by: string | null;
  /** Structured edit-intent classification ({59.5}); null for pre-feature rows. */
  edit_intent: string | null;
}

/** Paginated list response from GET /api/q-a-pairs/[id]/history. */
export interface QAPairHistoryListResponse {
  versions: QAPairHistoryEntry[];
  total: number;
  limit: number;
  offset: number;
}

/** Fetch the revision-history list (incl edit_intent) for one Q&A pair. */
export async function fetchQAPairHistory(
  pairId: string,
  limit = 50,
): Promise<QAPairHistoryListResponse> {
  return fetchJson<QAPairHistoryListResponse>(
    `/api/q-a-pairs/${pairId}/history?limit=${limit}`,
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
// Pipeline runs — read row shape
// ---------------------------------------------------------------------------
//
// The generic single-run READ poller (`fetchPipelineRun` + the
// `GET /api/pipeline-runs/[id]` route + `queryKeys.pipelineRuns`) was retired
// (gh-security item-J): {56.12} shipped a dedicated folder-drop status route
// (`app/api/ingest/folder-drop/status`) and the generic trio lost its only
// consumer. The `pipeline_runs` table, its server-side writes, and the LIST
// endpoint (`GET /api/pipeline-runs`) remain live.
//
// `PipelineRunRow` is retained as the R-WP17 type-drift source for
// `PipelineRunRowSchema` (lib/validation/schemas.ts), which guards the
// `pipeline_runs` read-shape — including the status<->CHECK-constraint parity
// invariant (bl-224 / S309).

/** Row shape of a `pipeline_runs` row (read-shape of record for R-WP17). */
/** @public */
export interface PipelineRunRow {
  id: string;
  pipeline_name: string;
  // S226 §5.4.4 W1-IMPL: 'cancelled' added — pipeline_runs.status now
  // includes user-initiated cancellation (cooperative-cancel flow).
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
// Eval cost aggregate (ID-104 {104.15} — T17 / B-INV-17)
// ---------------------------------------------------------------------------
//
// Aggregates `cost_usd`, call count, and distinct touchpoint count from
// `ai_call_events`. Used by `CostTabStub` to re-point from the interim
// `pipeline_runs.cost` read to real persisted AI-call data.
//
// Supabase safety: `tryQuery()` from `@/lib/supabase/safe` — no raw
// `.from().select()` with unchecked error (ESLint `local/no-unchecked-supabase-error`).

import { createClient } from '@/lib/supabase/client';
import { tryQuery } from '@/lib/supabase/safe';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';

/** Shape returned by `fetchEvalCostAggregate`. */
export interface EvalCostAggregateResult {
  /** Sum of `cost_usd` across all `ai_call_events` rows; null when no rows exist. */
  totalCostUsd: number | null;
  /** Total number of `ai_call_events` rows. */
  callCount: number;
  /** Number of distinct `touchpoint_id` values recorded. */
  touchpointCount: number;
}

/**
 * Aggregate cost data from `ai_call_events` (M4 — T17 / B-INV-17).
 *
 * Reads all rows; no date filter (unlike the interim `pipeline_runs` read).
 * Failure is returned as a thrown error so TanStack Query's `isError` flag
 * surfaces it correctly — this is observability data, not a critical path.
 */
export async function fetchEvalCostAggregate(): Promise<EvalCostAggregateResult> {
  const supabase = createClient();

  const result = await tryQuery<
    { cost_usd: number | null; touchpoint_id: string }[]
  >(
    supabase.from('ai_call_events').select('cost_usd, touchpoint_id'),
    'eval.cost_aggregate.fetch',
  );

  if (!result.ok) {
    logBestEffortWarn(
      'eval.cost_aggregate.fetch',
      'Failed to fetch eval cost aggregate',
      { err: result.error.message },
    );
    throw result.error;
  }

  const rows = result.data ?? [];
  const costs = rows
    .map((r) => r.cost_usd)
    .filter((c): c is number => c !== null);
  const distinctTouchpoints = new Set(rows.map((r) => r.touchpoint_id)).size;

  return {
    totalCostUsd:
      costs.length > 0 ? costs.reduce((sum, c) => sum + c, 0) : null,
    callCount: rows.length,
    touchpointCount: distinctTouchpoints,
  };
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

/** Per-item result statuses emitted by the bulk-action endpoint (internal — consumed by `PublicationBulkActionResult` below). */
type PublicationBulkActionResultStatus =
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

// ---------------------------------------------------------------------------
// Folder-drop ingest poll ({56.12}, ID-56 Path B)
// ---------------------------------------------------------------------------
//
// After a file is staged + walked (lib/upload/folder-drop.ts), cocoindex
// ingests it asynchronously and stamps `content_items.source_file` with the
// dropped filename. This fetcher polls a lean authed endpoint that answers the
// single question "has a content_items row appeared for this source_file yet?"
// — agnostic of publication/governance state (the row may land in any state).

/** Shape returned by GET /api/ingest/folder-drop/status. */
/** @public */
export interface ContentIngestStatus {
  /** True once a content_items row exists for the polled source_file. */
  ingested: boolean;
  /** The content_items id once ingested (null until then). */
  itemId: string | null;
}

/**
 * Poll the folder-drop ingest status for a single `source_file`.
 *
 * Wire shape: GET /api/ingest/folder-drop/status?source_file=<name>
 *
 * Returns `{ ingested: false, itemId: null }` while the row has not yet landed
 * (the normal pre-ingest state — NOT an error). A non-OK response throws
 * ApiError so the caller's poll surfaces a real failure rather than masking it.
 */
export async function fetchContentIngestStatus(
  sourceFile: string,
): Promise<ContentIngestStatus> {
  const params = new URLSearchParams({ source_file: sourceFile });
  return fetchJson<ContentIngestStatus>(
    `/api/ingest/folder-drop/status?${params.toString()}`,
  );
}

// ---------------------------------------------------------------------------
// Cross-Workspace Q&A Dedup Proposals — curator review surface
// (ID-120 {120.8} — TECH P-4)
// ---------------------------------------------------------------------------
//
// READS go directly through the role-scoped Supabase client (mirroring
// `fetchEvalCostAggregate` above) — NOT a bespoke GET route. The detail view
// must show BOTH question texts AND BOTH answers side-by-side (INV-10), so the
// fetchers join `q_a_pair_dedup_proposals` to `q_a_pairs` (the proposal store
// itself only carries denormalised provenance + the survivor nomination, never
// the Q/A text). The role-scoped client is RLS-gated to admin/editor (INV-22):
// a viewer's SELECT returns zero rows.
//
// MUTATIONS (approve / reject) POST to the {120.7} routes
// (`/api/q-a-pairs/dedup-proposals/[proposalId]/approve|reject`) which run the
// curator-role-scoped merge write — no app-side q_a_pairs write happens here.
//
// Supabase safety: `tryQuery()` from `@/lib/supabase/safe` — never a raw
// `.from().select()` with an unchecked `error` (ESLint
// `local/no-unchecked-supabase-error`).

import type { Database } from '@/supabase/types/database.types';

type DedupProposalRow =
  Database['public']['Tables']['q_a_pair_dedup_proposals']['Row'];

/** Curator-facing status filter for the proposal queue. */
/** @public */
export type QaDedupStatusFilter = 'pending' | 'approved' | 'rejected' | 'all';

/**
 * One member (Q&A pair) of a dedup proposal, hydrated from `q_a_pairs` with
 * the denormalised provenance snapshot carried on the proposal row. Both the
 * question AND the answer text are present so the detail view can render them
 * side-by-side (INV-10).
 */
/** @public */
export interface QaDedupPairMember {
  id: string;
  questionText: string | null;
  answerText: string | null;
  publicationStatus: string | null;
  /** Snapshot-by-value provenance from the proposal row (INV-16). */
  sourceWorkspaceId: string | null;
  sourceFormResponseId: string | null;
  /** ISO timestamp; the UI formats DD/MM/YYYY. */
  updatedAt: string | null;
}

/**
 * A dedup proposal flattened for the curator list view. `spansWorkspaces` /
 * `spansForms` drive the non-colour-only "spans workspaces/forms" badge
 * (INV-11/18) — computed from the two provenance snapshots.
 */
/** @public */
export interface QaDedupProposalSummary {
  id: string;
  status: DedupProposalRow['status'];
  /**
   * Cosine similarity (subordinate "match strength" affordance only — NEVER an
   * AI-confidence headline, INV-23).
   */
  similarityScore: number;
  proposedSurvivorId: string;
  survivorReason: string;
  resolvedSurvivorId: string | null;
  createdAt: string;
  pairAId: string;
  pairBId: string;
  /** True when the two members carry different (non-null) source workspaces. */
  spansWorkspaces: boolean;
  /** True when the two members carry different (non-null) source forms. */
  spansForms: boolean;
}

/** Full proposal detail: summary + both hydrated pair members. */
/** @public */
export interface QaDedupProposalDetail extends QaDedupProposalSummary {
  pairA: QaDedupPairMember;
  pairB: QaDedupPairMember;
}

/** Result shape returned by the approve / reject mutation routes ({120.7}). */
/** @public */
export interface QaDedupResolveResult {
  proposal: DedupProposalRow;
  survivor_id?: string;
  archived_id?: string;
}

const QA_DEDUP_PROPOSAL_COLUMNS =
  'id, status, similarity_score, proposed_survivor_id, survivor_reason, resolved_survivor_id, created_at, pair_a_id, pair_b_id, pair_a_source_workspace_id, pair_b_source_workspace_id, pair_a_source_form_response_id, pair_b_source_form_response_id' as const;

/**
 * Shape of one proposal row as selected for the list/detail reads — the
 * provenance columns are read directly off the proposal store (snapshot by
 * value), never re-joined from `q_a_pairs`.
 */
type DedupProposalSelectRow = Pick<
  DedupProposalRow,
  | 'id'
  | 'status'
  | 'similarity_score'
  | 'proposed_survivor_id'
  | 'survivor_reason'
  | 'resolved_survivor_id'
  | 'created_at'
  | 'pair_a_id'
  | 'pair_b_id'
  | 'pair_a_source_workspace_id'
  | 'pair_b_source_workspace_id'
  | 'pair_a_source_form_response_id'
  | 'pair_b_source_form_response_id'
>;

/** True when both ids are non-null and differ (a genuine cross-boundary span). */
function spans(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a !== b;
}

function toSummary(row: DedupProposalSelectRow): QaDedupProposalSummary {
  return {
    id: row.id,
    status: row.status,
    similarityScore: Number(row.similarity_score),
    proposedSurvivorId: row.proposed_survivor_id,
    survivorReason: row.survivor_reason,
    resolvedSurvivorId: row.resolved_survivor_id,
    createdAt: row.created_at,
    pairAId: row.pair_a_id,
    pairBId: row.pair_b_id,
    spansWorkspaces: spans(
      row.pair_a_source_workspace_id,
      row.pair_b_source_workspace_id,
    ),
    spansForms: spans(
      row.pair_a_source_form_response_id,
      row.pair_b_source_form_response_id,
    ),
  };
}

/**
 * Fetch the curator queue of dedup proposals, optionally filtered by status.
 * Newest-first. RLS denies a viewer (INV-22) — they receive zero rows.
 */
export async function fetchAdminQaDedupProposals(
  filters: { status?: QaDedupStatusFilter } = {},
): Promise<QaDedupProposalSummary[]> {
  const supabase = createClient();
  const status = filters.status ?? 'pending';

  let builder = supabase
    .from('q_a_pair_dedup_proposals')
    .select(QA_DEDUP_PROPOSAL_COLUMNS)
    .order('created_at', { ascending: false });
  if (status !== 'all') {
    builder = builder.eq('status', status);
  }

  const result = await tryQuery<DedupProposalSelectRow[]>(
    builder,
    'admin.qa_dedup.proposals.list',
  );
  if (!result.ok) throw result.error;
  return (result.data ?? []).map(toSummary);
}

/** Column slice read off `q_a_pairs` to hydrate a proposal member's Q+A text. */
type QaPairMemberRow = Pick<
  Database['public']['Tables']['q_a_pairs']['Row'],
  | 'id'
  | 'question_text'
  | 'answer_standard'
  | 'publication_status'
  | 'updated_at'
>;

/**
 * Fetch one proposal plus both hydrated members (Q+A text from `q_a_pairs`).
 * Throws if the proposal is absent (or RLS-hidden from a viewer).
 */
export async function fetchAdminQaDedupProposal(
  proposalId: string,
): Promise<QaDedupProposalDetail> {
  const supabase = createClient();

  const proposalResult = await tryQuery<DedupProposalSelectRow | null>(
    supabase
      .from('q_a_pair_dedup_proposals')
      .select(QA_DEDUP_PROPOSAL_COLUMNS)
      .eq('id', proposalId)
      .maybeSingle(),
    'admin.qa_dedup.proposal.read',
  );
  if (!proposalResult.ok) throw proposalResult.error;
  if (proposalResult.data === null) {
    throw new ApiError('Dedup proposal not found', 404, 'not_found');
  }
  const summary = toSummary(proposalResult.data);

  const membersResult = await tryQuery<QaPairMemberRow[]>(
    supabase
      .from('q_a_pairs')
      .select(
        'id, question_text, answer_standard, publication_status, updated_at',
      )
      .in('id', [summary.pairAId, summary.pairBId]),
    'admin.qa_dedup.proposal.members',
  );
  if (!membersResult.ok) throw membersResult.error;
  const byId = new Map((membersResult.data ?? []).map((row) => [row.id, row]));

  const hydrate = (
    pairId: string,
    sourceWorkspaceId: string | null,
    sourceFormResponseId: string | null,
  ): QaDedupPairMember => {
    const row = byId.get(pairId);
    return {
      id: pairId,
      questionText: row?.question_text ?? null,
      answerText: row?.answer_standard ?? null,
      publicationStatus: row?.publication_status ?? null,
      sourceWorkspaceId,
      sourceFormResponseId,
      updatedAt: row?.updated_at ?? null,
    };
  };

  return {
    ...summary,
    pairA: hydrate(
      summary.pairAId,
      proposalResult.data.pair_a_source_workspace_id,
      proposalResult.data.pair_a_source_form_response_id,
    ),
    pairB: hydrate(
      summary.pairBId,
      proposalResult.data.pair_b_source_workspace_id,
      proposalResult.data.pair_b_source_form_response_id,
    ),
  };
}

/**
 * Approve a dedup proposal ({120.7} route). `survivorId`, when supplied, is the
 * curator's override of the proposer's nomination (INV-13); when omitted the
 * route defaults to `proposed_survivor_id`. The route archives the non-survivor
 * then flips the proposal `status='approved'`. A 409 surfaces a concurrent
 * resolve / already-archived state.
 */
export async function postAdminQaDedupApprove(
  proposalId: string,
  body: { survivorId?: string } = {},
): Promise<QaDedupResolveResult> {
  return mutationFetchJson<QaDedupResolveResult>(
    `/api/q-a-pairs/dedup-proposals/${proposalId}/approve`,
    body.survivorId ? { survivor_id: body.survivorId } : {},
  );
}

/**
 * Reject a dedup proposal ({120.7} route). Sets `status='rejected'` and writes
 * NOTHING to `q_a_pairs` (INV-13) — both members stay published.
 */
export async function postAdminQaDedupReject(
  proposalId: string,
): Promise<QaDedupResolveResult> {
  return mutationFetchJson<QaDedupResolveResult>(
    `/api/q-a-pairs/dedup-proposals/${proposalId}/reject`,
    {},
  );
}
