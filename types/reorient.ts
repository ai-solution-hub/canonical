export interface ReorientData {
  /** ISO timestamp of the user's last activity in the system */
  last_active_at: string | null;
  /** Human-readable relative time ("2 hours ago", "yesterday") */
  last_active_relative: string;
  /** Urgent items requiring immediate attention, sorted by priority */
  urgent: UrgentItem[];
  /** Changes made by others since the user was last active */
  team_changes: TeamChange[];
  /** The user's own recent work for context continuity */
  my_recent_work: RecentWorkItem[];
  /** Active bids with deadline proximity and completion gaps */
  bid_summary: BidBriefing[];
  /** Aggregate counts */
  counts: {
    unread_notifications: number;
    pending_reviews: number;
    stale_or_expired: number;
    quality_flags: number;
  };
  /** ISO timestamp of when this response was generated */
  generated_at: string;
  /** User display name for greeting */
  user_display_name: string | null;
  /** Errors from partial query failures */
  errors: string[];
}

export interface UrgentItem {
  type: 'bid_deadline' | 'review_pending' | 'content_expired' | 'quality_flag' | 'notification';
  priority: 1 | 2 | 3;
  title: string;
  detail: string;
  href: string;
  entity_id: string;
  deadline?: string | null;
}

export interface TeamChange {
  user_id: string;
  user_name: string | null;
  action: 'created' | 'updated' | 'reviewed' | 'flagged';
  /**
   * 'content_item' — sourced from `content_history` (tracks content_items edits)
   * 'bid_response' — sourced from `bid_response_history` (tracks bid response edits)
   * Q&A pair changes go through `content_history` if stored as content_items.
   */
  entity_type: 'content_item' | 'bid_response';
  entity_id: string;
  entity_title: string;
  domain?: string;
  created_at: string;
}

export interface RecentWorkItem {
  entity_type: 'content_item' | 'bid_response';
  entity_id: string;
  entity_title: string;
  action: 'edited' | 'created' | 'reviewed' | 'drafted';
  href: string;
  created_at: string;
}

export interface BidBriefing {
  id: string;
  name: string;
  buyer: string | null;
  status: string;
  deadline: string | null;
  days_until_deadline: number | null;
  urgency: 'overdue' | 'urgent' | 'approaching' | 'normal' | 'unknown';
  total_questions: number;
  answered_questions: number;
  approved_questions: number;
  gap_count: number;
  href: string;
}
