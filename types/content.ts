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
  user_tags: ContentItemRow['user_tags'];
  metadata: Record<string, unknown> | null;
  /** ISO timestamp when the item was verified, null if unverified */
  verified_at?: string | null;
  /** Source document name for imported Q&A pairs */
  source_document?: string | null;
  /** Brief/executive summary for progressive depth */
  brief?: string | null;
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
}

/** Multi-level summary data stored as JSONB on content_items */
export interface SummaryData {
  executive: string;
  detailed: string;
  takeaways: string[];
  generated_at: string;
  model: string;
  tokens_used?: number;
  /** @deprecated Use `executive` — kept for backwards compatibility with pre-session-12 data */
  one_line?: string;
  /** @deprecated Use `model` — kept for backwards compatibility with pre-session-12 data */
  generated_by?: string;
}

/** Normalise SummaryData from JSONB (handles old field names) */
export function normaliseSummaryData(
  raw: Record<string, unknown>,
): SummaryData {
  return {
    executive: (raw.executive ?? raw.one_line ?? '') as string,
    detailed: (raw.detailed ?? '') as string,
    takeaways: (raw.takeaways ?? []) as string[],
    generated_at: (raw.generated_at ?? '') as string,
    model: (raw.model ?? raw.generated_by ?? '') as string,
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

/** Project (from projects table) */
export interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
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
  project?: string; // project UUID
  user_tags?: string[]; // user tag strings
  sort?: 'captured_date' | 'classification_confidence' | 'primary_domain';
  order?: 'asc' | 'desc';
}

/** Columns selected for list/grid views */
export const CONTENT_LIST_COLUMNS = `
  id, title, suggested_title, ai_summary,
  primary_domain, primary_subtopic, content_type, platform,
  author_name, source_domain, thumbnail_url, captured_date,
  ai_keywords, classification_confidence, priority, user_tags, metadata,
  verified_at, source_document, brief
` as const;

/** Columns selected for detail view */
export const CONTENT_DETAIL_COLUMNS = `
  ${CONTENT_LIST_COLUMNS},
  content, source_url, file_path, secondary_domain, secondary_subtopic,
  classification_reasoning, summary_data,
  created_at, updated_at, created_by, updated_by,
  verified_by, source_bid, detail, reference
` as const;
