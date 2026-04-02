export interface DigestConfig {
  period_days: number;
  digest_type: 'weekly' | 'daily' | 'custom';
  domain?: string;
  keywords?: string[];
  date_from?: string;
  date_to?: string;
}

export interface DigestFilters {
  domain?: string;
  keywords?: string[];
  date_from?: string;
  date_to?: string;
}

export interface DigestDomainSummary {
  domain: string;
  item_count: number;
  summary: string;
  top_items: {
    id: string;
    title: string;
    content_type?: string;
    why_notable?: string;
    ai_summary?: string | null;
  }[];
  key_themes: string[];
}

export interface DigestGovernanceSummary {
  items_modified: number;
  items_verified: number;
  items_flagged: number;
  freshness_breakdown?: {
    fresh: number;
    aging: number;
    stale: number;
    expired: number;
  };
}

export interface Digest {
  id: string;
  digest_type: string;
  period_start: string;
  period_end: string;
  item_count: number;
  domain_summaries: DigestDomainSummary[];
  theme_clusters: ThemeCluster[];
  narrative_summary: string | null;
  generated_at: string;
  generated_by: string;
  tokens_used: number | null;
  item_ids?: string[];
  filters?: DigestFilters | null;
  governance_summary?: DigestGovernanceSummary | null;
  created_at: string;
}

export interface ThemeCluster {
  theme: string;
  item_count: number;
  description: string;
}

export interface DigestGenerateRequest {
  period_days?: number;
  digest_type?: 'weekly' | 'daily' | 'custom';
  domain?: string;
  keywords?: string[];
  date_from?: string;
  date_to?: string;
}

export interface DigestGenerateResponse {
  digest: Digest;
}
