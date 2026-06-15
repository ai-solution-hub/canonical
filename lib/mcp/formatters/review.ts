/**
 * Review workflow formatters for MCP tool responses.
 *
 * Covers:
 *  - `get_review_queue` — paginated content-items review queue
 *  - `get_assignments_for_user` — review-assignment listing
 *  - `create_review_assignment` — assignment creation result
 */
import { formatDateUK } from '@/lib/format';

// ---------------------------------------------------------------------------
// Review queue (get_review_queue)
// ---------------------------------------------------------------------------

export interface ReviewQueueToolItem {
  id: string;
  title: string | null;
  suggested_title: string | null;
  primary_domain: string | null;
  content_type: string | null;
  quality_score: number | null;
  classification_confidence: number | null;
  verified_at: string | null;
  governance_review_status: string | null;
  last_reviewed_at: string | null;
}

export interface ReviewQueueToolData {
  items: ReviewQueueToolItem[];
  total: number;
  verified_count: number;
  flagged_count: number;
  offset: number;
  limit: number;
  status: string;
  domain_filter: string | null;
  content_type_filter: string | null;
}

export function formatReviewQueue(data: ReviewQueueToolData): string {
  const {
    items,
    total,
    verified_count,
    flagged_count,
    offset,
    status,
    domain_filter,
    content_type_filter,
  } = data;

  const filters: string[] = [`status: \`${status}\``];
  if (domain_filter) filters.push(`domain: \`${domain_filter}\``);
  if (content_type_filter)
    filters.push(`content_type: \`${content_type_filter}\``);

  if (items.length === 0 && total === 0) {
    return `# Review Queue\n\nNo items match the filter (${filters.join(', ')}).\n\nVerified across KB: ${verified_count}. Flagged: ${flagged_count}.`;
  }

  const start = offset + 1;
  const end = Math.min(offset + items.length, total);

  const lines: string[] = [
    '# Review Queue',
    '',
    `**${total} item${total === 1 ? '' : 's'}** matching (${filters.join(', ')}) — showing ${start}-${end}.`,
    '',
    `Account-wide: ${verified_count} verified, ${flagged_count} flagged.`,
    '',
    '| # | Title | Domain | Type | Quality | Confidence | Verified | Last reviewed |',
    '|---|-------|--------|------|---------|------------|----------|---------------|',
  ];

  items.forEach((item, index) => {
    const title = item.title ?? item.suggested_title ?? '(untitled)';
    const domain = item.primary_domain ?? '—';
    const type = item.content_type ?? '—';
    const quality =
      item.quality_score == null ? '—' : `${Math.round(item.quality_score)}`;
    const confidence =
      item.classification_confidence == null
        ? '—'
        : `${(item.classification_confidence * 100).toFixed(0)}%`;
    const verified = item.verified_at ? formatDateUK(item.verified_at) : '—';
    const lastReviewed = item.last_reviewed_at
      ? formatDateUK(item.last_reviewed_at)
      : '—';
    lines.push(
      `| ${start + index} | ${title} | ${domain} | ${type} | ${quality} | ${confidence} | ${verified} | ${lastReviewed} |`,
    );
  });

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Review assignments listing (get_assignments_for_user)
// ---------------------------------------------------------------------------

export interface ReviewAssignmentSummary {
  id: string;
  reviewer_id: string;
  assigned_by: string | null;
  assignment_type: string | null;
  status: string | null;
  filter_domains: string[] | null;
  filter_content_types: string[] | null;
  filter_freshness: string[] | null;
  filter_date_from: string | null;
  filter_date_to: string | null;
  due_date: string | null;
  item_count: number | null;
  notes: string | null;
  completed_at: string | null;
  created_at: string | null;
}

export interface ReviewAssignmentsData {
  assignments: ReviewAssignmentSummary[];
  status_filter: string;
  scope: 'self' | 'all' | 'reviewer';
  target_reviewer_id: string | null;
}

export function formatReviewAssignments(data: ReviewAssignmentsData): string {
  const { assignments, status_filter, scope, target_reviewer_id } = data;

  const scopeLabel =
    scope === 'self'
      ? 'for the current user'
      : scope === 'reviewer'
        ? `for reviewer \`${target_reviewer_id}\``
        : 'across all reviewers';

  if (assignments.length === 0) {
    return `# Review Assignments\n\nNo ${status_filter} assignments ${scopeLabel}.`;
  }

  const counts = {
    active: assignments.filter((a) => a.status === 'active').length,
    completed: assignments.filter((a) => a.status === 'completed').length,
    cancelled: assignments.filter((a) => a.status === 'cancelled').length,
  };

  const lines: string[] = [
    '# Review Assignments',
    '',
    `**${assignments.length} assignment${assignments.length === 1 ? '' : 's'}** (status filter: \`${status_filter}\`) ${scopeLabel}.`,
    `Active: ${counts.active}, completed: ${counts.completed}, cancelled: ${counts.cancelled}.`,
    '',
    '| # | ID | Reviewer | Items | Due | Status | Notes |',
    '|---|-----|----------|-------|-----|--------|-------|',
  ];

  assignments.forEach((a, index) => {
    const shortId = a.id.slice(0, 8);
    const items = a.item_count ?? 0;
    const due = a.due_date ? formatDateUK(a.due_date) : '—';
    const status = a.status ?? '—';
    const notes = a.notes ? a.notes.slice(0, 60) : '—';
    lines.push(
      `| ${index + 1} | ${shortId} | ${a.reviewer_id} | ${items} | ${due} | ${status} | ${notes} |`,
    );
  });

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Create review assignment (create_review_assignment)
// ---------------------------------------------------------------------------

export interface CreateReviewAssignmentResult {
  id: string;
  reviewer_id: string;
  assigned_by: string;
  item_count: number;
  due_date: string | null;
  filter_domains: string[];
  filter_content_types: string[];
  filter_freshness: string[];
  filter_date_from: string | null;
  filter_date_to: string | null;
  notes: string | null;
  notification_sent: boolean;
  notification_error: string | null;
}

export function formatCreateReviewAssignment(
  result: CreateReviewAssignmentResult,
): string {
  const lines: string[] = [
    '# Review Assignment Created',
    '',
    `**Assignment ID:** ${result.id}`,
    `**Reviewer:** ${result.reviewer_id}`,
    `**Assigned by:** ${result.assigned_by}`,
    `**Item count:** ${result.item_count} item${result.item_count === 1 ? '' : 's'} matching filter`,
  ];

  if (result.due_date) {
    lines.push(`**Due:** ${formatDateUK(result.due_date)}`);
  }

  const filterLines: string[] = [];
  if (result.filter_domains.length > 0) {
    filterLines.push(`- Domains: ${result.filter_domains.join(', ')}`);
  }
  if (result.filter_content_types.length > 0) {
    filterLines.push(
      `- Content types: ${result.filter_content_types.join(', ')}`,
    );
  }
  if (result.filter_freshness.length > 0) {
    filterLines.push(`- Freshness: ${result.filter_freshness.join(', ')}`);
  }
  if (result.filter_date_from || result.filter_date_to) {
    const from = result.filter_date_from
      ? formatDateUK(result.filter_date_from)
      : 'anytime';
    const to = result.filter_date_to
      ? formatDateUK(result.filter_date_to)
      : 'present';
    filterLines.push(`- Date range: ${from} to ${to}`);
  }

  if (filterLines.length > 0) {
    lines.push('', '**Filter:**', ...filterLines);
  }

  if (result.notes) {
    lines.push('', `**Notes:** ${result.notes}`);
  }

  lines.push(
    '',
    result.notification_sent
      ? `Notification sent to the reviewer.`
      : `Notification failed: ${result.notification_error ?? 'unknown reason'}. The assignment was still created — you may want to notify the reviewer manually.`,
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// whats_in_my_queue — faceted queue (ID-71.9, B-INV-30 / M30 / OQ-5)
//
// ONE queue concept distinguished by a `facet` (content_quality vs
// freshness/ownership governance), a GREENFIELD read OVER the already-merged
// `lib/attention.ts` producer substrate. `source_document_change` is scoped
// OUT of v1 (no producer exists).
// ---------------------------------------------------------------------------

export type QueueFacet = 'content_quality' | 'governance' | 'all';

export interface QueueItem {
  id: string;
  /** The AttentionItem.type (e.g. governance_review, quality_flag). */
  type: string;
  /** Which facet this item belongs to (content_quality | governance). */
  facet: 'content_quality' | 'governance';
  severity: string;
  title: string;
  detail: string;
  action_url: string;
  action_label: string;
  count?: number;
}

export interface WhatsInMyQueueData {
  facet: QueueFacet;
  items: QueueItem[];
  total: number;
  generated_at: string;
}

export function formatWhatsInMyQueue(data: WhatsInMyQueueData): string {
  const lines: string[] = [
    `# What's in my queue`,
    '',
    `Facet: **${data.facet}** — ${data.total} item${data.total === 1 ? '' : 's'}.`,
    '',
  ];

  if (data.items.length === 0) {
    lines.push('Your queue is clear for this facet.');
    return lines.join('\n');
  }

  const byFacet: Record<string, QueueItem[]> = {
    governance: [],
    content_quality: [],
  };
  for (const item of data.items) {
    byFacet[item.facet].push(item);
  }

  const facetTitles: Record<string, string> = {
    governance: 'Governance',
    content_quality: 'Content quality',
  };

  for (const facetKey of ['governance', 'content_quality']) {
    const items = byFacet[facetKey];
    if (items.length === 0) continue;
    lines.push(`## ${facetTitles[facetKey]}`);
    lines.push('');
    for (const item of items) {
      lines.push(`- **${item.title}** (${item.severity}) — ${item.detail}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
