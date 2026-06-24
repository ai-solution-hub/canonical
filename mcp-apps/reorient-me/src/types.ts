/** Data shape from show_reorient_me trigger tool structuredContent */
export interface ReorientAppData {
  last_active_at: string | null;
  last_active_relative: string;
  urgent: UrgentItem[];
  team_changes: TeamChange[];
  my_recent_work: RecentWorkItem[];
  bid_summary: BidBriefing[];
  counts: {
    unread_notifications: number;
    pending_reviews: number;
    stale_or_expired: number;
    quality_flags: number;
  };
  generated_at: string;
  user_display_name: string | null;
  errors: string[];
}

export interface UrgentItem {
  type:
    | 'procurement_deadline'
    | 'review_pending'
    | 'content_expired'
    | 'quality_flag'
    | 'notification';
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
  entity_type: 'content_item' | 'bid_response';
  entity_id: string;
  entity_title: string;
  domain?: string;
  created_at: string;
  workspace_id?: string;
  question_id?: string;
}

export interface RecentWorkItem {
  entity_type: 'content_item' | 'bid_response';
  entity_id: string;
  entity_title: string;
  action: 'edited' | 'created' | 'reviewed' | 'drafted';
  href: string;
  created_at: string;
  workspace_id?: string;
  question_id?: string;
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
