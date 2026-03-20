/**
 * MCP App formatters (coverage matrix, bid dashboard) for MCP tool responses.
 */
import { formatDateUK } from '@/lib/format';

// ---------------------------------------------------------------------------
// Coverage matrix (MCP App)
// ---------------------------------------------------------------------------

export interface CoverageMatrixData {
  total_items: number;
  freshness: {
    fresh: number;
    aging: number;
    stale: number;
    expired: number;
  };
  domains: Array<{
    name: string;
    total_items: number;
    fresh: number;
    aging: number;
    stale: number;
    expired: number;
    subtopics: Array<{
      name: string;
      total_items: number;
      fresh: number;
      aging: number;
      stale: number;
      expired: number;
    }>;
  }>;
  quality: {
    total_flagged: number;
    by_issue_type: Record<string, number>;
  };
  gaps: Array<{
    domain: string;
    subtopic: string | null;
    item_count: number;
    issue: 'empty' | 'thin' | 'stale_only';
  }>;
}

export function formatCoverageMatrix(data: CoverageMatrixData): string {
  const lines: string[] = [
    '# Coverage Matrix',
    '',
    `**Total items:** ${data.total_items}`,
    '',
    '## Freshness Overview',
    '',
    `- **Fresh:** ${data.freshness.fresh}`,
    `- **Aging:** ${data.freshness.aging}`,
    `- **Stale:** ${data.freshness.stale}`,
    `- **Expired:** ${data.freshness.expired}`,
    '',
  ];

  if (data.domains.length > 0) {
    lines.push('## Domains', '');
    lines.push('| Domain | Total | Fresh | Aging | Stale | Expired |');
    lines.push('|--------|-------|-------|-------|-------|---------|');
    for (const domain of data.domains) {
      lines.push(`| ${domain.name} | ${domain.total_items} | ${domain.fresh} | ${domain.aging} | ${domain.stale} | ${domain.expired} |`);
    }
    lines.push('');
  }

  if (data.quality.total_flagged > 0) {
    lines.push('## Quality Issues', '');
    lines.push(`**${data.quality.total_flagged} items flagged**`);
    const sortedTypes = Object.entries(data.quality.by_issue_type).sort(([, a], [, b]) => b - a);
    for (const [type, count] of sortedTypes) {
      lines.push(`- ${type.replace(/_/g, ' ')}: ${count}`);
    }
    lines.push('');
  }

  if (data.gaps.length > 0) {
    lines.push(`## Coverage Gaps (${data.gaps.length})`, '');
    for (const gap of data.gaps) {
      const location = gap.subtopic ? `${gap.domain} > ${gap.subtopic}` : gap.domain;
      const label = gap.issue === 'empty' ? '0 items' : gap.issue === 'thin' ? `${gap.item_count} items (thin)` : 'stale only';
      lines.push(`- ${location}: ${label}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Bid dashboard (MCP App)
// ---------------------------------------------------------------------------

export interface BidDashboardData {
  offset: number;
  count: number;
  total_count: number;
  has_more: boolean;
  bids: Array<{
    id: string;
    name: string;
    buyer: string | null;
    status: string;
    deadline: string | null;
    days_until_deadline: number | null;
    total_questions: number;
    answered_questions: number;
    approved_questions: number;
  }>;
  focused_bid_detail?: Record<string, unknown>;
}

export function formatBidDashboard(data: BidDashboardData): string {
  const lines: string[] = [
    '# Bid Dashboard',
    '',
    `**${data.total_count} bid${data.total_count === 1 ? '' : 's'}**`,
    '',
  ];

  if (data.bids.length === 0) {
    lines.push('No active bids found.');
    return lines.join('\n');
  }

  for (const bid of data.bids) {
    const progress = bid.total_questions > 0
      ? `${Math.round((bid.answered_questions / bid.total_questions) * 100)}%`
      : '0%';
    lines.push(`## ${bid.name}`);
    lines.push(`- **Buyer:** ${bid.buyer ?? 'Not specified'}`);
    lines.push(`- **Status:** ${bid.status}`);
    if (bid.deadline) {
      const dateStr = formatDateUK(bid.deadline);
      const daysStr = bid.days_until_deadline !== null
        ? bid.days_until_deadline < 0
          ? `${Math.abs(bid.days_until_deadline)} days overdue`
          : bid.days_until_deadline === 0
            ? 'due today'
            : `${bid.days_until_deadline} days remaining`
        : '';
      lines.push(`- **Deadline:** ${dateStr}${daysStr ? ` (${daysStr})` : ''}`);
    }
    lines.push(`- **Progress:** ${bid.answered_questions}/${bid.total_questions} answered (${progress})`);
    lines.push(`- **Approved:** ${bid.approved_questions}/${bid.total_questions}`);
    lines.push('');
  }

  return lines.join('\n');
}
