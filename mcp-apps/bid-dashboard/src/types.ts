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

/** Individual question in a bid section */
export interface BidQuestionSummary {
  id: string;
  question_text: string;
  status: string;
  confidence_posture: string | null;
  word_limit: number | null;
  has_response: boolean;
  review_status: string | null;
}

/** A section grouping questions within a bid */
export interface BidSection {
  name: string;
  questions: BidQuestionSummary[];
}

/** Data from get_bid_question drill-down (individual question) */
export interface BidQuestionDetailData {
  id: string;
  question_text: string;
  section_name: string | null;
  word_limit: number | null;
  confidence_posture: string | null;
  status: string | null;
  response_text: string | null;
  review_status: string | null;
}

/** KB search result for "Find KB content" */
export interface KBSearchResult {
  id: string;
  title: string | null;
  suggested_title: string | null;
  content_type: string | null;
  primary_domain: string | null;
  ai_summary: string | null;
  similarity: number;
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
  sections: BidSection[];
  status_breakdown: Record<string, number>;
  confidence_breakdown: Record<string, number>;
}

/** Urgency level derived from days_until_deadline */
export type Urgency = 'overdue' | 'urgent' | 'approaching' | 'normal' | 'none';

/** State for an expanded question within the bid detail */
export interface ExpandedQuestionState {
  questionId: string;
  loading: boolean;
  detail: BidQuestionDetailData | null;
  kbResults: KBSearchResult[] | null;
  kbSearchLoading: boolean;
  error?: string;
}

/** State for expanded bid detail */
export interface ExpandedBidState {
  bidId: string;
  loading: boolean;
  detail: BidDetailData | null;
  error?: string;
  expandedQuestion: ExpandedQuestionState | null;
}
