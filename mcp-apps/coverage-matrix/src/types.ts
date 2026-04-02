export interface CoverageMatrixData {
  total_items: number;
  freshness: {
    fresh: number;
    aging: number;
    stale: number;
    expired: number;
  };
  domains: Array<{
    name: string;
    total_items: number;
    fresh: number;
    aging: number;
    stale: number;
    expired: number;
    subtopics: Array<{
      name: string;
      total_items: number;
      fresh: number;
      aging: number;
      stale: number;
      expired: number;
    }>;
  }>;
  quality: {
    total_flagged: number;
    by_issue_type: Record<string, number>;
  };
  gaps: Array<{
    domain: string;
    subtopic: string | null;
    item_count: number;
    issue: 'empty' | 'thin' | 'stale_only';
  }>;
}

export interface SubtopicRow {
  name: string;
  total_items: number;
  fresh: number;
  aging: number;
  stale: number;
  expired: number;
}

export interface DomainRow {
  name: string;
  total_items: number;
  fresh: number;
  aging: number;
  stale: number;
  expired: number;
  subtopics: SubtopicRow[];
  expanded: boolean;
}

/** Search result item from search_knowledge_base tool */
export interface SearchResultItem {
  id: string;
  title: string | null;
  suggested_title: string | null;
  content_type: string | null;
  primary_domain: string | null;
  primary_subtopic: string | null;
  ai_summary: string | null;
  similarity: number;
}

/** Detail panel state */
export interface DetailPanelState {
  domain: string;
  subtopic?: string;
  freshnessFilter?: string;
  loading: boolean;
  items: SearchResultItem[];
  error?: string;
}

/** Freshness state key used in data objects */
export type FreshnessKey = 'fresh' | 'aging' | 'stale' | 'expired';

/** Display labels for freshness states (UK English) */
export const FRESHNESS_LABELS: Record<FreshnessKey, string> = {
  fresh: 'Fresh',
  aging: 'Ageing',
  stale: 'Stale',
  expired: 'Expired',
};
