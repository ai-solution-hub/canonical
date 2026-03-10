/** Data shape from the show_bid_dashboard trigger tool */
export interface BidDashboardData {
  offset: number;
  count: number;
  total_count: number;
  has_more: boolean;
  bids: BidSummary[];
  focused_bid_detail?: BidDetailData;
}

export interface BidSummary {
  id: string;
  name: string;
  buyer: string | null;
  status: string;
  deadline: string | null;
  days_until_deadline: number | null;
  total_questions: number;
  answered_questions: number;
  approved_questions: number;
}

/** Data shape from get_bid_detail drill-down */
export interface BidDetailData {
  id: string;
  name: string;
  buyer: string | null;
  status: string;
  deadline: string | null;
  reference_number: string | null;
  description: string | null;
  question_stats: {
    total_questions: number;
    strong_match_count: number;
    partial_match_count: number;
    needs_sme_count: number;
    no_content_count: number;
    unmatched_count: number;
    drafted_count: number;
    complete_count: number;
  } | null;
}

/** Urgency level derived from days_until_deadline */
export type Urgency = "overdue" | "urgent" | "approaching" | "normal" | "none";

/** State for expanded bid detail */
export interface ExpandedBidState {
  bidId: string;
  loading: boolean;
  detail: BidDetailData | null;
  error?: string;
}
