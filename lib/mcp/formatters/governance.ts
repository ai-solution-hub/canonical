/**
 * Governance and delete/archive formatters for MCP tool responses.
 */
import { formatDateUK } from '@/lib/format';

// ---------------------------------------------------------------------------
// Delete/Archive result
// ---------------------------------------------------------------------------

export interface DeleteContentResult {
  id: string;
  title: string;
  mode: 'archive' | 'delete';
  reason: string | null;
  archived_at?: string;
}

export function formatDeleteContent(data: DeleteContentResult): string {
  const action = data.mode === 'archive' ? 'Archived' : 'Deleted';
  const lines: string[] = [
    `# Content Item ${action}`,
    '',
    `**ID:** ${data.id}`,
    `**Title:** ${data.title}`,
    `**Mode:** ${data.mode}`,
  ];

  if (data.reason) {
    lines.push(`**Reason:** ${data.reason}`);
  }

  if (data.archived_at) {
    lines.push(`**Archived at:** ${data.archived_at}`);
  }

  if (data.mode === 'delete') {
    lines.push(
      '',
      '> This item and all associated history have been permanently removed.',
    );
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Governance status update
// ---------------------------------------------------------------------------

export interface GovernanceStatusItemResult {
  id: string;
  title: string;
  success: boolean;
  error?: string;
}

export interface GovernanceStatusUpdateResult {
  action: 'publish' | 'draft';
  total: number;
  succeeded: number;
  failed: number;
  items: GovernanceStatusItemResult[];
}

export function formatGovernanceStatusUpdate(
  result: GovernanceStatusUpdateResult,
): string {
  const verb = result.action === 'publish' ? 'Published' : 'Set to draft';
  const lines: string[] = [
    `# Governance Status Update`,
    '',
    `**Action:** ${result.action === 'publish' ? 'Publish (draft → live)' : 'Draft (live → draft)'}`,
    `**Result:** ${result.succeeded}/${result.total} ${verb.toLowerCase()} successfully`,
    '',
  ];

  if (result.failed > 0) {
    lines.push('## Failures', '');
    for (const item of result.items.filter((i) => !i.success)) {
      lines.push(
        `- **${item.title}** (${item.id}): ${item.error ?? 'Unknown error'}`,
      );
    }
    lines.push('');
  }

  if (result.succeeded > 0) {
    lines.push(`## ${verb}`, '');
    for (const item of result.items.filter((i) => i.success)) {
      lines.push(`- ${item.title} (${item.id})`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Governance queue listing (get_governance_queue)
// ---------------------------------------------------------------------------

export interface GovernanceQueueItem {
  id: string;
  title: string | null;
  suggested_title: string | null;
  primary_domain: string | null;
  governance_review_status: string | null;
  governance_review_due: string | null;
  governance_reviewer_id: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

export interface GovernanceQueueData {
  items: GovernanceQueueItem[];
  total: number;
  offset: number;
  limit: number;
  domain_filter: string | null;
  /**
   * S202 §5.2 T7 — optional publication-lifecycle filter. `null` when the
   * caller omitted the param. Surfaces in the markdown header when set so
   * users see exactly which slice of the queue they're looking at.
   */
  publication_status_filter?: string | null;
}

export function formatGovernanceQueue(data: GovernanceQueueData): string {
  const { items, total, offset, domain_filter, publication_status_filter } =
    data;

  if (items.length === 0 && total === 0) {
    const domainScope = domain_filter ? ` for domain "${domain_filter}"` : '';
    const pubScope = publication_status_filter
      ? ` in publication state "${publication_status_filter}"`
      : '';
    return `# Governance Queue\n\nGovernance queue is clear${domainScope}${pubScope} — no items pending review.`;
  }

  const start = offset + 1;
  const end = Math.min(offset + items.length, total);
  const filterParts: string[] = [];
  if (domain_filter) {
    filterParts.push(`domain: \`${domain_filter}\``);
  }
  if (publication_status_filter) {
    filterParts.push(
      `publication_status: \`${publication_status_filter}\``,
    );
  }
  const scopeNote =
    filterParts.length > 0 ? ` (${filterParts.join(', ')})` : '';

  const lines: string[] = [
    `# Governance Queue`,
    '',
    `**${total} item${total === 1 ? '' : 's'} pending review**${scopeNote} — showing ${start}-${end}.`,
    '',
    '| # | Title | Domain | Due | Reviewer | Last Updated |',
    '|---|-------|--------|-----|----------|--------------|',
  ];

  items.forEach((item, index) => {
    const title = item.title ?? item.suggested_title ?? '(untitled)';
    const domain = item.primary_domain ?? '—';
    const due = item.governance_review_due
      ? formatDateUK(item.governance_review_due)
      : '—';
    const reviewer = item.governance_reviewer_id ?? '(unassigned)';
    const updated = item.updated_at ? formatDateUK(item.updated_at) : '—';
    lines.push(
      `| ${start + index} | ${title} | ${domain} | ${due} | ${reviewer} | ${updated} |`,
    );
  });

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Governance review action (review_governance_item)
// ---------------------------------------------------------------------------

export type GovernanceReviewAction = 'approve' | 'request_changes' | 'revert';

export interface GovernanceReviewActionResult {
  item_id: string;
  title: string;
  action: GovernanceReviewAction;
  new_status: string;
  reviewer_id: string;
  notes: string | null;
}

export function formatGovernanceReviewAction(
  result: GovernanceReviewActionResult,
): string {
  const verb =
    result.action === 'approve'
      ? 'Approved'
      : result.action === 'request_changes'
        ? 'Changes requested'
        : 'Reverted';
  const lines: string[] = [
    `# Governance review — ${verb}`,
    '',
    `**Item:** ${result.title} (${result.item_id})`,
    `**Action:** ${result.action}`,
    `**Reviewer:** ${result.reviewer_id}`,
    `**New status:** \`${result.new_status}\``,
  ];

  if (result.notes) {
    lines.push('', `**Notes:** ${result.notes}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Publication status update (update_publication_status)
//
// S202 §5.2 T7. Mirrors the PATCH /api/items/[id] publication_status branch
// response shape so the MCP tool surfaces the same {previous_status, new_status,
// transition} fields callers rely on. archive_reason is `null` for non-archive
// transitions and for archive transitions where the caller omitted the field.
// ---------------------------------------------------------------------------

export interface PublicationStatusUpdateResult {
  item_id: string;
  title: string;
  previous_status: string;
  new_status: string;
  transition: string;
  archive_reason: string | null;
}

export function formatPublicationStatusUpdate(
  result: PublicationStatusUpdateResult,
): string {
  const lines: string[] = [
    `# Publication status updated`,
    '',
    `**Item:** ${result.title} (${result.item_id})`,
    `**Transition:** \`${result.previous_status}\` → \`${result.new_status}\``,
  ];

  if (result.archive_reason) {
    lines.push(`**Archive reason:** ${result.archive_reason}`);
  }

  return lines.join('\n');
}
