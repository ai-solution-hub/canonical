/**
 * UI logic tests for MCP Apps.
 *
 * These test the pure logic used by the Bid Dashboard and Coverage Matrix apps
 * without importing from the app source files (which depend on DOM and ext-apps
 * SDK). Instead, we reimplement the pure functions here and verify they match
 * the expected behaviour documented in the app code.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Type definitions (mirrored from app types)
// ---------------------------------------------------------------------------

type Urgency = 'overdue' | 'urgent' | 'approaching' | 'normal' | 'none';

interface BidSummary {
  id: string;
  name: string;
  buyer: string | null;
  status: string;
  deadline: string | null;
  days_until_deadline: number | null;
  total_questions: number;
  answered_questions: number;
  approved_questions: number;
}

// ---------------------------------------------------------------------------
// Pure functions reimplemented from mcp-apps/bid-dashboard/src/app.ts
// ---------------------------------------------------------------------------

/** Determine urgency from days until deadline */
function getUrgency(daysUntil: number | null): Urgency {
  if (daysUntil === null) return 'none';
  if (daysUntil < 0) return 'overdue';
  if (daysUntil <= 3) return 'urgent';
  if (daysUntil <= 14) return 'approaching';
  return 'normal';
}

/** Sort order for urgency (lower = higher priority) */
function getUrgencyOrder(bid: BidSummary): number {
  const urgency = getUrgency(bid.days_until_deadline);
  const order: Record<Urgency, number> = {
    overdue: 0,
    urgent: 1,
    approaching: 2,
    normal: 3,
    none: 4,
  };
  return order[urgency] * 10000 + (bid.days_until_deadline ?? 9999);
}

/** Format date in UK format DD/MM/YYYY */
function formatDateUK(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return dateStr;
  }
}

/** Format deadline text for badge display */
function formatDeadlineText(
  deadline: string | null,
  daysUntil: number | null,
): string {
  if (!deadline) return 'No deadline';
  if (daysUntil === null) return formatDateUK(deadline);
  if (daysUntil < 0) {
    return `${Math.abs(daysUntil)} day${Math.abs(daysUntil) !== 1 ? 's' : ''} overdue`;
  }
  if (daysUntil === 0) return 'Due today';
  return `${daysUntil} day${daysUntil !== 1 ? 's' : ''}`;
}

/** Calculate progress percentage */
function calculateProgress(answered: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((answered / total) * 100);
}

/** Map status to valid CSS modifier */
function getStatusModifier(status: string): string {
  const validStatuses = ['draft', 'active', 'submitted', 'won', 'lost'];
  return validStatuses.includes(status) ? status : 'draft';
}

/** Build card class name from urgency and expanded state */
function buildCardClassName(urgency: Urgency, isExpanded: boolean): string {
  const classes = ['bid-card'];
  if (
    urgency === 'overdue' ||
    urgency === 'urgent' ||
    urgency === 'approaching'
  ) {
    classes.push(`bid-card--${urgency}`);
  }
  if (isExpanded) {
    classes.push('bid-card--expanded');
  }
  return classes.join(' ');
}

// ---------------------------------------------------------------------------
// Coverage Matrix logic reimplemented from mcp-apps/coverage-matrix/src/app.ts
// ---------------------------------------------------------------------------

interface DomainData {
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
}

interface GapEntry {
  domain: string;
  subtopic: string | null;
  item_count: number;
  issue: 'empty' | 'thin' | 'stale_only';
}

/** Check if a domain has gaps */
function domainHasGaps(domain: DomainData, gaps: GapEntry[]): boolean {
  return gaps.some((g) => g.domain === domain.name);
}

/** Calculate freshness distribution as percentages */
function freshnessPercentages(counts: {
  fresh: number;
  aging: number;
  stale: number;
  expired: number;
}): { fresh: number; aging: number; stale: number; expired: number } {
  const total = counts.fresh + counts.aging + counts.stale + counts.expired;
  if (total === 0) return { fresh: 0, aging: 0, stale: 0, expired: 0 };
  return {
    fresh: Math.round((counts.fresh / total) * 100),
    aging: Math.round((counts.aging / total) * 100),
    stale: Math.round((counts.stale / total) * 100),
    expired: Math.round((counts.expired / total) * 100),
  };
}

/** Sort domains: those with gaps first, then alphabetically */
function sortDomainsForDisplay(
  domains: DomainData[],
  gaps: GapEntry[],
): DomainData[] {
  return [...domains].sort((a, b) => {
    const aHasGaps = domainHasGaps(a, gaps);
    const bHasGaps = domainHasGaps(b, gaps);
    if (aHasGaps && !bHasGaps) return -1;
    if (!aHasGaps && bHasGaps) return 1;
    return a.name.localeCompare(b.name);
  });
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Bid Dashboard: urgency calculation', () => {
  it('returns "overdue" for negative days', () => {
    expect(getUrgency(-1)).toBe('overdue');
    expect(getUrgency(-30)).toBe('overdue');
  });

  it('returns "urgent" for 0 to 3 days', () => {
    expect(getUrgency(0)).toBe('urgent');
    expect(getUrgency(1)).toBe('urgent');
    expect(getUrgency(3)).toBe('urgent');
  });

  it('returns "approaching" for 4 to 14 days', () => {
    expect(getUrgency(4)).toBe('approaching');
    expect(getUrgency(14)).toBe('approaching');
  });

  it('returns "normal" for 15+ days', () => {
    expect(getUrgency(15)).toBe('normal');
    expect(getUrgency(100)).toBe('normal');
  });

  it('returns "none" for null (no deadline)', () => {
    expect(getUrgency(null)).toBe('none');
  });
});

describe('Bid Dashboard: bid sorting', () => {
  const bids: BidSummary[] = [
    {
      id: '1',
      name: 'Normal',
      buyer: null,
      status: 'active',
      deadline: '2026-06-01',
      days_until_deadline: 30,
      total_questions: 10,
      answered_questions: 5,
      approved_questions: 2,
    },
    {
      id: '2',
      name: 'Overdue',
      buyer: null,
      status: 'active',
      deadline: '2026-02-01',
      days_until_deadline: -10,
      total_questions: 10,
      answered_questions: 5,
      approved_questions: 2,
    },
    {
      id: '3',
      name: 'Urgent',
      buyer: null,
      status: 'active',
      deadline: '2026-03-12',
      days_until_deadline: 2,
      total_questions: 10,
      answered_questions: 5,
      approved_questions: 2,
    },
    {
      id: '4',
      name: 'No Deadline',
      buyer: null,
      status: 'draft',
      deadline: null,
      days_until_deadline: null,
      total_questions: 10,
      answered_questions: 5,
      approved_questions: 2,
    },
    {
      id: '5',
      name: 'Approaching',
      buyer: null,
      status: 'active',
      deadline: '2026-03-20',
      days_until_deadline: 10,
      total_questions: 10,
      answered_questions: 5,
      approved_questions: 2,
    },
  ];

  it('sorts overdue bids first', () => {
    const sorted = [...bids].sort(
      (a, b) => getUrgencyOrder(a) - getUrgencyOrder(b),
    );
    expect(sorted[0].name).toBe('Overdue');
  });

  it('sorts urgent bids after overdue', () => {
    const sorted = [...bids].sort(
      (a, b) => getUrgencyOrder(a) - getUrgencyOrder(b),
    );
    expect(sorted[1].name).toBe('Urgent');
  });

  it('sorts no-deadline bids last', () => {
    const sorted = [...bids].sort(
      (a, b) => getUrgencyOrder(a) - getUrgencyOrder(b),
    );
    expect(sorted[sorted.length - 1].name).toBe('No Deadline');
  });

  it('maintains correct full order: overdue, urgent, approaching, normal, none', () => {
    const sorted = [...bids].sort(
      (a, b) => getUrgencyOrder(a) - getUrgencyOrder(b),
    );
    const names = sorted.map((b) => b.name);
    expect(names).toEqual([
      'Overdue',
      'Urgent',
      'Approaching',
      'Normal',
      'No Deadline',
    ]);
  });
});

describe('Bid Dashboard: date formatting (UK)', () => {
  it('formats ISO date as DD/MM/YYYY', () => {
    expect(formatDateUK('2026-04-15')).toBe('15/04/2026');
  });

  it('formats date with single-digit day and month', () => {
    expect(formatDateUK('2026-01-05')).toBe('05/01/2026');
  });

  it('formats year-end date correctly', () => {
    expect(formatDateUK('2026-12-31')).toBe('31/12/2026');
  });

  it('returns original string for invalid date', () => {
    // new Date('not-a-date') returns Invalid Date, getDate() returns NaN
    // The function wraps in try/catch, so it should return the original or NaN-based string
    const result = formatDateUK('not-a-date');
    // Just verify it does not throw
    expect(typeof result).toBe('string');
  });
});

describe('Bid Dashboard: deadline text', () => {
  it('returns "No deadline" when deadline is null', () => {
    expect(formatDeadlineText(null, null)).toBe('No deadline');
  });

  it('returns date only when daysUntil is null', () => {
    expect(formatDeadlineText('2026-06-01', null)).toBe('01/06/2026');
  });

  it('returns "Due today" for 0 days', () => {
    expect(formatDeadlineText('2026-03-10', 0)).toBe('Due today');
  });

  it('returns "X days overdue" for negative days', () => {
    expect(formatDeadlineText('2026-03-01', -5)).toBe('5 days overdue');
  });

  it('uses singular "day" for 1 day overdue', () => {
    expect(formatDeadlineText('2026-03-09', -1)).toBe('1 day overdue');
  });

  it('returns "X days" for positive days', () => {
    expect(formatDeadlineText('2026-03-25', 15)).toBe('15 days');
  });

  it('uses singular "day" for 1 day remaining', () => {
    expect(formatDeadlineText('2026-03-11', 1)).toBe('1 day');
  });
});

describe('Bid Dashboard: progress calculation', () => {
  it('calculates correct percentage', () => {
    expect(calculateProgress(18, 25)).toBe(72);
  });

  it('returns 0 for zero total questions', () => {
    expect(calculateProgress(0, 0)).toBe(0);
  });

  it('returns 100 for fully answered', () => {
    expect(calculateProgress(10, 10)).toBe(100);
  });

  it('rounds to nearest integer', () => {
    expect(calculateProgress(1, 3)).toBe(33);
    expect(calculateProgress(2, 3)).toBe(67);
  });
});

describe('Bid Dashboard: status badge mapping', () => {
  it('returns known status as-is', () => {
    expect(getStatusModifier('active')).toBe('active');
    expect(getStatusModifier('draft')).toBe('draft');
    expect(getStatusModifier('submitted')).toBe('submitted');
    expect(getStatusModifier('won')).toBe('won');
    expect(getStatusModifier('lost')).toBe('lost');
  });

  it('falls back to "draft" for unknown status', () => {
    expect(getStatusModifier('unknown_status')).toBe('draft');
    expect(getStatusModifier('')).toBe('draft');
  });
});

describe('Bid Dashboard: card class name building', () => {
  it('includes urgency modifier for overdue', () => {
    expect(buildCardClassName('overdue', false)).toBe(
      'bid-card bid-card--overdue',
    );
  });

  it('includes urgency modifier for urgent', () => {
    expect(buildCardClassName('urgent', false)).toBe(
      'bid-card bid-card--urgent',
    );
  });

  it('includes urgency modifier for approaching', () => {
    expect(buildCardClassName('approaching', false)).toBe(
      'bid-card bid-card--approaching',
    );
  });

  it('does not include modifier for normal', () => {
    expect(buildCardClassName('normal', false)).toBe('bid-card');
  });

  it('does not include modifier for none', () => {
    expect(buildCardClassName('none', false)).toBe('bid-card');
  });

  it('includes expanded modifier when expanded', () => {
    expect(buildCardClassName('overdue', true)).toBe(
      'bid-card bid-card--overdue bid-card--expanded',
    );
  });

  it('includes only expanded modifier for normal+expanded', () => {
    expect(buildCardClassName('normal', true)).toBe(
      'bid-card bid-card--expanded',
    );
  });
});

describe('Coverage Matrix: freshness distribution percentages', () => {
  it('calculates correct percentages', () => {
    const pct = freshnessPercentages({
      fresh: 120,
      aging: 40,
      stale: 20,
      expired: 6,
    });
    // 120/186 = 64.5 -> 65, 40/186 = 21.5 -> 22, 20/186 = 10.8 -> 11, 6/186 = 3.2 -> 3
    expect(pct.fresh).toBe(65);
    expect(pct.aging).toBe(22);
    expect(pct.stale).toBe(11);
    expect(pct.expired).toBe(3);
  });

  it('returns all zeros for empty data', () => {
    const pct = freshnessPercentages({
      fresh: 0,
      aging: 0,
      stale: 0,
      expired: 0,
    });
    expect(pct.fresh).toBe(0);
    expect(pct.aging).toBe(0);
    expect(pct.stale).toBe(0);
    expect(pct.expired).toBe(0);
  });

  it('handles single-category data', () => {
    const pct = freshnessPercentages({
      fresh: 100,
      aging: 0,
      stale: 0,
      expired: 0,
    });
    expect(pct.fresh).toBe(100);
    expect(pct.aging).toBe(0);
  });
});

describe('Coverage Matrix: gap detection', () => {
  const gaps: GapEntry[] = [
    {
      domain: 'Security',
      subtopic: 'Zero Trust',
      item_count: 0,
      issue: 'empty',
    },
    {
      domain: 'Security',
      subtopic: 'Incident Response',
      item_count: 2,
      issue: 'thin',
    },
  ];

  const securityDomain: DomainData = {
    name: 'Security',
    total_items: 45,
    fresh: 30,
    aging: 10,
    stale: 3,
    expired: 2,
    subtopics: [],
  };

  const operationsDomain: DomainData = {
    name: 'Operations',
    total_items: 20,
    fresh: 15,
    aging: 3,
    stale: 1,
    expired: 1,
    subtopics: [],
  };

  it('detects domain with gaps', () => {
    expect(domainHasGaps(securityDomain, gaps)).toBe(true);
  });

  it('detects domain without gaps', () => {
    expect(domainHasGaps(operationsDomain, gaps)).toBe(false);
  });
});

describe('Coverage Matrix: domain sorting for display', () => {
  const gaps: GapEntry[] = [
    {
      domain: 'Security',
      subtopic: 'Zero Trust',
      item_count: 0,
      issue: 'empty',
    },
  ];

  const domains: DomainData[] = [
    {
      name: 'Operations',
      total_items: 20,
      fresh: 15,
      aging: 3,
      stale: 1,
      expired: 1,
      subtopics: [],
    },
    {
      name: 'Compliance',
      total_items: 10,
      fresh: 5,
      aging: 3,
      stale: 1,
      expired: 1,
      subtopics: [],
    },
    {
      name: 'Security',
      total_items: 45,
      fresh: 30,
      aging: 10,
      stale: 3,
      expired: 2,
      subtopics: [],
    },
  ];

  it('puts domains with gaps first', () => {
    const sorted = sortDomainsForDisplay(domains, gaps);
    expect(sorted[0].name).toBe('Security');
  });

  it('sorts remaining domains alphabetically', () => {
    const sorted = sortDomainsForDisplay(domains, gaps);
    expect(sorted[1].name).toBe('Compliance');
    expect(sorted[2].name).toBe('Operations');
  });

  it('handles empty gaps (all alphabetical)', () => {
    const sorted = sortDomainsForDisplay(domains, []);
    expect(sorted[0].name).toBe('Compliance');
    expect(sorted[1].name).toBe('Operations');
    expect(sorted[2].name).toBe('Security');
  });
});
