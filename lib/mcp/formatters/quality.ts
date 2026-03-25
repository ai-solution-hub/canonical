/**
 * Quality, coverage, audit, and quality actions formatters for MCP tool responses.
 */
import { formatContentType } from '@/lib/format';
import type { QualityActionsResult } from '@/lib/quality-actions';

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
// Coverage gaps
// ---------------------------------------------------------------------------

export interface CoverageGapResult {
  total_gaps: number;
  empty_subtopics: Array<{ domain: string; subtopic: string }>;
  thin_subtopics: Array<{ domain: string; subtopic: string; item_count: number }>;
  stale_only_subtopics: Array<{ domain: string; subtopic: string; stale_count: number; expired_count: number }>;
}

export function formatCoverageGaps(data: CoverageGapResult): string {
  const lines: string[] = [
    '# Coverage Gaps',
    '',
    `**Total gaps found:** ${data.total_gaps}`,
    '',
  ];

  if (data.empty_subtopics.length > 0) {
    lines.push(`## Empty Subtopics (0 items) — ${data.empty_subtopics.length}`, '');
    for (const gap of data.empty_subtopics) {
      lines.push(`- ${gap.domain} > ${gap.subtopic}`);
    }
    lines.push('');
  }

  if (data.thin_subtopics.length > 0) {
    lines.push(`## Thin Subtopics — ${data.thin_subtopics.length}`, '');
    for (const gap of data.thin_subtopics) {
      lines.push(`- ${gap.domain} > ${gap.subtopic} (${gap.item_count} item${gap.item_count === 1 ? '' : 's'})`);
    }
    lines.push('');
  }

  if (data.stale_only_subtopics.length > 0) {
    lines.push(`## Stale-Only Subtopics — ${data.stale_only_subtopics.length}`, '');
    for (const gap of data.stale_only_subtopics) {
      lines.push(`- ${gap.domain} > ${gap.subtopic} (${gap.stale_count} stale, ${gap.expired_count} expired)`);
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
  const sortedTypes = Object.entries(data.by_issue_type).sort(([, a], [, b]) => b - a);
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
    const issues = item.issues.map(i => i.replace(/_/g, ' ')).join(', ');
    lines.push(`### ${title} (${type})`);
    if (item.primary_domain) lines.push(`**Domain:** ${item.primary_domain}`);
    lines.push(`**Issues:** ${issues}`);
    lines.push(`**Content length:** ${item.content_length} chars`);
    if (item.classification_confidence !== null) {
      lines.push(`**Confidence:** ${Math.round(item.classification_confidence * 100)}%`);
    }
    if (item.freshness) lines.push(`**Freshness:** ${item.freshness}`);
    lines.push(`**ID:** ${item.id}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Duplicate pairs
// ---------------------------------------------------------------------------

export interface DuplicatePair {
  item_a: {
    id: string;
    title: string;
    content_type: string | null;
    domain: string | null;
  };
  item_b: {
    id: string;
    title: string;
    content_type: string | null;
    domain: string | null;
  };
  similarity: number;
}

export interface DuplicatePairsResult {
  count: number;
  threshold: number;
  domain_filter?: string;
  pairs: DuplicatePair[];
}

export function formatDuplicatePairs(data: DuplicatePairsResult): string {
  const lines: string[] = [
    '# Potential Duplicates Scan',
    '',
    `**Threshold:** ${Math.round(data.threshold * 100)}%`,
    `**Pairs found:** ${data.count}`,
  ];

  if (data.domain_filter) {
    lines.push(`**Domain Filter:** ${data.domain_filter}`);
  }

  lines.push('');

  if (data.count === 0) {
    lines.push('No potential duplicate pairs found at this threshold.');
    return lines.join('\n');
  }

  for (let i = 0; i < data.pairs.length; i++) {
    const p = data.pairs[i];
    const sim = Math.round(p.similarity * 100);
    const flag = p.similarity >= 0.95 ? ' **LIKELY DUPLICATE**' : '';
    lines.push(`### ${i + 1}. Similarity: ${sim}%${flag}`);
    lines.push(
      `- **Item A:** ${p.item_a.title} (${p.item_a.content_type ?? 'unknown'}, ${p.item_a.domain ?? 'no domain'}) \`${p.item_a.id}\``,
    );
    lines.push(
      `- **Item B:** ${p.item_b.title} (${p.item_b.content_type ?? 'unknown'}, ${p.item_b.domain ?? 'no domain'}) \`${p.item_b.id}\``,
    );
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Quality actions
// ---------------------------------------------------------------------------

export { type QualityAction, type QualityActionsResult } from '@/lib/quality-actions';

export function formatQualityActions(data: QualityActionsResult): string {
  const lines: string[] = [
    '# Quality Actions',
    '',
    `**Total actions:** ${data.total_actions}`,
    '',
  ];

  if (data.total_actions === 0) {
    lines.push('No quality improvement actions needed. All items are above the quality threshold.');
    return lines.join('\n');
  }

  // Priority breakdown
  lines.push('## By Priority', '');
  const priorityOrder = ['critical', 'high', 'medium', 'low'];
  for (const p of priorityOrder) {
    const count = data.by_priority[p] ?? 0;
    if (count > 0) {
      lines.push(`- **${p}:** ${count}`);
    }
  }
  lines.push('');

  // Individual actions
  for (let i = 0; i < data.actions.length; i++) {
    const a = data.actions[i];
    const priorityLabel = a.priority.charAt(0).toUpperCase() + a.priority.slice(1);
    const scoreText = a.currentScore !== null ? `Score: ${a.currentScore}` : 'Score: unscored';
    lines.push(`## ${i + 1}. "${a.itemTitle}" — ${scoreText} (${priorityLabel})`);
    if (a.domain) {
      lines.push(`**Domain:** ${a.domain}`);
    }
    lines.push(`**Category:** ${a.category}`);
    lines.push(`**Action:** ${a.action}`);
    if (a.estimatedScoreImpact > 0) {
      lines.push(`**Estimated score improvement:** +${a.estimatedScoreImpact} points`);
    }
    lines.push(`**Item ID:** ${a.itemId}`);
    lines.push('');
  }

  return lines.join('\n');
}
