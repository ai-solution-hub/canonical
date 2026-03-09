/**
 * Markdown formatting helpers for MCP tool responses.
 *
 * These produce LLM-friendly Markdown for the `content` field of tool results.
 * Dates are formatted as DD/MM/YYYY per UK English conventions.
 */
import { formatDateUK, formatContentType } from '@/lib/format';
import type { ActiveBidSummary, DashboardData, GroupedActivityItem } from '@/lib/dashboard';
import type { ReorientData } from '@/types/reorient';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Truncate text to a maximum length with ellipsis */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/** Format a deadline with days remaining */
function formatDeadline(deadline: string | null, daysUntil: number | null): string {
  if (!deadline) return 'No deadline set';
  const dateStr = formatDateUK(deadline);
  if (daysUntil === null) return dateStr;
  if (daysUntil < 0) return `${dateStr} (${Math.abs(daysUntil)} days overdue)`;
  if (daysUntil === 0) return `${dateStr} (due today)`;
  if (daysUntil === 1) return `${dateStr} (1 day remaining)`;
  return `${dateStr} (${daysUntil} days remaining)`;
}

/** Format a percentage from a fraction */
function formatProgress(completed: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((completed / total) * 100)}%`;
}

// ---------------------------------------------------------------------------
// Search results
// ---------------------------------------------------------------------------

export interface SearchResult {
  id: string;
  title: string | null;
  suggested_title: string | null;
  content_type: string | null;
  primary_domain: string | null;
  primary_subtopic: string | null;
  ai_summary: string | null;
  similarity: number;
}

export function formatSearchResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return `# Search Results for "${query}"\n\nNo results found. Try broadening your search terms.`;
  }

  const lines: string[] = [
    `# Search Results for "${query}"`,
    '',
    `Found ${results.length} result${results.length === 1 ? '' : 's'}:`,
    '',
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const title = r.suggested_title || r.title || 'Untitled';
    const type = formatContentType(r.content_type);
    const similarity = Math.round(r.similarity * 100);

    lines.push(`## ${i + 1}. ${title} (${type})`);

    if (r.primary_domain) {
      const domain = r.primary_subtopic
        ? `${r.primary_domain} > ${r.primary_subtopic}`
        : r.primary_domain;
      lines.push(`**Domain:** ${domain}`);
    }

    lines.push(`**Relevance:** ${similarity}%`);

    if (r.ai_summary) {
      lines.push(truncate(r.ai_summary, 300));
    }

    lines.push(`**ID:** ${r.id}`);
    lines.push('');
  }

  return lines.join('\n');
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
// Content item detail
// ---------------------------------------------------------------------------

export interface ContentItemDetail {
  id: string;
  title: string | null;
  suggested_title: string | null;
  content_type: string | null;
  primary_domain: string | null;
  primary_subtopic: string | null;
  ai_summary: string | null;
  ai_keywords: string[] | null;
  freshness: string | null;
  classification_confidence: number | null;
  source_url: string | null;
  content: string | null;
  created_at: string | null;
  updated_at: string | null;
  governance_review_status: string | null;
  priority: string | null;
}

export function formatContentItem(item: ContentItemDetail): string {
  const title = item.suggested_title || item.title || 'Untitled';
  const type = formatContentType(item.content_type);

  const lines: string[] = [
    `# ${title}`,
    '',
    `**Type:** ${type}`,
  ];

  if (item.primary_domain) {
    const domain = item.primary_subtopic
      ? `${item.primary_domain} > ${item.primary_subtopic}`
      : item.primary_domain;
    lines.push(`**Domain:** ${domain}`);
  }

  if (item.freshness) {
    lines.push(`**Freshness:** ${item.freshness}`);
  }

  if (item.priority) {
    lines.push(`**Priority:** ${item.priority}`);
  }

  if (item.classification_confidence !== null) {
    lines.push(`**Classification confidence:** ${Math.round(item.classification_confidence * 100)}%`);
  }

  if (item.governance_review_status) {
    lines.push(`**Governance status:** ${item.governance_review_status}`);
  }

  if (item.source_url) {
    lines.push(`**Source:** ${item.source_url}`);
  }

  if (item.created_at) {
    lines.push(`**Created:** ${formatDateUK(item.created_at)}`);
  }

  if (item.updated_at) {
    lines.push(`**Updated:** ${formatDateUK(item.updated_at)}`);
  }

  if (item.ai_keywords && item.ai_keywords.length > 0) {
    lines.push(`**Keywords:** ${item.ai_keywords.join(', ')}`);
  }

  lines.push(`**ID:** ${item.id}`);

  // Summary
  if (item.ai_summary) {
    lines.push('', '## Summary', '', item.ai_summary);
  }

  // Content excerpt
  if (item.content) {
    const excerpt = truncate(item.content, 2000);
    lines.push('', '## Content', '', excerpt);
  }

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
