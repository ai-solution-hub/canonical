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
export interface ContentListItem {
  id: string;
  title: string;
  suggested_title: string | null;
  summary: string | null;
  primary_domain: string;
  primary_subtopic: string;
  content_type: string;
  platform: string | null;
  author_name: string | null;
  source_domain: string | null;
  thumbnail_url: string | null;
  captured_date: string | null;
  ai_keywords: string[] | null;
  classification_confidence: number | null;
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

/** Transcript chapter from metadata */
export interface TranscriptChapter {
  title: string;
  word_count: number;
  start_seconds: number;
  end_seconds: number;
  text?: string;
}

/** AI-generated transcript segment */
export interface TranscriptSegment {
  id: string;
  chapter_index: number;
  title: string;
  summary: string;
  key_points: string[];
  start_seconds: number;
  end_seconds: number;
  start_time: string;
  end_time: string;
  duration_seconds: number;
  word_count: number;
  read_time_minutes: number;
}

/** Highlight category types (intra-file: TranscriptHighlight.category) */
type HighlightCategory =
  | 'insight'
  | 'prediction'
  | 'framework'
  | 'quote'
  | 'data_point'
  | 'action_item';

/** Extracted highlight from transcript */
export interface TranscriptHighlight {
  id: string;
  quote: string;
  timestamp: string;
  approximate_timestamp: number;
  chapter_index: number;
  category: HighlightCategory;
  significance: string;
  context?: string;
  starred: boolean;
  created_item_id?: string;
}

/** Search result with similarity score and optional content snippet.
 *  Note: hybrid_search() does NOT return user_tags — it will be undefined. */
export interface SearchResult extends Omit<ContentListItem, 'user_tags'> {
  similarity: number;
  snippet?: string | null;
  user_tags?: ContentListItem['user_tags'];
}

/**
 * Polymorphic search-result shape returned by the ID-131.11 (G-SEARCH) grain-
 * aware `hybrid_search` UNION over the typed L-records substrate
 * (source_documents / content_chunks → source_document / q_a_pairs /
 * reference_items). The 8 value-path fields mirror the MCP `SearchResult`
 * mapping (`id, title, suggested_title, summary, content_type, primary_domain,
 * primary_subtopic, similarity`); `owner_kind` identifies the record class
 * (equal to `content_type` on the RPC rows).
 *
 * Distinct from `SearchResult` above, which still extends the content_items-
 * shaped `ContentListItem`. Migrating the ~6 UI consumers off `SearchResult`
 * onto this polymorphic shape — and the eventual removal of `SearchResult` — is
 * owned by ID-131.17 (G-IMS-DELETE) + ID-131.21 (G-MANUAL-QA); this type is
 * introduced ahead of that coordinated change.
 */
export interface PolymorphicSearchResult {
  id: string;
  title: string | null;
  suggested_title: string | null;
  summary: string | null;
  content_type: string | null;
  primary_domain: string | null;
  primary_subtopic: string | null;
  owner_kind: string;
  similarity: number;
  snippet?: string | null;
}

/** Workspace (from workspaces table) */
export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  type: string;
  status: string;
  domain_metadata: Record<string, unknown> | null;
  created_by: string | null;
  updated_by: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

/** Filter state (URL-driven) */
export interface BrowseFilters {
  domain?: string[]; // multi-select
  subtopic?: string; // single (scoped to one domain)
  content_type?: string[]; // multi-select
  platform?: string[]; // multi-select
  author?: string[]; // multi-select, pipe-delimited in URL
  date_from?: string;
  date_to?: string;
  keywords?: string[];
  starred?: boolean;
  priority?: string[];
  workspace?: string; // workspace UUID
  user_tags?: string[]; // user tag strings
  freshness?: string[]; // multi-select: fresh, aging, stale, expired
  layer?: string; // single layer filter from CLIENT_CONFIG vocabulary
  entity?: string; // entity canonical name — filter to items mentioning this entity
  entity_type?: string; // entity type filter — organisation, certification, etc.
  quality_issues?: boolean; // filter to items with open quality flags
  include_drafts?: boolean; // include draft items (excluded by default)
  include_qa?: boolean; // include Q&A pairs (excluded by default — they live in /library)
  owner?: string; // 'me' | 'unowned' | UUID — filter by content owner
  review_status?: string; // verified | unverified | flagged — governance review status filter
  source?: string; // metadata->>source JSONB path filter (e.g. 'intelligence_pipeline')
  sort?:
    | 'captured_date'
    | 'classification_confidence'
    | 'primary_domain'
    | 'freshness'
    | 'quality_score'
    | 'relevance';
  order?: 'asc' | 'desc';
}

// CONTENT_LIST_COLUMNS / CONTENT_DETAIL_COLUMNS RETIRED (ID-131.19, M6, S450
// GO tail): both were `.select()` projection strings against `content_items`
// (dropped table). Dead residue — grepped clean of any live `.select()`
// caller; their sole other reference was a stale test-premise "regression
// guard" in __tests__/components/shared/publication-status-badge.test.tsx
// (also retired alongside this).
