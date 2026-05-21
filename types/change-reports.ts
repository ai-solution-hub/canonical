export interface ChangeReportFilters {
  domain?: string;
  keywords?: string[];
  date_from?: string;
  date_to?: string;
}

export interface ChangeReportDomainSummary {
  domain: string;
  item_count: number;
  summary: string;
  top_items: {
    id: string;
    title: string;
    content_type?: string;
    why_notable?: string;
    summary?: string | null;
  }[];
  key_themes: string[];
}

export interface ChangeReportGovernanceSummary {
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

export interface ChangeReport {
  id: string;
  digest_type: string;
  period_start: string;
  period_end: string;
  item_count: number;
  domain_summaries: ChangeReportDomainSummary[];
  narrative_summary: string | null;
  generated_at: string;
  generated_by: string;
  tokens_used: number | null;
  item_ids?: string[];
  filters?: ChangeReportFilters | null;
  governance_summary?: ChangeReportGovernanceSummary | null;
  created_at: string;
}

export interface ChangeReportGenerateResponse {
  digest: ChangeReport;
}
