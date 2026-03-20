import type { Database } from '@/supabase/types/database.types';

type ContentItemRow = Database['public']['Tables']['content_items']['Row'];

/** Display-optimised subset for list/grid views */
export interface ContentListItem {
  id: ContentItemRow['id'];
  title: ContentItemRow['title'];
  suggested_title: ContentItemRow['suggested_title'];
  ai_summary: ContentItemRow['ai_summary'];
  primary_domain: ContentItemRow['primary_domain'];
  primary_subtopic: ContentItemRow['primary_subtopic'];
  content_type: ContentItemRow['content_type'];
  platform: ContentItemRow['platform'];
  author_name: ContentItemRow['author_name'];
  source_domain: ContentItemRow['source_domain'];
  thumbnail_url: ContentItemRow['thumbnail_url'];
  captured_date: ContentItemRow['captured_date'];
  ai_keywords: ContentItemRow['ai_keywords'];
  classification_confidence: ContentItemRow['classification_confidence'];
  priority: ContentItemRow['priority'];
  freshness: ContentItemRow['freshness'];
  user_tags: ContentItemRow['user_tags'];
  governance_review_status: ContentItemRow['governance_review_status'];
  metadata: Record<string, unknown> | null;
  /** ISO timestamp when the item was verified, null if unverified */
  verified_at?: string | null;
  /** Source document name for imported Q&A pairs */
  source_document?: string | null;
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
}

/** Content list item with read state */
export interface ContentListItemWithReadState extends ContentListItem {
  is_read: boolean;
  read_at?: string | null;
}

/** Full detail view */
export interface ContentItemDetail extends ContentListItem {
  content: ContentItemRow['content'];
  source_url: ContentItemRow['source_url'];
  file_path: ContentItemRow['file_path'];
  secondary_domain: ContentItemRow['secondary_domain'];
  secondary_subtopic: ContentItemRow['secondary_subtopic'];
  classification_reasoning: string | null;
  classified_at: string | null;
  metadata: Record<string, unknown>;
  summary_data: SummaryData | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  /** UUID of user who verified the item */
  verified_by?: string | null;
  /** Source bid reference for provenance tracking */
  source_bid?: string | null;
  /** Progressive depth: detailed explanation */
  detail?: string | null;
  /** Progressive depth: reference/technical detail */
  reference?: string | null;
  /** Standard/brief answer for Q&A pairs */
  answer_standard?: string | null;
  /** Advanced/detailed answer for Q&A pairs */
  answer_advanced?: string | null;
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

/** Normalise SummaryData from JSONB */
export function normaliseSummaryData(
  raw: Record<string, unknown>,
): SummaryData {
  return {
    executive: (raw.executive ?? '') as string,
    detailed: (raw.detailed ?? '') as string,
    takeaways: (raw.takeaways ?? []) as string[],
    generated_at: (raw.generated_at ?? '') as string,
    model: (raw.model ?? '') as string,
    tokens_used: raw.tokens_used as number | undefined,
  };
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

/** Highlight category types */
export type HighlightCategory =
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

/** Workspace (from workspaces table) */
export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  type: string;
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
  sort?: 'captured_date' | 'classification_confidence' | 'primary_domain';
  order?: 'asc' | 'desc';
}

/** Columns selected for list/grid views */
export const CONTENT_LIST_COLUMNS = `
  id, title, suggested_title, ai_summary,
  primary_domain, primary_subtopic, content_type, platform,
  author_name, source_domain, thumbnail_url, captured_date,
  ai_keywords, classification_confidence, priority, freshness, user_tags, governance_review_status, metadata,
  verified_at, source_document, brief, content,
  answer_standard, answer_advanced,
  content_owner_id
` as const;

/** Columns selected for detail view */
export const CONTENT_DETAIL_COLUMNS = `
  ${CONTENT_LIST_COLUMNS},
  source_url, file_path, secondary_domain, secondary_subtopic,
  classification_reasoning, classified_at, summary_data,
  created_at, updated_at, created_by, updated_by,
  verified_by, source_bid, detail, reference,
  governance_review_status, governance_review_due, governance_reviewer_id
` as const;
