/**
 * Markdown formatting helpers for MCP tool responses.
 *
 * These produce LLM-friendly Markdown for the `content` field of tool results.
 * Dates are formatted as DD/MM/YYYY per UK English conventions.
 */
import { formatDateUK, formatContentType } from '@/lib/format';
import type { ActiveBidSummary, DashboardData, GroupedActivityItem } from '@/lib/dashboard';
import type { ReorientData } from '@/types/reorient';
import type { ClassificationResult } from '@/lib/ai/classify';
import type { SummariseResult } from '@/lib/ai/summarise';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum character limit for Markdown tool response text. Prevents oversized
 * responses from large PDFs or busy dashboards overwhelming the LLM context.
 */
export const CHARACTER_LIMIT = 10_000;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Truncate text to a maximum length with ellipsis */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Truncate a Markdown response to CHARACTER_LIMIT. Appends a note when
 * content is truncated so the LLM knows to request specific items instead.
 */
export function truncateResponse(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return text.slice(0, CHARACTER_LIMIT) + '\n\n... (content truncated — request specific items for full detail)';
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

// ---------------------------------------------------------------------------
// Bid detail
// ---------------------------------------------------------------------------

export interface BidDetail {
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

export function formatBidDetail(bid: BidDetail): string {
  const lines: string[] = [
    `# ${bid.name}`,
    '',
    `**Status:** ${bid.status}`,
  ];

  if (bid.buyer) lines.push(`**Buyer:** ${bid.buyer}`);
  if (bid.reference_number) lines.push(`**Reference:** ${bid.reference_number}`);
  if (bid.deadline) lines.push(`**Deadline:** ${formatDateUK(bid.deadline)}`);
  if (bid.description) lines.push('', bid.description);

  lines.push(`**ID:** ${bid.id}`);

  if (bid.question_stats) {
    const qs = bid.question_stats;
    const answered = qs.drafted_count + qs.complete_count;
    lines.push('', '## Question Progress', '');
    lines.push(`- **Total questions:** ${qs.total_questions}`);
    lines.push(`- **Answered:** ${answered} (${formatProgress(answered, qs.total_questions)})`);
    lines.push(`- **Approved:** ${qs.complete_count}`);
    lines.push(`- **Strong KB match:** ${qs.strong_match_count}`);
    lines.push(`- **Partial match:** ${qs.partial_match_count}`);
    lines.push(`- **Needs SME:** ${qs.needs_sme_count}`);
    lines.push(`- **No content:** ${qs.no_content_count}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Bid question
// ---------------------------------------------------------------------------

export interface BidQuestionDetail {
  id: string;
  question_text: string;
  section_name: string | null;
  word_limit: number | null;
  confidence_posture: string | null;
  status: string | null;
  response_text: string | null;
  review_status: string | null;
}

export function formatBidQuestion(q: BidQuestionDetail): string {
  const lines: string[] = [
    '# Bid Question',
    '',
    `**Question:** ${q.question_text}`,
  ];

  if (q.section_name) lines.push(`**Section:** ${q.section_name}`);
  if (q.word_limit) lines.push(`**Word limit:** ${q.word_limit}`);
  if (q.confidence_posture) lines.push(`**Confidence:** ${q.confidence_posture}`);
  if (q.status) lines.push(`**Status:** ${q.status}`);
  if (q.review_status) lines.push(`**Review status:** ${q.review_status}`);
  lines.push(`**ID:** ${q.id}`);

  if (q.response_text) {
    lines.push('', '## Response', '', truncate(q.response_text, 3000));
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Quality summary
// ---------------------------------------------------------------------------

export interface QualitySummary {
  total_open: number;
  by_type: Record<string, number>;
  details: Array<{ flag_type: string; severity: string; open_count: number }>;
}

export function formatQualitySummary(data: QualitySummary): string {
  const lines: string[] = [
    '# Quality Summary',
    '',
    `**Total open issues:** ${data.total_open}`,
    '',
  ];

  if (data.details.length === 0) {
    lines.push('No open quality issues found.');
  } else {
    lines.push('## Issues by Type', '');
    for (const d of data.details) {
      const label = d.flag_type.replace(/_/g, ' ');
      lines.push(`- **${label}** (${d.severity}): ${d.open_count}`);
    }
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
// Classification result
// ---------------------------------------------------------------------------

export function formatClassification(result: ClassificationResult): string {
  const lines: string[] = [
    '# Classification Result',
    '',
    `**Title:** ${result.suggested_title}`,
    `**Domain:** ${result.primary_domain}`,
    `**Subtopic:** ${result.primary_subtopic}`,
    `**Confidence:** ${Math.round(result.classification_confidence * 100)}%`,
  ];

  if (result.secondary_domain) {
    lines.push(`**Secondary domain:** ${result.secondary_domain}`);
  }

  if (result.ai_keywords.length > 0) {
    lines.push(`**Keywords:** ${result.ai_keywords.join(', ')}`);
  }

  if (result.ai_summary) {
    lines.push('', '## Summary', '', result.ai_summary);
  }

  if (result.classification_reasoning) {
    lines.push('', '## Reasoning', '', result.classification_reasoning);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Summary result
// ---------------------------------------------------------------------------

export function formatSummaryResult(result: SummariseResult): string {
  const data = result.summary_data;
  const lines: string[] = [
    '# Generated Summary',
    '',
    '## Executive Summary',
    '',
    data.executive,
    '',
    '## Detailed Summary',
    '',
    data.detailed,
  ];

  if (data.takeaways.length > 0) {
    lines.push('', '## Key Takeaways', '');
    for (const t of data.takeaways) {
      lines.push(`- ${t}`);
    }
  }

  lines.push('', `*Generated at ${data.generated_at} using ${data.model}*`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Content item created
// ---------------------------------------------------------------------------

export interface CreatedItem {
  id: string;
  title: string;
  content_type: string;
}

export function formatCreatedItem(item: CreatedItem): string {
  return [
    '# Content Item Created',
    '',
    `**Title:** ${item.title}`,
    `**Type:** ${formatContentType(item.content_type)}`,
    `**ID:** ${item.id}`,
    '',
    'The item has been created successfully.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Entity relationships
// ---------------------------------------------------------------------------

export interface EntitySummaryResult {
  canonical_name: string;
  entity_type: string;
  mention_count: number;
  content_item_ids: string[];
  related_entities: Array<{ relationship: string; target?: string; source?: string }>;
}

export interface EntityRelationship {
  source_entity: string;
  relationship_type: string;
  target_entity: string;
  source_item_id: string;
  confidence: number;
}

export interface EntityOverview {
  total_entities: number;
  by_type: Record<string, number>;
  top_entities: Array<{ canonical_name: string; entity_type: string; mention_count: number }>;
}

export function formatEntitySummary(
  entityName: string | undefined,
  entityType: string | undefined,
  summaries: EntitySummaryResult[],
  relationships: EntityRelationship[],
): string {
  if (summaries.length === 0) {
    const filter = entityName
      ? `"${entityName}"${entityType ? ` (type: ${entityType})` : ''}`
      : entityType
        ? `type "${entityType}"`
        : 'the specified criteria';
    return `# Entity Relationships\n\nNo entities found matching ${filter}.`;
  }

  const lines: string[] = [
    '# Entity Relationships',
    '',
  ];

  for (const entity of summaries) {
    lines.push(`## ${entity.canonical_name}`);
    lines.push(`**Type:** ${entity.entity_type}`);
    lines.push(`**Mentions:** ${entity.mention_count}`);
    lines.push(`**Referenced in:** ${entity.content_item_ids.length} content item${entity.content_item_ids.length === 1 ? '' : 's'}`);

    if (entity.related_entities.length > 0) {
      lines.push('', '### Related Entities');
      for (const related of entity.related_entities) {
        const relLabel = related.relationship.replace(/_/g, ' ');
        const entityName = related.target ?? related.source ?? 'unknown';
        const direction = related.target ? `${relLabel} → ${entityName}` : `${entityName} → ${relLabel}`;
        lines.push(`- ${direction}`);
      }
    }

    lines.push('');
  }

  if (relationships.length > 0) {
    lines.push('## Relationships', '');
    lines.push('| Source | Relationship | Target | Confidence |');
    lines.push('|--------|-------------|--------|------------|');
    for (const rel of relationships) {
      const conf = Math.round(rel.confidence * 100);
      const relLabel = rel.relationship_type.replace(/_/g, ' ');
      lines.push(`| ${rel.source_entity} | ${relLabel} | ${rel.target_entity} | ${conf}% |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatEntityOverview(overview: EntityOverview): string {
  const lines: string[] = [
    '# Entity Overview',
    '',
    `**Total entities:** ${overview.total_entities}`,
    '',
    '## Entities by Type',
    '',
  ];

  const sortedTypes = Object.entries(overview.by_type).sort(([, a], [, b]) => b - a);
  for (const [type, count] of sortedTypes) {
    lines.push(`- **${type}:** ${count}`);
  }

  if (overview.top_entities.length > 0) {
    lines.push('', '## Top Entities', '');
    lines.push('| Entity | Type | Mentions |');
    lines.push('|--------|------|----------|');
    for (const entity of overview.top_entities) {
      lines.push(`| ${entity.canonical_name} | ${entity.entity_type} | ${entity.mention_count} |`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Citation confirmation
// ---------------------------------------------------------------------------

export interface CitationResult {
  id: string;
  content_item_id: string;
  bid_response_id: string;
  citation_type: string;
}

export function formatCitation(citation: CitationResult): string {
  return [
    '# Citation Recorded',
    '',
    `**Content item:** ${citation.content_item_id}`,
    `**Bid response:** ${citation.bid_response_id}`,
    `**Type:** ${citation.citation_type}`,
    `**ID:** ${citation.id}`,
    '',
    'The citation has been recorded successfully.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Content effectiveness (win rate)
// ---------------------------------------------------------------------------

export interface ContentEffectiveness {
  content_item_id: string;
  total_citations: number;
  winning_citations: number;
  win_rate: number;
}

export function formatContentEffectiveness(data: ContentEffectiveness): string {
  const winPct = Math.round(data.win_rate * 100);

  const lines: string[] = [
    '# Content Effectiveness',
    '',
    `**Content item:** ${data.content_item_id}`,
    `**Total citations:** ${data.total_citations}`,
    `**Winning citations:** ${data.winning_citations}`,
    `**Win rate:** ${winPct}%`,
  ];

  if (data.total_citations === 0) {
    lines.push('', 'This content has not yet been cited in any bid responses.');
  } else if (data.win_rate >= 0.7) {
    lines.push('', 'This content is highly effective — it is frequently associated with winning bids.');
  } else if (data.win_rate >= 0.4) {
    lines.push('', 'This content has moderate effectiveness in bid outcomes.');
  } else {
    lines.push('', 'This content has a low win rate — consider reviewing or updating it.');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Q&A search results
// ---------------------------------------------------------------------------

export function formatQASearchResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return `# Q&A Library Search: "${query}"\n\nNo Q&A pairs found matching your query.`;
  }

  const lines: string[] = [
    `# Q&A Library Search: "${query}"`,
    '',
    `Found ${results.length} Q&A pair${results.length === 1 ? '' : 's'}:`,
    '',
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const title = r.suggested_title || r.title || 'Untitled Q&A';
    const similarity = Math.round(r.similarity * 100);

    lines.push(`## ${i + 1}. ${title}`);

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
