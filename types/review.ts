import type { ContentListItem } from './content';

export type ReviewActionType =
  | 'read'
  | 'skip'
  | 'star'
  | 'undo_read'
  | 'undo_star';

export interface ReviewFilters {
  domain?: string[];
  content_type?: string[];
  platform?: string[];
}

export interface ReviewAction {
  item_id: string;
  action: ReviewActionType;
}

export interface ReviewProgress {
  reviewed: number;
  skipped: number;
  starred: number;
  total: number;
}

export interface ReviewSession {
  filters: ReviewFilters;
  startedAt: string;
  progress: ReviewProgress;
  currentIndex: number;
}

export interface ReviewQueueItem extends ContentListItem {
  source_url: string | null;
}

export interface ReviewQueueResponse {
  items: ReviewQueueItem[];
  total: number;
  cursor?: string;
}
