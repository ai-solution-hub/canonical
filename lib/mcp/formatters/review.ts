/**
 * Review workflow formatters for MCP tool responses.
 *
 * Covers:
 *  - `create_review_assignment` — assignment creation result
 *  - `whats_in_my_queue` — faceted attention queue (ID-71.9)
 */
import { formatDateUK } from '@/lib/format';

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
