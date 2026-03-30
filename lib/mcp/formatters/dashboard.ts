/**
 * Dashboard and reorientation formatters for MCP tool responses.
 */
import type { ActiveBidSummary, DashboardData, GroupedActivityItem } from '@/lib/dashboard';
import type { ReorientData } from '@/types/reorient';
import { formatDeadline, formatProgress } from './shared';
import { formatDateUK } from '@/lib/format';
import { formatEntityDisplayName } from '@/lib/entities/entity-dedup';

// ---------------------------------------------------------------------------
// Expiring content types
// ---------------------------------------------------------------------------

export interface ExpiringContentItem {
  id: string;
  title: string;
  expiry_date: string;
  days_remaining: number;
  domain: string | null;
  lifecycle_type: string | null;
}

export interface ExpiringEntityMention {
  canonical_name: string;
  entity_type: string;
  expiry_date: string;
  days_remaining: number;
  expiry_status: string;
}

export interface ExpiringContentData {
  content_items: ExpiringContentItem[];
  entity_mentions: ExpiringEntityMention[];
  days_ahead: number;
}

// ---------------------------------------------------------------------------
// Dashboard summary
// ---------------------------------------------------------------------------

export function formatDashboardSummary(data: DashboardData): string {
  const lines: string[] = [
    '# Knowledge Base Dashboard',
    '',
    '## Attention Required',
    '',
  ];

  const attn = data.needs_attention;
  const attentionItems: string[] = [];

  if (attn.expired_content_count && attn.expired_content_count > 0) {
    attentionItems.push(`- ${attn.expired_content_count} expired content item${attn.expired_content_count === 1 ? '' : 's'}`);
  }
  if (attn.stale_content_count && attn.stale_content_count > 0) {
    attentionItems.push(`- ${attn.stale_content_count} stale content item${attn.stale_content_count === 1 ? '' : 's'}`);
  }
  if (attn.governance_review_count && attn.governance_review_count > 0) {
    attentionItems.push(`- ${attn.governance_review_count} governance review${attn.governance_review_count === 1 ? '' : 's'} pending`);
  }
  if (attn.quality_flag_count && attn.quality_flag_count > 0) {
    attentionItems.push(`- ${attn.quality_flag_count} quality flag${attn.quality_flag_count === 1 ? '' : 's'} unresolved`);
  }
  if (attn.unverified_count && attn.unverified_count > 0) {
    attentionItems.push(`- ${attn.unverified_count} unverified item${attn.unverified_count === 1 ? '' : 's'}`);
  }

  if (attentionItems.length === 0) {
    lines.push('No items require immediate attention.');
  } else {
    lines.push(...attentionItems);
  }

  // Freshness breakdown
  lines.push('', '## Content Freshness', '');
  const f = data.freshness_summary;
  const totalContent = f.fresh + f.aging + f.stale + f.expired;
  lines.push(`- **Fresh:** ${f.fresh} (${formatProgress(f.fresh, totalContent)})`);
  lines.push(`- **Aging:** ${f.aging} (${formatProgress(f.aging, totalContent)})`);
  lines.push(`- **Stale:** ${f.stale} (${formatProgress(f.stale, totalContent)})`);
  lines.push(`- **Expired:** ${f.expired} (${formatProgress(f.expired, totalContent)})`);
  lines.push(`- **Total:** ${totalContent} items`);

  // Active bids
  if (data.active_bids.length > 0) {
    lines.push('', '## Active Bids', '');
    for (const bid of data.active_bids) {
      const progress = formatProgress(bid.answered_questions, bid.total_questions);
      const deadline = formatDeadline(bid.deadline, bid.days_until_deadline);
      lines.push(`### ${bid.name}`);
      lines.push(`- **Buyer:** ${bid.buyer ?? 'Not specified'}`);
      lines.push(`- **Status:** ${bid.status}`);
      lines.push(`- **Deadline:** ${deadline}`);
      lines.push(`- **Progress:** ${bid.answered_questions}/${bid.total_questions} questions answered (${progress})`);
      lines.push('');
    }
  } else {
    lines.push('', '## Active Bids', '', 'No active bids.');
  }

  // Recent activity
  const activity = data.recent_activity as GroupedActivityItem[];
  if (activity.length > 0) {
    lines.push('', '## Recent Activity', '');
    for (const item of activity.slice(0, 5)) {
      const count = item.event_count > 1 ? ` (${item.event_count} events)` : '';
      lines.push(`- ${item.summary}${count}`);
    }
  }

  // Notifications
  if (data.unread_notification_count > 0) {
    lines.push('', `**${data.unread_notification_count} unread notification${data.unread_notification_count === 1 ? '' : 's'}**`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Active bids list
// ---------------------------------------------------------------------------

export function formatActiveBids(bids: ActiveBidSummary[]): string {
  if (bids.length === 0) {
    return '# Active Bids\n\nNo active bids found.';
  }

  const lines: string[] = [
    '# Active Bids',
    '',
    `${bids.length} active bid${bids.length === 1 ? '' : 's'}:`,
    '',
  ];

  for (const bid of bids) {
    const progress = formatProgress(bid.answered_questions, bid.total_questions);
    const deadline = formatDeadline(bid.deadline, bid.days_until_deadline);

    lines.push(`## ${bid.name}`);
    lines.push(`- **Buyer:** ${bid.buyer ?? 'Not specified'}`);
    lines.push(`- **Status:** ${bid.status}`);
    lines.push(`- **Deadline:** ${deadline}`);
    lines.push(`- **Questions:** ${bid.answered_questions}/${bid.total_questions} answered (${progress})`);
    lines.push(`- **Approved:** ${bid.approved_questions}/${bid.total_questions}`);
    lines.push(`- **ID:** ${bid.id}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Freshness report
// ---------------------------------------------------------------------------

export interface FreshnessReport {
  fresh: number;
  aging: number;
  stale: number;
  expired: number;
}

export function formatFreshnessReport(data: FreshnessReport): string {
  const total = data.fresh + data.aging + data.stale + data.expired;
  const lines: string[] = [
    '# Content Freshness Report',
    '',
    `**Total items:** ${total}`,
    '',
    `- **Fresh:** ${data.fresh} (${formatProgress(data.fresh, total)})`,
    `- **Aging:** ${data.aging} (${formatProgress(data.aging, total)})`,
    `- **Stale:** ${data.stale} (${formatProgress(data.stale, total)})`,
    `- **Expired:** ${data.expired} (${formatProgress(data.expired, total)})`,
  ];

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Reorientation briefing
// ---------------------------------------------------------------------------

export function formatReorientation(data: ReorientData): string {
  const greeting = data.user_display_name
    ? `Welcome back, ${data.user_display_name}.`
    : 'Welcome back.';

  const lastActive = data.last_active_relative
    ? ` You were last active ${data.last_active_relative}.`
    : '';

  const lines: string[] = [
    `# Reorientation Briefing`,
    '',
    `${greeting}${lastActive}`,
    '',
  ];

  // Urgent items
  if (data.urgent.length > 0) {
    lines.push('## Urgent Items', '');
    for (const item of data.urgent) {
      lines.push(`- **${item.title}** — ${item.detail}`);
    }
    lines.push('');
  }

  // Team changes
  if (data.team_changes.length > 0) {
    lines.push('## Team Activity', '');
    const displayed = data.team_changes.slice(0, 10);
    for (const change of displayed) {
      const who = change.user_name ?? 'A team member';
      lines.push(`- ${who} ${change.action} "${change.entity_title}"${change.domain ? ` (${change.domain})` : ''}`);
    }
    if (data.team_changes.length > 10) {
      lines.push(`- ...and ${data.team_changes.length - 10} more changes`);
    }
    lines.push('');
  }

  // Recent work
  if (data.my_recent_work.length > 0) {
    lines.push('## Your Recent Work', '');
    for (const work of data.my_recent_work) {
      lines.push(`- ${work.action} "${work.entity_title}"`);
    }
    lines.push('');
  }

  // Bid summary
  if (data.bid_summary.length > 0) {
    lines.push('## Bid Summary', '');
    for (const bid of data.bid_summary) {
      const progress = formatProgress(bid.answered_questions, bid.total_questions);
      const deadline = formatDeadline(bid.deadline, bid.days_until_deadline);
      const urgencyLabel = bid.urgency !== 'normal' && bid.urgency !== 'unknown'
        ? ` [${bid.urgency.toUpperCase()}]`
        : '';
      lines.push(`### ${bid.name}${urgencyLabel}`);
      lines.push(`- **Status:** ${bid.status}`);
      lines.push(`- **Deadline:** ${deadline}`);
      lines.push(`- **Progress:** ${bid.answered_questions}/${bid.total_questions} answered (${progress})`);
      if (bid.gap_count > 0) {
        lines.push(`- **Gaps:** ${bid.gap_count} question${bid.gap_count === 1 ? '' : 's'} need content`);
      }
      lines.push('');
    }
  }

  // Counts summary
  const counts = data.counts;
  const countItems: string[] = [];
  if (counts.unread_notifications > 0) countItems.push(`${counts.unread_notifications} unread notification${counts.unread_notifications === 1 ? '' : 's'}`);
  if (counts.pending_reviews > 0) countItems.push(`${counts.pending_reviews} pending review${counts.pending_reviews === 1 ? '' : 's'}`);
  if (counts.stale_or_expired > 0) countItems.push(`${counts.stale_or_expired} stale/expired item${counts.stale_or_expired === 1 ? '' : 's'}`);
  if (counts.quality_flags > 0) countItems.push(`${counts.quality_flags} quality flag${counts.quality_flags === 1 ? '' : 's'}`);

  if (countItems.length > 0) {
    lines.push('## At a Glance', '');
    for (const item of countItems) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Expiring content
// ---------------------------------------------------------------------------

/**
 * Urgency indicator for expiring items.
 * - OVERDUE for items past their expiry date
 * - URGENT for items expiring within 7 days
 * - SOON for items expiring within 30 days
 * - UPCOMING for items expiring further out
 */
function urgencyIndicator(daysRemaining: number): string {
  if (daysRemaining < 0) return 'OVERDUE';
  if (daysRemaining <= 7) return 'URGENT';
  if (daysRemaining <= 30) return 'SOON';
  return 'UPCOMING';
}

/**
 * Format expiring content items and entity mentions into readable markdown.
 *
 * Produces two sections:
 *   1. Expiring Content Items — KB items with approaching expiry dates
 *   2. Expiring Certifications/Registrations — entity-level expiry from
 *      entity_mentions metadata
 *
 * Each entry includes an urgency indicator and days remaining.
 */
export function formatExpiringContent(data: ExpiringContentData): string {
  const lines: string[] = [
    '# Expiring Content',
    '',
    `Looking ahead **${data.days_ahead} days** from today.`,
    '',
  ];

  // Section 1: Content items
  if (data.content_items.length > 0) {
    lines.push(`## Expiring Content Items (${data.content_items.length})`, '');
    lines.push('| Item | Domain | Expiry Date | Days Remaining | Urgency |');
    lines.push('| ---- | ------ | ----------- | -------------- | ------- |');

    for (const item of data.content_items) {
      const urgency = urgencyIndicator(item.days_remaining);
      const domain = item.domain ?? 'Unclassified';
      const dateStr = formatDateUK(item.expiry_date);
      const daysStr = item.days_remaining < 0
        ? `${Math.abs(item.days_remaining)} overdue`
        : `${item.days_remaining}`;
      lines.push(`| ${item.title} | ${domain} | ${dateStr} | ${daysStr} | ${urgency} |`);
    }
    lines.push('');
  } else {
    lines.push('## Expiring Content Items', '');
    lines.push('No content items expiring within this period.', '');
  }

  // Section 2: Entity mentions (certifications/registrations)
  if (data.entity_mentions.length > 0) {
    lines.push(`## Expiring Certifications/Registrations (${data.entity_mentions.length})`, '');
    lines.push('| Name | Type | Expiry Date | Days Remaining | Status |');
    lines.push('| ---- | ---- | ----------- | -------------- | ------ |');

    for (const entity of data.entity_mentions) {
      const urgency = urgencyIndicator(entity.days_remaining);
      const dateStr = formatDateUK(entity.expiry_date);
      const daysStr = entity.days_remaining < 0
        ? `${Math.abs(entity.days_remaining)} overdue`
        : `${entity.days_remaining}`;
      lines.push(`| ${formatEntityDisplayName(entity.canonical_name)} | ${entity.entity_type} | ${dateStr} | ${daysStr} | ${urgency} |`);
    }
    lines.push('');
  } else {
    lines.push('## Expiring Certifications/Registrations', '');
    lines.push('No certifications or registrations expiring within this period.', '');
  }

  return lines.join('\n');
}
