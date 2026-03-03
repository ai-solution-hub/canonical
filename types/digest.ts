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
  created_at: string;
  share_token?: string | null;
  share_expires_at?: string | null;
  share_branding?: DigestShareBranding | null;
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

/** Branding configuration for shared digests */
export interface DigestShareBranding {
  logo_url?: string;
  company_name?: string;
  custom_title?: string;
}

/** Share metadata attached to a digest */
export interface DigestShareInfo {
  share_token: string;
  share_url: string;
  share_expires_at: string | null;
  share_branding: DigestShareBranding | null;
}

/** Request body for POST /api/digest/[id]/share */
export interface DigestShareRequest {
  expires_in_days?: number;
  branding?: DigestShareBranding;
}

/** Response from POST /api/digest/[id]/share */
export interface DigestShareResponse {
  share: DigestShareInfo;
}

/** Public digest data returned by GET /api/share/digest/[token] */
export interface SharedDigest {
  digest_type: string;
  period_start: string;
  period_end: string;
  item_count: number;
  narrative_summary: string | null;
  domain_summaries: DigestDomainSummary[];
  theme_clusters: ThemeCluster[];
  generated_at: string;
  share_branding: DigestShareBranding | null;
  share_item_urls: Record<string, string> | null;
}
