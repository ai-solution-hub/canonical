/**
 * Governance and delete/archive formatters for MCP tool responses.
 */
import { z } from 'zod';

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
// Governance queue outputSchema (get_governance_queue tool retired in ID-71.9;
// the response schema is retained as the canonical wire-shape contract,
// exercised by the output-schema smoke test).
// ---------------------------------------------------------------------------

/**
 * Zod schema for a single governance-queue row — mirrors the historical
 * `get_governance_queue` item shape. Consumed only by
 * `GovernanceQueueResponseSchema` below, so it is not exported.
 */
const GovernanceQueueItemSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  suggested_title: z.string().nullable(),
  primary_domain: z.string().nullable(),
  governance_review_status: z.string().nullable(),
  governance_review_due: z.string().nullable(),
  governance_reviewer_id: z.string().nullable(),
  updated_by: z.string().nullable(),
  updated_at: z.string().nullable(),
});

/**
 * Zod schema for the `get_governance_queue` structured response envelope.
 * `review_status_filter` surfaces the resolved status set the tool appended to
 * the row payload, so the schema covers the actual wire shape.
 */
export const GovernanceQueueResponseSchema = z.object({
  items: z.array(GovernanceQueueItemSchema),
  total: z.number(),
  offset: z.number(),
  limit: z.number(),
  domain_filter: z.string().nullable(),
  publication_status_filter: z.string().nullish(),
  review_status_filter: z.array(z.string()),
});

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

/**
 * Zod schema for `GovernanceReviewActionResult` — mirrors the interface
 * exactly for MCP `outputSchema` runtime validation.
 */
export const GovernanceReviewActionResultSchema = z.object({
  item_id: z.string(),
  title: z.string(),
  action: z.enum(['approve', 'request_changes', 'revert']),
  new_status: z.string(),
  reviewer_id: z.string(),
  notes: z.string().nullable(),
});

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
