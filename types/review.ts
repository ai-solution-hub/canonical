import type { ContentListItem } from './content';

// -- Action types --

export type ReviewStatus =
  | 'unverified'
  | 'verified'
  | 'flagged'
  | 'draft'
  | 'all';

// -- Filter types --

export interface ReviewFilters {
  status?: ReviewStatus;
  domain?: string[];
  content_type?: string[];
  source_file?: string;
  source_document_id?: string;
  sort?: ReviewQueueSortField;
  assigned_to_me?: boolean;
  /**
   * When true, broadens the queue to include verified-but-overdue rows
   * (governance_review_status = 'review_overdue') alongside the current
   * status filter. With status='unverified' (default), the
   * `verified_at IS NULL` predicate is replaced by
   * `(verified_at IS NULL OR governance_review_status = 'review_overdue')`.
   * See S205 WP-E T2 / plan §T2 (H-2). Surfaced via the "Overdue reviews"
   * toggle in `components/review/review-filters.tsx`; count badge reads
   * `ReviewStatsResponse.overdue` (S204 WP-E T0 RPC extension).
   */
  include_overdue?: boolean;
  /**
   * When true, narrows the queue to the taxonomy 'unclassified' sentinel rows
   * (primary_domain='unclassified' OR primary_subtopic='unclassified', per
   * ID-63 {63.11}). Surfaced via the "Unclassified" tab in
   * `components/review/review-tabs.tsx`; the count badge reads
   * `ReviewStatsResponse.unclassified_coverage`. Emitted to the queue route
   * as `?unclassified=true` by `buildQueueParams`. ID-63.12.
   */
  unclassified?: boolean;
}

// -- Progress tracking --

export interface ReviewProgress {
  verified: number;
  flagged: number;
  skipped: number;
  total: number;
  sessionReviewed: number;
}

// -- Queue item (extended for review display) --

export type ReviewQueueSortField =
  | 'created_at'
  | 'confidence_asc'
  | 'quality_score_asc';

export interface ReviewQueueItem extends ContentListItem {
  content: string | null;
  source_url: string | null;
  verified_at: string | null;
  verified_by: string | null;
  secondary_domain: string | null;
  secondary_subtopic: string | null;
  quality_score: number | null;
  /** Most recent verification_history action timestamp (verify, unverify, or flag) */
  last_reviewed_at: string | null;
}

// -- API responses --

export interface ReviewQueueResponse {
  items: ReviewQueueItem[];
  total: number;
  verified_count: number;
  flagged_count: number;
  has_more: boolean;
}

export interface ReviewStatsResponse {
  total: number;
  verified: number;
  flagged: number;
  unverified: number;
  draft: number;
  /**
   * Count of non-archived content_items where governance_review_status =
   * 'review_overdue'. Surfaced by the §5.5 Phase 3 review-cadence UI
   * (overdue filter pill count badge in `components/review/review-filters.tsx`).
   * Source: `get_review_breakdown_stats()` RPC, S204 WP-E T0 extension.
   */
  overdue: number;
  /**
   * Count of non-archived content_items where publication_status =
   * 'in_review'. Drives the count badge on the "Awaiting publication" tab
   * (tab 6) of `/review`. Computed by `app/api/review/stats/route.ts` via a
   * direct count query alongside the `get_review_breakdown_stats()` RPC,
   * since the RPC's existing fields are scoped to the verified-content-review
   * surface (governance_review_status != 'draft' guard) and would silently
   * exclude in_review rows that share that guard.
   *
   * Spec: docs/specs/review-page-tabs-refactor-spec.md §8 (b), §12 OQ4.
   */
  awaiting_publication: number;
  /**
   * Count of non-archived content_items whose taxonomy classification is
   * incomplete — `primary_domain = 'unclassified'` OR `primary_subtopic =
   * 'unclassified'` (the sentinel established by ID-63 {63.11} NOT NULL
   * DEFAULT 'unclassified', persisted by the cocoindex flow in {63.7}).
   * Drives the count badge on the "Unclassified" tab of `/review` and is
   * the queryable mirror of the Inv-7 taxonomy-miss signal the {63.8}
   * flow-end webhook emits. Computed by `app/api/review/stats/route.ts` via
   * a direct count query alongside the `get_review_breakdown_stats()` RPC
   * (the RPC aggregates by_domain['unclassified'] too, but the explicit
   * field powers the tab pill without a client-side lookup). ID-63.12.
   */
  unclassified_coverage: number;
  by_domain: Record<string, { total: number; verified: number }>;
  by_content_type: Record<string, { total: number; verified: number }>;
  by_source_file: Record<string, { total: number; verified: number }>;
  by_source_document: Record<
    string,
    { total: number; verified: number; name: string }
  >;
}
