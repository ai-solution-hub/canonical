import { describe, it, expect } from 'vitest';
import type { ActiveBidSummary } from '@/lib/dashboard';
import type { AttentionItem, AttentionSourceData } from '@/lib/attention';
import {
  produceGovernanceReviewItems,
  produceStaleContentItems,
  produceQualityFlagItems,
  produceUnverifiedItems,
  produceBidDeadlineItems,
  produceExpiringCertItems,
  produceExpiringContentDateItems,
  produceUnreadNotificationItems,
  produceCoverageGapItems,
  sortAttentionItems,
  filterByRole,
  buildAttentionItems,
} from '@/lib/attention';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBid(overrides: Partial<ActiveBidSummary> = {}): ActiveBidSummary {
  return {
    id: 'bid-1',
    name: 'Test Bid',
    buyer: 'Acme Corp',
    status: 'in_progress',
    deadline: null,
    days_until_deadline: null,
    total_questions: 10,
    answered_questions: 5,
    approved_questions: 3,
    ...overrides,
  };
}

function emptySourceData(): AttentionSourceData {
  return {
    governance_review_count: 0,
    stale_content_count: 0,
    expired_content_count: 0,
    quality_flag_count: 0,
    unverified_count: 0,
    active_bids: [],
    expiring_cert_count: 0,
    expiring_content_date_count: 0,
    unread_notification_count: 0,
    coverage_gap_count: 0,
  };
}

// ---------------------------------------------------------------------------
// Producer: governance reviews
// ---------------------------------------------------------------------------

describe('produceGovernanceReviewItems', () => {
  it('returns empty array when count is 0', () => {
    expect(produceGovernanceReviewItems(0)).toEqual([]);
  });

  it('returns a critical-severity item for positive count', () => {
    const items = produceGovernanceReviewItems(3);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('critical');
    expect(items[0].type).toBe('governance_review');
    expect(items[0].count).toBe(3);
    expect(items[0].action_url).toBe('/review');
    expect(items[0].role_visibility).toEqual(['admin', 'editor']);
  });

  it('uses singular grammar for count of 1', () => {
    const items = produceGovernanceReviewItems(1);
    expect(items[0].title).toBe('1 governance review pending');
    expect(items[0].detail).toContain('1 content item needs');
  });

  it('uses plural grammar for count > 1', () => {
    const items = produceGovernanceReviewItems(5);
    expect(items[0].title).toBe('5 governance reviews pending');
    expect(items[0].detail).toContain('5 content items need');
  });

  it('includes a claude_prompt', () => {
    const items = produceGovernanceReviewItems(2);
    expect(items[0].claude_prompt).toBeDefined();
    expect(items[0].claude_prompt).toContain('2');
  });
});

// ---------------------------------------------------------------------------
// Producer: stale/expired content
// ---------------------------------------------------------------------------

describe('produceStaleContentItems', () => {
  it('returns empty array when both counts are 0', () => {
    expect(produceStaleContentItems(0, 0)).toEqual([]);
  });

  it('returns only expired item when stale is 0', () => {
    const items = produceStaleContentItems(0, 3);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('expired_content');
  });

  it('returns only stale item when expired is 0', () => {
    const items = produceStaleContentItems(4, 0);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('stale_content');
  });

  it('returns both items when both counts are positive', () => {
    const items = produceStaleContentItems(3, 2);
    expect(items).toHaveLength(2);
    const types = items.map((i) => i.type);
    expect(types).toContain('expired_content');
    expect(types).toContain('stale_content');
  });

  it('sets high severity for both expired and stale items', () => {
    const items = produceStaleContentItems(2, 3);
    expect(items.every((i) => i.severity === 'high')).toBe(true);
  });

  it('makes items visible to all roles', () => {
    const items = produceStaleContentItems(1, 1);
    for (const item of items) {
      expect(item.role_visibility).toEqual(['admin', 'editor', 'viewer']);
    }
  });
});

// ---------------------------------------------------------------------------
// Producer: quality flags
// ---------------------------------------------------------------------------

describe('produceQualityFlagItems', () => {
  it('returns empty array when count is 0', () => {
    expect(produceQualityFlagItems(0)).toEqual([]);
  });

  it('returns a high-severity item', () => {
    const items = produceQualityFlagItems(4);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('high');
    expect(items[0].type).toBe('quality_flag');
    expect(items[0].count).toBe(4);
  });

  it('is visible to admin and editor only', () => {
    const items = produceQualityFlagItems(1);
    expect(items[0].role_visibility).toEqual(['admin', 'editor']);
  });
});

// ---------------------------------------------------------------------------
// Producer: unverified items
// ---------------------------------------------------------------------------

describe('produceUnverifiedItems', () => {
  it('returns empty array when count is 0', () => {
    expect(produceUnverifiedItems(0)).toEqual([]);
  });

  it('returns a medium-severity item', () => {
    const items = produceUnverifiedItems(12);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('medium');
    expect(items[0].type).toBe('unverified_content');
    expect(items[0].count).toBe(12);
  });

  it('is visible to admin and editor only', () => {
    const items = produceUnverifiedItems(1);
    expect(items[0].role_visibility).toEqual(['admin', 'editor']);
  });
});

// ---------------------------------------------------------------------------
// Producer: bid deadlines
// ---------------------------------------------------------------------------

describe('produceBidDeadlineItems', () => {
  it('returns empty array for empty bids list', () => {
    expect(produceBidDeadlineItems([])).toEqual([]);
  });

  it('returns empty array for bids with no deadline', () => {
    const bids = [makeBid({ deadline: null })];
    expect(produceBidDeadlineItems(bids)).toEqual([]);
  });

  it('returns empty array for bids with normal urgency', () => {
    // Set deadline far in the future (30 days from now)
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);
    const bids = [makeBid({ deadline: futureDate.toISOString() })];
    expect(produceBidDeadlineItems(bids)).toEqual([]);
  });

  it('maps overdue bids to critical severity', () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 2);
    const bids = [makeBid({
      deadline: pastDate.toISOString(),
      days_until_deadline: -2,
    })];
    const items = produceBidDeadlineItems(bids);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('critical');
    expect(items[0].title).toContain('overdue');
  });

  it('maps urgent bids (< 3 days) to high severity', () => {
    const soonDate = new Date();
    soonDate.setDate(soonDate.getDate() + 1);
    const bids = [makeBid({
      deadline: soonDate.toISOString(),
      days_until_deadline: 1,
    })];
    const items = produceBidDeadlineItems(bids);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('high');
  });

  it('maps approaching bids (< 14 days) to medium severity', () => {
    const approachingDate = new Date();
    approachingDate.setDate(approachingDate.getDate() + 7);
    const bids = [makeBid({
      deadline: approachingDate.toISOString(),
      days_until_deadline: 7,
    })];
    const items = produceBidDeadlineItems(bids);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('medium');
  });

  it('includes bid name and deadline info in title', () => {
    const soonDate = new Date();
    soonDate.setDate(soonDate.getDate() + 2);
    const bids = [makeBid({
      name: 'Acme Bid',
      deadline: soonDate.toISOString(),
      days_until_deadline: 2,
    })];
    const items = produceBidDeadlineItems(bids);
    expect(items[0].title).toContain('Acme Bid');
    expect(items[0].title).toContain('2 days remaining');
  });

  it('handles "due today" for 0 days remaining', () => {
    // Create deadline that is today but still in the future (within 24h)
    const todayDate = new Date();
    todayDate.setHours(todayDate.getHours() + 6);
    const bids = [makeBid({
      deadline: todayDate.toISOString(),
      days_until_deadline: 0,
    })];
    const items = produceBidDeadlineItems(bids);
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain('due today');
  });

  it('includes buyer in detail when present', () => {
    const soonDate = new Date();
    soonDate.setDate(soonDate.getDate() + 1);
    const bids = [makeBid({
      buyer: 'Widget Co',
      deadline: soonDate.toISOString(),
      days_until_deadline: 1,
    })];
    const items = produceBidDeadlineItems(bids);
    expect(items[0].detail).toContain('Widget Co');
  });

  it('sets entity_type to workspace with bid id', () => {
    const soonDate = new Date();
    soonDate.setDate(soonDate.getDate() + 1);
    const bids = [makeBid({
      id: 'bid-abc-123',
      deadline: soonDate.toISOString(),
    })];
    const items = produceBidDeadlineItems(bids);
    expect(items[0].entity_type).toBe('workspace');
    expect(items[0].entity_id).toBe('bid-abc-123');
    expect(items[0].action_url).toBe('/bids/bid-abc-123');
  });

  it('is visible to all roles', () => {
    const soonDate = new Date();
    soonDate.setDate(soonDate.getDate() + 1);
    const bids = [makeBid({ deadline: soonDate.toISOString() })];
    const items = produceBidDeadlineItems(bids);
    expect(items[0].role_visibility).toEqual(['admin', 'editor', 'viewer']);
  });

  it('produces multiple items for multiple urgent bids', () => {
    const soonDate = new Date();
    soonDate.setDate(soonDate.getDate() + 1);
    const bids = [
      makeBid({ id: 'bid-1', name: 'Bid A', deadline: soonDate.toISOString() }),
      makeBid({ id: 'bid-2', name: 'Bid B', deadline: soonDate.toISOString() }),
    ];
    const items = produceBidDeadlineItems(bids);
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe('attention-bid-bid-1');
    expect(items[1].id).toBe('attention-bid-bid-2');
  });
});

// ---------------------------------------------------------------------------
// Producer: expiring certifications
// ---------------------------------------------------------------------------

describe('produceExpiringCertItems', () => {
  it('returns empty array when count is 0', () => {
    expect(produceExpiringCertItems(0)).toEqual([]);
  });

  it('returns an info-severity item', () => {
    const items = produceExpiringCertItems(2);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('info');
    expect(items[0].type).toBe('expiring_certification');
    expect(items[0].action_url).toBe('/compliance');
  });

  it('uses singular grammar for 1 certification', () => {
    const items = produceExpiringCertItems(1);
    expect(items[0].title).toBe('1 certification expiring soon');
  });
});

// ---------------------------------------------------------------------------
// Producer: expiring content dates
// ---------------------------------------------------------------------------

describe('produceExpiringContentDateItems', () => {
  it('returns empty array when count is 0', () => {
    expect(produceExpiringContentDateItems(0)).toEqual([]);
  });

  it('returns a medium-severity item', () => {
    const items = produceExpiringContentDateItems(7);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('medium');
    expect(items[0].type).toBe('expiring_content_date');
    expect(items[0].count).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Producer: unread notifications
// ---------------------------------------------------------------------------

describe('produceUnreadNotificationItems', () => {
  it('returns empty array when count is 0', () => {
    expect(produceUnreadNotificationItems(0)).toEqual([]);
  });

  it('returns empty array when count is below threshold (< 5)', () => {
    expect(produceUnreadNotificationItems(1)).toEqual([]);
    expect(produceUnreadNotificationItems(4)).toEqual([]);
  });

  it('returns a medium-severity item at threshold (5)', () => {
    const items = produceUnreadNotificationItems(5);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('medium');
    expect(items[0].type).toBe('unread_notifications');
    expect(items[0].count).toBe(5);
  });

  it('returns items above threshold', () => {
    const items = produceUnreadNotificationItems(20);
    expect(items).toHaveLength(1);
    expect(items[0].count).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Producer: coverage gaps
// ---------------------------------------------------------------------------

describe('produceCoverageGapItems', () => {
  it('returns empty array when count is 0', () => {
    expect(produceCoverageGapItems(0)).toEqual([]);
  });

  it('returns an info-severity item', () => {
    const items = produceCoverageGapItems(5);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('info');
    expect(items[0].type).toBe('coverage_gap');
    expect(items[0].action_url).toBe('/coverage');
  });

  it('is visible to admin and editor only', () => {
    const items = produceCoverageGapItems(3);
    expect(items[0].role_visibility).toEqual(['admin', 'editor']);
  });
});

// ---------------------------------------------------------------------------
// Sort function
// ---------------------------------------------------------------------------

describe('sortAttentionItems', () => {
  it('sorts by severity: critical before high before medium before info', () => {
    const items: AttentionItem[] = [
      { ...produceUnverifiedItems(1)[0], severity: 'info' },
      { ...produceUnverifiedItems(2)[0], id: 'b', severity: 'critical' },
      { ...produceUnverifiedItems(3)[0], id: 'c', severity: 'medium' },
      { ...produceUnverifiedItems(4)[0], id: 'd', severity: 'high' },
    ];
    const sorted = sortAttentionItems(items);
    expect(sorted.map((i) => i.severity)).toEqual([
      'critical',
      'high',
      'medium',
      'info',
    ]);
  });

  it('sorts by deadline proximity within same severity', () => {
    const earlyDeadline = '2026-04-01T00:00:00Z';
    const lateDeadline = '2026-04-15T00:00:00Z';
    const items: AttentionItem[] = [
      {
        ...produceUnverifiedItems(1)[0],
        id: 'late',
        severity: 'high',
        deadline: lateDeadline,
      },
      {
        ...produceUnverifiedItems(2)[0],
        id: 'early',
        severity: 'high',
        deadline: earlyDeadline,
      },
    ];
    const sorted = sortAttentionItems(items);
    expect(sorted[0].id).toBe('early');
    expect(sorted[1].id).toBe('late');
  });

  it('places items with deadlines before items without within same severity', () => {
    const items: AttentionItem[] = [
      {
        ...produceUnverifiedItems(1)[0],
        id: 'no-deadline',
        severity: 'high',
        deadline: undefined,
      },
      {
        ...produceUnverifiedItems(2)[0],
        id: 'has-deadline',
        severity: 'high',
        deadline: '2026-04-01T00:00:00Z',
      },
    ];
    const sorted = sortAttentionItems(items);
    expect(sorted[0].id).toBe('has-deadline');
    expect(sorted[1].id).toBe('no-deadline');
  });

  it('does not mutate the original array', () => {
    const items: AttentionItem[] = [
      { ...produceUnverifiedItems(1)[0], severity: 'info' },
      { ...produceUnverifiedItems(2)[0], id: 'b', severity: 'critical' },
    ];
    const original = [...items];
    sortAttentionItems(items);
    expect(items[0].severity).toBe(original[0].severity);
    expect(items[1].severity).toBe(original[1].severity);
  });

  it('returns empty array for empty input', () => {
    expect(sortAttentionItems([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Filter function
// ---------------------------------------------------------------------------

describe('filterByRole', () => {
  it('filters items to only those visible to the given role', () => {
    const items: AttentionItem[] = [
      ...produceGovernanceReviewItems(3), // admin, editor
      ...produceCoverageGapItems(2), // admin, editor
      ...produceExpiringCertItems(1), // admin, editor, viewer
    ];

    const viewerItems = filterByRole(items, 'viewer');
    expect(viewerItems).toHaveLength(1);
    expect(viewerItems[0].type).toBe('expiring_certification');
  });

  it('returns all items for admin role', () => {
    const items: AttentionItem[] = [
      ...produceGovernanceReviewItems(1),
      ...produceCoverageGapItems(1),
      ...produceExpiringCertItems(1),
    ];
    expect(filterByRole(items, 'admin')).toHaveLength(3);
  });

  it('returns empty array for unknown role', () => {
    const items = produceGovernanceReviewItems(3);
    expect(filterByRole(items, 'unknown')).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(filterByRole([], 'admin')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Aggregate function: buildAttentionItems
// ---------------------------------------------------------------------------

describe('buildAttentionItems', () => {
  it('returns empty array when all counts are 0', () => {
    expect(buildAttentionItems(emptySourceData())).toEqual([]);
  });

  it('aggregates items from all producers', () => {
    const urgentDate = new Date();
    urgentDate.setDate(urgentDate.getDate() + 1);
    const data: AttentionSourceData = {
      governance_review_count: 2,
      stale_content_count: 3,
      expired_content_count: 1,
      quality_flag_count: 4,
      unverified_count: 10,
      active_bids: [makeBid({ deadline: urgentDate.toISOString() })],
      expiring_cert_count: 1,
      expiring_content_date_count: 2,
      unread_notification_count: 8,
      coverage_gap_count: 5,
    };
    const items = buildAttentionItems(data);

    // Should have items from all active producers
    const types = new Set(items.map((i) => i.type));
    expect(types.has('governance_review')).toBe(true);
    expect(types.has('stale_content')).toBe(true);
    expect(types.has('expired_content')).toBe(true);
    expect(types.has('quality_flag')).toBe(true);
    expect(types.has('unverified_content')).toBe(true);
    expect(types.has('bid_deadline')).toBe(true);
    expect(types.has('expiring_certification')).toBe(true);
    expect(types.has('expiring_content_date')).toBe(true);
    expect(types.has('unread_notifications')).toBe(true);
    expect(types.has('coverage_gap')).toBe(true);
  });

  it('returns items sorted by severity', () => {
    const urgentDate = new Date();
    urgentDate.setDate(urgentDate.getDate() + 1);
    const data: AttentionSourceData = {
      governance_review_count: 1, // critical
      stale_content_count: 1, // high
      expired_content_count: 0,
      quality_flag_count: 0,
      unverified_count: 1, // medium
      active_bids: [makeBid({ deadline: urgentDate.toISOString() })], // high
      expiring_cert_count: 1, // info
      expiring_content_date_count: 0,
      unread_notification_count: 0,
      coverage_gap_count: 0,
    };
    const items = buildAttentionItems(data);
    const severities = items.map((i) => i.severity);

    // Verify ordering: no item of lower severity precedes a higher severity
    for (let i = 1; i < severities.length; i++) {
      const order = ['critical', 'high', 'medium', 'info'];
      expect(order.indexOf(severities[i])).toBeGreaterThanOrEqual(
        order.indexOf(severities[i - 1]),
      );
    }
  });

  it('does not include notification items below threshold', () => {
    const data: AttentionSourceData = {
      ...emptySourceData(),
      unread_notification_count: 3, // below threshold of 5
    };
    const items = buildAttentionItems(data);
    expect(items).toEqual([]);
  });

  it('includes notification items at threshold', () => {
    const data: AttentionSourceData = {
      ...emptySourceData(),
      unread_notification_count: 5,
    };
    const items = buildAttentionItems(data);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('unread_notifications');
  });

  it('skips bids with no deadline or normal urgency', () => {
    const farDate = new Date();
    farDate.setDate(farDate.getDate() + 60);
    const data: AttentionSourceData = {
      ...emptySourceData(),
      active_bids: [
        makeBid({ id: 'bid-1', deadline: null }), // unknown — skipped
        makeBid({ id: 'bid-2', deadline: farDate.toISOString() }), // normal — skipped
      ],
    };
    const items = buildAttentionItems(data);
    expect(items).toEqual([]);
  });
});
