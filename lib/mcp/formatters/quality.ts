/**
 * Quality, coverage, audit, and quality actions formatters for MCP tool responses.
 */
import { formatContentType } from '@/lib/format';

// ---------------------------------------------------------------------------
// Coverage gaps
// ---------------------------------------------------------------------------

export interface CoverageGapResult {
  total_gaps: number;
  empty_subtopics: Array<{ domain: string; subtopic: string }>;
  thin_subtopics: Array<{
    domain: string;
    subtopic: string;
    item_count: number;
  }>;
  stale_only_subtopics: Array<{
    domain: string;
    subtopic: string;
    stale_count: number;
    expired_count: number;
  }>;
}

export function formatCoverageGaps(data: CoverageGapResult): string {
  const lines: string[] = [
    '# Coverage Gaps',
    '',
    `**Total gaps found:** ${data.total_gaps}`,
    '',
  ];

  if (data.empty_subtopics.length > 0) {
    lines.push(
      `## Empty Subtopics (0 items) — ${data.empty_subtopics.length}`,
      '',
    );
    for (const gap of data.empty_subtopics) {
      lines.push(`- ${gap.domain} > ${gap.subtopic}`);
    }
    lines.push('');
  }

  if (data.thin_subtopics.length > 0) {
    lines.push(`## Thin Subtopics — ${data.thin_subtopics.length}`, '');
    for (const gap of data.thin_subtopics) {
      lines.push(
        `- ${gap.domain} > ${gap.subtopic} (${gap.item_count} item${gap.item_count === 1 ? '' : 's'})`,
      );
    }
    lines.push('');
  }

  if (data.stale_only_subtopics.length > 0) {
    lines.push(
      `## Stale-Only Subtopics — ${data.stale_only_subtopics.length}`,
      '',
    );
    for (const gap of data.stale_only_subtopics) {
      lines.push(
        `- ${gap.domain} > ${gap.subtopic} (${gap.stale_count} stale, ${gap.expired_count} expired)`,
      );
    }
    lines.push('');
  }

  if (data.total_gaps === 0) {
    lines.push('No coverage gaps found. All taxonomy subtopics have content.');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Content audit
// ---------------------------------------------------------------------------

export interface AuditItem {
  id: string;
  title: string | null;
  suggested_title: string | null;
  content_type: string | null;
  primary_domain: string | null;
  issues: string[];
  content_length: number;
  classification_confidence: number | null;
  freshness: string | null;
}

export interface AuditResult {
  total_flagged: number;
  by_issue_type: Record<string, number>;
  items: AuditItem[];
}

export function formatAuditResult(data: AuditResult): string {
  const lines: string[] = [
    '# Content Audit',
    '',
    `**Total items flagged:** ${data.total_flagged}`,
    '',
  ];

  if (data.total_flagged === 0) {
    lines.push('No quality issues found.');
    return lines.join('\n');
  }

  // Summary by issue type
  lines.push('## Issues by Type', '');
  const sortedTypes = Object.entries(data.by_issue_type).sort(
    ([, a], [, b]) => b - a,
  );
  for (const [type, count] of sortedTypes) {
    const label = type.replace(/_/g, ' ');
    lines.push(`- **${label}:** ${count}`);
  }
  lines.push('');

  // Item list
  lines.push('## Flagged Items', '');
  for (const item of data.items) {
    const title = item.suggested_title || item.title || 'Untitled';
    const type = formatContentType(item.content_type);
    const issues = item.issues.map((i) => i.replace(/_/g, ' ')).join(', ');
    lines.push(`### ${title} (${type})`);
    if (item.primary_domain) lines.push(`**Domain:** ${item.primary_domain}`);
    lines.push(`**Issues:** ${issues}`);
    lines.push(`**Content length:** ${item.content_length} chars`);
    if (item.classification_confidence !== null) {
      lines.push(
        `**Confidence:** ${Math.round(item.classification_confidence * 100)}%`,
      );
    }
    if (item.freshness) lines.push(`**Freshness:** ${item.freshness}`);
    lines.push(`**ID:** ${item.id}`);
    lines.push('');
  }

  return lines.join('\n');
}

// (The "Duplicate pairs" formatter section — DuplicatePair, DuplicatePairsResult,
// DuplicatePairsResponseSchema, formatDuplicatePairs — was retired under
// ID-131.15, G-DEDUP legacy dedup-family retirement, S446. It backed the
// find_duplicates `scope: 'all'` whole-KB batch scan via the now-DROPped
// find_duplicate_pairs RPC; the id-120 q_a_pairs batch dedup-proposer is its
// replacement.)
