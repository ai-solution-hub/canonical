/**
 * Governance and delete/archive formatters for MCP tool responses.
 */

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
