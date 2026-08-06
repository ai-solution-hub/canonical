import type { PublicationStatus } from '@/lib/governance/publication-transitions';

// content_items (the former IMS content table) was DROPPED at M6 (ID-131.19,
// S450 GO tail). This type module has been UI-facing-shape-only for a while:
// `ContentListItem` is consumed by ~10 files (app/library/library-content.tsx,
// components/content/content-library-{result,drawer}.tsx,
// components/qa/qa-row.tsx, components/shell/collapsible-group.tsx,
// hooks/use-{library-data,library-bulk-actions,search,transcript}.ts,
// lib/ai/summarise.ts) that already map OTHER tables (q_a_pairs,
// source_documents, hybrid_search RPC rows) onto this shape — see e.g.
// `mapQAPairToContentListItem` in hooks/use-library-data.ts (ID-131 {131.21}
// G-MANUAL-QA) — none of them derive it from a live `content_items` row any
// more (grepped clean). The field types below are HAND-WRITTEN, preserving
// the exact historical `content_items.Row` shape (pre-M6 — the field types
// this interface's `Database['public']['Tables']['content_items']['Row']`
// lookups used to resolve to) so no consumer's structural typing changes;
// only the derivation mechanism (a lookup against a now-dropped table) is
// removed.

/** Display-optimised subset for list/grid views */
// id-417 / DR-130: the subject-taxonomy + classification-by-product fields
// (suggested_title, primary_domain, primary_subtopic, ai_keywords,
// classification_confidence) retired with their source columns — no mapper
// can populate them any more.
export interface ContentListItem {
  id: string;
  title: string;
  summary: string | null;
  content_type: string;
  platform: string | null;
  author_name: string | null;
  source_domain: string | null;
  thumbnail_url: string | null;
  captured_date: string | null;
  priority: string | null;
  freshness: string | null;
  user_tags: string[] | null;
  governance_review_status: string | null;
  metadata: Record<string, unknown> | null;
  /** ISO timestamp when the item was verified, null if unverified */
  verified_at?: string | null;
  /** UUID of user who verified the item */
  verified_by?: string | null;
  /** Brief/executive summary for progressive depth */
  brief?: string | null;
  /** Full content text (used for Q&A answer preview on browse cards) */
  content?: string | null;
  /** Standard/brief answer for Q&A pairs */
  answer_standard?: string | null;
  /** Advanced/detailed answer for Q&A pairs */
  answer_advanced?: string | null;
  /** UUID of the content owner */
  content_owner_id?: string | null;
  /** Computed quality score (0-100) */
  quality_score?: number | null;
  /** Source document UUID for provenance tracking */
  source_document_id?: string | null;
  /** Citation count (proper column, default 0) */
  citation_count?: number | null;
  /** Source file name (proper column, nullable) */
  source_file?: string | null;
  /** Content layer (promoted from metadata JSONB) */
  layer?: string | null;
  /** Starred flag (promoted from metadata JSONB) */
  starred?: boolean;
  /** ISO date when the item is next due for review (DATE column) */
  next_review_date?: string | null;
  /** Recurring review cadence in days (null = one-off review) */
  review_cadence_days?: number | null;
  /**
   * Publication lifecycle state (DB column is `string` NOT NULL with DEFAULT
   * `'published'`). One of `'draft' | 'in_review' | 'published' | 'archived'`
   * — canonical union exported as `PublicationStatus` from
   * `lib/governance/publication-transitions.ts`.
   *
   * Required (not optional) on this type because S212 W3 added
   * `publication_status` to `CONTENT_LIST_COLUMNS` so every row fetched via
   * `.select(CONTENT_LIST_COLUMNS)` carries the column. Nullable to tolerate
   * the rare row produced by code paths that bypass the projection (e.g.
   * partial mocks). Without narrowing, `publication_status?: string | null`
   * silently masked the W3 finding where the column was missing from the
   * projection — every browse/library row arrived with
   * `publication_status === undefined` and the badge mounted as `null`.
   */
  publication_status: PublicationStatus | null;
}

/** Multi-level summary data stored as JSONB on content_items */
export interface SummaryData {
  executive: string;
  detailed: string;
  takeaways: string[];
  generated_at: string;
  model: string;
  tokens_used?: number;
}

/** Search result with similarity score and optional content snippet.
 *  Note: hybrid_search() does NOT return user_tags — it will be undefined. */
export interface SearchResult extends Omit<ContentListItem, 'user_tags'> {
  similarity: number;
  snippet?: string | null;
  user_tags?: ContentListItem['user_tags'];
  /**
   * Result GRAIN — 'source_document' | 'q_a_pair' | 'reference_item'. Projected
   * by hybrid_search (DR-050 / id-144 OD-2) and distinct from `content_type`,
   * which stays the source_documents editorial value. Anything routing or
   * filtering by kind reads this; `content_type` is display only.
   */
  owner_kind?: string | null;
}

// CONTENT_LIST_COLUMNS / CONTENT_DETAIL_COLUMNS RETIRED (ID-131.19, M6, S450
// GO tail): both were `.select()` projection strings against `content_items`
// (dropped table). Dead residue — grepped clean of any live `.select()`
// caller; their sole other reference was a stale test-premise "regression
// guard" in __tests__/components/shared/publication-status-badge.test.tsx
// (also retired alongside this).
