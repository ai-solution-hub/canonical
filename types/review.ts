import type { ContentListItem } from './content';

// -- Action types --

export type ReviewActionType =
  | 'verify'
  | 'flag'
  | 'skip'
  | 'unverify'
  | 'unflag';

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
}

// -- Action payload --

export interface ReviewAction {
  item_id: string;
  action: ReviewActionType;
  flag_details?: string;
}

// -- Progress tracking --

export interface ReviewProgress {
  verified: number;
  flagged: number;
  skipped: number;
  total: number;
  sessionReviewed: number;
}

// -- Session state --

export interface ReviewSession {
  filters: ReviewFilters;
  startedAt: string;
  progress: ReviewProgress;
  currentIndex: number;
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
  by_domain: Record<string, { total: number; verified: number }>;
  by_content_type: Record<string, { total: number; verified: number }>;
  by_source_file: Record<string, { total: number; verified: number }>;
  by_source_document: Record<
    string,
    { total: number; verified: number; name: string }
  >;
}
