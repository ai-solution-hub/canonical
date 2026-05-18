/**
 * Change report formatters for MCP tool responses.
 *
 * Formats content additions, updates, and removals over a recent period
 * as Markdown for human consumption, with structured data interfaces for
 * machine consumers.
 */
import { z } from 'zod';
import { formatDateUK } from '@/lib/format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChangeReportItem {
  id: string;
  title: string | null;
  primary_domain: string | null;
  content_type: string | null;
  /** ISO date string — created_at for additions, updated_at for updates, archived_at for removals */
  date: string;
}

export interface ChangeReportData {
  period_days: number;
  start_date: string;
  end_date: string;
  domain: string | null;
  keywords: string[] | null;
  additions: { count: number; items: ChangeReportItem[] };
  updates: { count: number; items: ChangeReportItem[] };
  removals: { count: number; items: ChangeReportItem[] };
}

/**
 * Zod schema for `ChangeReportItem` — mirrors the interface exactly for
 * MCP `outputSchema` runtime validation.
 */
export const ChangeReportItemSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  primary_domain: z.string().nullable(),
  content_type: z.string().nullable(),
  date: z.string(),
});

const ChangeReportBucketSchema = z.object({
  count: z.number(),
  items: z.array(ChangeReportItemSchema),
});

/**
 * Zod schema for `ChangeReportData` — mirrors the interface exactly for
 * MCP `outputSchema` runtime validation.
 */
export const ChangeReportDataSchema = z.object({
  period_days: z.number(),
  start_date: z.string(),
  end_date: z.string(),
  domain: z.string().nullable(),
  keywords: z.array(z.string()).nullable(),
  additions: ChangeReportBucketSchema,
  updates: ChangeReportBucketSchema,
  removals: ChangeReportBucketSchema,
});

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

function formatItemTable(items: ChangeReportItem[], dateLabel: string): string {
  if (items.length === 0) return '';

  const lines: string[] = [
    `| Title | Domain | Type | ${dateLabel} |`,
    '| --- | --- | --- | --- |',
  ];

  for (const item of items) {
    const title = item.title ?? '_Untitled_';
    const domain = item.primary_domain ?? '-';
    const type = item.content_type ?? '-';
    const date = formatDateUK(item.date);
    lines.push(`| ${title} | ${domain} | ${type} | ${date} |`);
  }

  return lines.join('\n');
}

export function formatChangeReport(data: ChangeReportData): string {
  const startDate = formatDateUK(data.start_date);
  const endDate = formatDateUK(data.end_date);
  const domainLabel = data.domain ?? 'All';
  const keywordsLabel =
    data.keywords && data.keywords.length > 0 ? data.keywords.join(', ') : null;

  const lines: string[] = [
    `# Change Report (last ${data.period_days} day${data.period_days === 1 ? '' : 's'})`,
    '',
    `**Period:** ${startDate} - ${endDate}`,
    `**Domain:** ${domainLabel}`,
  ];

  if (keywordsLabel) {
    lines.push(`**Keywords:** ${keywordsLabel}`);
  }

  // Additions
  lines.push('', `## Additions (${data.additions.count})`, '');
  if (data.additions.items.length > 0) {
    lines.push(formatItemTable(data.additions.items, 'Created'));
  } else {
    lines.push('_No additions in this period._');
  }

  // Updates
  lines.push('', `## Updates (${data.updates.count})`, '');
  if (data.updates.items.length > 0) {
    lines.push(formatItemTable(data.updates.items, 'Updated'));
  } else {
    lines.push('_No updates in this period._');
  }

  // Removals
  lines.push('', `## Removals (${data.removals.count})`, '');
  if (data.removals.items.length > 0) {
    lines.push(formatItemTable(data.removals.items, 'Archived'));
  } else {
    lines.push('_No removals in this period._');
  }

  return lines.join('\n');
}
