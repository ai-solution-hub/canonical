/**
 * Unified Attention Data Model
 *
 * Provides a single, sorted list of "things that need attention" for the
 * dashboard. Each attention source has a producer function that returns
 * AttentionItem[]. The aggregate function runs all producers, sorts by
 * severity and deadline proximity, and returns a flat list.
 *
 * Designed for Phase 2a of the Dashboard Unified Attention Model
 * (see docs/reference/dashboard-attention-model-s108.md Section 4).
 */

import type { ActiveProcurementSummary } from '@/lib/dashboard';
import { getDeadlineUrgency } from '@/lib/dashboard';

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/**
 * A single attention item — the atomic unit of "something needs your attention."
 * All attention sources produce these. The dashboard consumes a flat, sorted list.
 */
export interface AttentionItem {
  /** Unique identifier for deduplication and React keys */
  id: string;

  /** Categorical type for icon/colour selection */
  type:
    | 'governance_review'
    | 'stale_content'
    | 'expired_content'
    | 'quality_flag'
    | 'unverified_content'
    | 'procurement_deadline'
    | 'expiring_certification'
    | 'expiring_content_date'
    | 'source_document_change'
    | 'coverage_gap'
    | 'taxonomy_coverage'
    | 'unread_notifications';

  /** Four-tier severity for sort ordering */
  severity: 'critical' | 'high' | 'medium' | 'info';

  /** Entity reference for linking */
  entity_type:
    | 'content_item'
    | 'workspace'
    | 'entity'
    | 'source_document'
    | 'aggregate';
  entity_id: string;

  /** Human-readable summary */
  title: string;
  detail: string;

  /** Navigation target */
  action_url: string;
  action_label: string;

  /** Role-based visibility */
  role_visibility: ('admin' | 'editor' | 'viewer')[];

  /** Optional Claude prompt for ClaudePromptButton integration */
  claude_prompt?: string;

  /** Count for aggregate items (e.g. "5 items need refreshing") */
  count?: number;

  /** Deadline for time-sensitive items (bids, cert expiry) */
  deadline?: string | null;
}

/**
 * Raw data from all attention sources, passed to buildAttentionItems().
 * Mirrors the data already fetched by fetchUnifiedDashboardData().
 */
export interface AttentionSourceData {
  governance_review_count: number;
  stale_content_count: number;
  expired_content_count: number;
  quality_flag_count: number;
  unverified_count: number;
  active_bids: ActiveProcurementSummary[];
  expiring_cert_count: number;
  expiring_content_date_count: number;
  unread_notification_count: number;
  coverage_gap_count: number;
  /**
   * Count of non-archived content_items whose taxonomy classification is
   * incomplete — `primary_domain = 'unclassified'` OR
   * `primary_subtopic = 'unclassified'` (the sentinel established by ID-63
   * {63.11} NOT NULL DEFAULT 'unclassified' schema change, persisted by the
   * cocoindex flow in {63.7}). Ties the dashboard actionable-insight to the
   * Inv-7 taxonomy-coverage concept that the {63.8} flow-end webhook emits as
   * its taxonomy-miss counter. ID-63.12.
   */
  unclassified_count: number;
}

// ---------------------------------------------------------------------------
// Severity ordering
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<AttentionItem['severity'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  info: 3,
};

// ---------------------------------------------------------------------------
// Producer functions — one per attention source
// ---------------------------------------------------------------------------

/**
 * Governance reviews pending — critical severity.
 * Visible to editors and admins who can act on reviews.
 */
export function produceGovernanceReviewItems(count: number): AttentionItem[] {
  if (count <= 0) return [];

  return [
    {
      id: 'attention-governance-review',
      type: 'governance_review',
      severity: 'critical',
      entity_type: 'aggregate',
      entity_id: 'governance-reviews',
      title: `${count} governance ${count === 1 ? 'review' : 'reviews'} pending`,
      detail: `${count} content ${count === 1 ? 'item needs' : 'items need'} governance review before ${count === 1 ? 'it can' : 'they can'} be published.`,
      action_url: '/review',
      action_label: 'Review items',
      role_visibility: ['admin', 'editor'],
      claude_prompt: `There are ${count} governance reviews pending. Show me the items that need review and help me work through them.`,
      count,
    },
  ];
}

/**
 * Stale and expired content — high severity.
 * Visible to all roles (viewers see read-only awareness).
 */
export function produceStaleContentItems(
  staleCount: number,
  expiredCount: number,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (expiredCount > 0) {
    items.push({
      id: 'attention-expired-content',
      type: 'expired_content',
      severity: 'high',
      entity_type: 'aggregate',
      entity_id: 'expired-content',
      title: `${expiredCount} expired content ${expiredCount === 1 ? 'item' : 'items'}`,
      detail: `${expiredCount} ${expiredCount === 1 ? 'item has' : 'items have'} passed ${expiredCount === 1 ? 'its' : 'their'} freshness threshold and ${expiredCount === 1 ? 'needs' : 'need'} urgent refreshing.`,
      action_url: '/browse?freshness=expired',
      action_label: 'View expired content',
      role_visibility: ['admin', 'editor', 'viewer'],
      claude_prompt: `There are ${expiredCount} expired content items. Show me what has expired and help me prioritise which to refresh first.`,
      count: expiredCount,
    });
  }

  if (staleCount > 0) {
    items.push({
      id: 'attention-stale-content',
      type: 'stale_content',
      severity: 'high',
      entity_type: 'aggregate',
      entity_id: 'stale-content',
      title: `${staleCount} stale content ${staleCount === 1 ? 'item' : 'items'}`,
      detail: `${staleCount} ${staleCount === 1 ? 'item is' : 'items are'} approaching ${staleCount === 1 ? 'its' : 'their'} freshness limit and should be reviewed soon.`,
      action_url: '/browse?freshness=stale',
      action_label: 'Refresh content',
      role_visibility: ['admin', 'editor', 'viewer'],
      claude_prompt: `There are ${staleCount} stale content items. Show me what is going stale and suggest a refresh plan.`,
      count: staleCount,
    });
  }

  return items;
}

/**
 * Quality flags (unresolved) — high severity.
 * Visible to editors and admins.
 */
export function produceQualityFlagItems(count: number): AttentionItem[] {
  if (count <= 0) return [];

  return [
    {
      id: 'attention-quality-flags',
      type: 'quality_flag',
      severity: 'high',
      entity_type: 'aggregate',
      entity_id: 'quality-flags',
      title: `${count} quality ${count === 1 ? 'flag' : 'flags'} unresolved`,
      detail: `${count} content ${count === 1 ? 'item has' : 'items have'} unresolved quality ${count === 1 ? 'flag' : 'flags'} that ${count === 1 ? 'needs' : 'need'} attention.`,
      action_url: '/browse?has_quality_flags=true',
      action_label: 'Review flagged items',
      role_visibility: ['admin', 'editor'],
      claude_prompt: `There are ${count} unresolved quality flags. Show me the flagged items and help me assess what needs fixing.`,
      count,
    },
  ];
}

/**
 * Unverified content items — medium severity.
 * Visible to editors and admins.
 */
export function produceUnverifiedItems(count: number): AttentionItem[] {
  if (count <= 0) return [];

  return [
    {
      id: 'attention-unverified',
      type: 'unverified_content',
      severity: 'medium',
      entity_type: 'aggregate',
      entity_id: 'unverified-content',
      title: `${count} unverified ${count === 1 ? 'item' : 'items'}`,
      detail: `${count} content ${count === 1 ? 'item has' : 'items have'} not been verified by a human reviewer.`,
      action_url: '/browse?verified=false',
      action_label: 'Verify items',
      role_visibility: ['admin', 'editor'],
      claude_prompt: `There are ${count} unverified content items. Show me the unverified items so I can review and verify them.`,
      count,
    },
  ];
}

/**
 * Active bid deadlines — severity varies by urgency.
 * Visible to all roles.
 */
export function produceProcurementDeadlineItems(
  bids: ActiveProcurementSummary[],
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const bid of bids) {
    const urgency = getDeadlineUrgency(bid.deadline);

    // Only produce attention items for overdue, urgent, or approaching deadlines
    if (urgency === 'normal' || urgency === 'unknown') continue;

    const severityMap: Record<string, AttentionItem['severity']> = {
      overdue: 'critical',
      urgent: 'high',
      approaching: 'medium',
    };

    const severity = severityMap[urgency] ?? 'medium';
    const daysText =
      bid.days_until_deadline !== null
        ? bid.days_until_deadline < 0
          ? `${Math.abs(bid.days_until_deadline)} ${Math.abs(bid.days_until_deadline) === 1 ? 'day' : 'days'} overdue`
          : bid.days_until_deadline === 0
            ? 'due today'
            : `${bid.days_until_deadline} ${bid.days_until_deadline === 1 ? 'day' : 'days'} remaining`
        : 'deadline approaching';

    const progress =
      bid.total_questions > 0
        ? `${bid.answered_questions}/${bid.total_questions} questions answered`
        : '';

    items.push({
      id: `attention-procurement-${bid.id}`,
      type: 'procurement_deadline',
      severity,
      entity_type: 'workspace',
      entity_id: bid.id,
      title: `${bid.name}: ${daysText}`,
      detail: [
        bid.buyer ? `Buyer: ${bid.buyer}.` : '',
        progress,
        urgency === 'overdue' ? 'This bid is past its deadline.' : '',
      ]
        .filter(Boolean)
        .join(' '),
      action_url: `/bids/${bid.id}`,
      action_label: 'View bid',
      role_visibility: ['admin', 'editor', 'viewer'],
      claude_prompt: `Show me the status of the "${bid.name}" bid. What questions still need answering? Help me prioritise the remaining work.`,
      deadline: bid.deadline,
    });
  }

  return items;
}

/**
 * Expiring certifications — info severity for approaching, critical for expired.
 * Visible to all roles.
 */
export function produceExpiringCertItems(
  expiringCount: number,
): AttentionItem[] {
  if (expiringCount <= 0) return [];

  return [
    {
      id: 'attention-expiring-certs',
      type: 'expiring_certification',
      severity: 'info',
      entity_type: 'aggregate',
      entity_id: 'expiring-certifications',
      title: `${expiringCount} ${expiringCount === 1 ? 'certification' : 'certifications'} expiring soon`,
      detail: `${expiringCount} ${expiringCount === 1 ? 'certification is' : 'certifications are'} approaching ${expiringCount === 1 ? 'its' : 'their'} expiry date within the next 90 days.`,
      action_url: '/compliance',
      action_label: 'View certifications',
      role_visibility: ['admin', 'editor', 'viewer'],
      count: expiringCount,
    },
  ];
}

/**
 * Content with approaching expiry dates — medium severity.
 * Visible to all roles.
 */
export function produceExpiringContentDateItems(
  count: number,
): AttentionItem[] {
  if (count <= 0) return [];

  return [
    {
      id: 'attention-expiring-content-dates',
      type: 'expiring_content_date',
      severity: 'medium',
      entity_type: 'aggregate',
      entity_id: 'expiring-content-dates',
      title: `${count} content ${count === 1 ? 'item' : 'items'} expiring within 30 days`,
      detail: `${count} ${count === 1 ? 'item has' : 'items have'} a set expiry date within the next 30 days and ${count === 1 ? 'needs' : 'need'} updating or replacing.`,
      action_url: '/browse?expiring_soon=true',
      action_label: 'View expiring content',
      role_visibility: ['admin', 'editor', 'viewer'],
      claude_prompt: `There are ${count} content items with expiry dates within 30 days. Show me what is expiring and help me plan updates.`,
      count,
    },
  ];
}

/**
 * Unread notifications — medium severity, only fires at threshold (5+).
 * Visible to all roles.
 */
export function produceUnreadNotificationItems(count: number): AttentionItem[] {
  if (count < 5) return [];

  return [
    {
      id: 'attention-unread-notifications',
      type: 'unread_notifications',
      severity: 'medium',
      entity_type: 'aggregate',
      entity_id: 'unread-notifications',
      // count is always >= 5 here (guarded above) — always plural
      title: `${count} unread notifications`,
      detail: `You have ${count} unread notifications. Use the notification bell in the header to review them.`,
      action_url: '/',
      action_label: 'Go to dashboard',
      role_visibility: ['admin', 'editor', 'viewer'],
      count,
    },
  ];
}

/**
 * Coverage gaps — info severity.
 * Visible to editors and admins who manage content.
 */
export function produceCoverageGapItems(gapCount: number): AttentionItem[] {
  if (gapCount <= 0) return [];

  return [
    {
      id: 'attention-coverage-gaps',
      type: 'coverage_gap',
      severity: 'info',
      entity_type: 'aggregate',
      entity_id: 'coverage-gaps',
      title: `${gapCount} coverage ${gapCount === 1 ? 'gap' : 'gaps'} identified`,
      detail: `${gapCount} ${gapCount === 1 ? 'area has' : 'areas have'} insufficient or missing content coverage.`,
      action_url: '/coverage',
      action_label: 'View coverage gaps',
      role_visibility: ['admin', 'editor'],
      claude_prompt: `There are ${gapCount} coverage gaps in the knowledge base. Show me the gaps and suggest which to address first.`,
      count: gapCount,
    },
  ];
}

/**
 * Taxonomy-coverage gap — info severity.
 *
 * Surfaces content_items that landed on the 'unclassified' taxonomy sentinel
 * (ID-63 {63.11} NOT NULL DEFAULT 'unclassified'): rows where the classifier
 * could not place the item in a known domain/subtopic. This is the
 * dashboard-side mirror of the Inv-7 taxonomy-miss counter that the {63.8}
 * flow-end webhook emits, and complements the /review "Unclassified" tab. The
 * action routes the editor straight to that tab so the sentinel rows can be
 * reclassified. Visible to editors and admins who manage content. ID-63.12.
 */
export function produceTaxonomyCoverageItems(count: number): AttentionItem[] {
  if (count <= 0) return [];

  return [
    {
      id: 'attention-taxonomy-coverage',
      type: 'taxonomy_coverage',
      severity: 'info',
      entity_type: 'aggregate',
      entity_id: 'taxonomy-coverage',
      title: `${count} unclassified content ${count === 1 ? 'item' : 'items'}`,
      detail: `${count} content ${count === 1 ? 'item could' : 'items could'} not be placed in the taxonomy and ${count === 1 ? 'is' : 'are'} marked unclassified. Reclassify ${count === 1 ? 'it' : 'them'} so the knowledge base stays fully covered.`,
      action_url: '/review?tab=unclassified',
      action_label: 'Reclassify items',
      role_visibility: ['admin', 'editor'],
      claude_prompt: `There are ${count} unclassified content items that fell outside the taxonomy. Show me the unclassified items and help me assign the right domain and subtopic to each.`,
      count,
    },
  ];
}

// ---------------------------------------------------------------------------
// Sort and filter functions
// ---------------------------------------------------------------------------

/**
 * Sort attention items by severity (critical > high > medium > info),
 * then by deadline proximity for items with deadlines (nearest first).
 */
export function sortAttentionItems(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => {
    // Primary sort: severity
    const severityDiff =
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (severityDiff !== 0) return severityDiff;

    // Secondary sort: deadline proximity (items with deadlines come first,
    // nearest deadline first)
    const aDeadline = a.deadline ? new Date(a.deadline).getTime() : null;
    const bDeadline = b.deadline ? new Date(b.deadline).getTime() : null;

    if (aDeadline !== null && bDeadline !== null) {
      return aDeadline - bDeadline;
    }
    if (aDeadline !== null) return -1;
    if (bDeadline !== null) return 1;

    return 0;
  });
}

/**
 * Filter attention items by user role.
 * An item is visible if the role appears in its role_visibility array.
 */
export function filterByRole(
  items: AttentionItem[],
  role: string,
): AttentionItem[] {
  return items.filter((item) =>
    item.role_visibility.includes(role as 'admin' | 'editor' | 'viewer'),
  );
}

// ---------------------------------------------------------------------------
// Aggregate function
// ---------------------------------------------------------------------------

/**
 * Build the complete attention items list from raw source data.
 * Runs all producers, concatenates results, and sorts by severity.
 */
export function buildAttentionItems(
  data: AttentionSourceData,
): AttentionItem[] {
  const allItems: AttentionItem[] = [
    ...produceGovernanceReviewItems(data.governance_review_count),
    ...produceStaleContentItems(
      data.stale_content_count,
      data.expired_content_count,
    ),
    ...produceQualityFlagItems(data.quality_flag_count),
    ...produceUnverifiedItems(data.unverified_count),
    ...produceProcurementDeadlineItems(data.active_bids),
    ...produceExpiringCertItems(data.expiring_cert_count),
    ...produceExpiringContentDateItems(data.expiring_content_date_count),
    ...produceUnreadNotificationItems(data.unread_notification_count),
    ...produceCoverageGapItems(data.coverage_gap_count),
    ...produceTaxonomyCoverageItems(data.unclassified_count),
  ];

  return sortAttentionItems(allItems);
}
