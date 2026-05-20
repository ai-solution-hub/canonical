/**
 * Attention Data Model Tests
 *
 * Tests all producer functions, sort, filter, and buildAttentionItems from
 * lib/attention.ts — the unified attention data model for the dashboard.
 */
import { describe, it, expect } from 'vitest';
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
import type { AttentionItem, AttentionSourceData } from '@/lib/attention';
import type { ActiveBidSummary } from '@/lib/dashboard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBid(overrides: Partial<ActiveBidSummary> = {}): ActiveBidSummary {
  return {
    id: 'bid-1',
    name: 'Test Procurement',
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
// Producer tests
// ---------------------------------------------------------------------------

describe('produceGovernanceReviewItems', () => {
  it('returns empty array for zero count', () => {
    expect(produceGovernanceReviewItems(0)).toEqual([]);
  });

  it('returns critical severity item for positive count', () => {
    const items = produceGovernanceReviewItems(3);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('critical');
    expect(items[0].type).toBe('governance_review');
    expect(items[0].role_visibility).toEqual(['admin', 'editor']);
    expect(items[0].count).toBe(3);
  });

  it('uses singular grammar for count of 1', () => {
    const items = produceGovernanceReviewItems(1);
    expect(items[0].title).toContain('1 governance review pending');
  });

  it('uses plural grammar for count > 1', () => {
    const items = produceGovernanceReviewItems(5);
    expect(items[0].title).toContain('5 governance reviews pending');
  });

  it('includes action_url pointing to /review', () => {
    const items = produceGovernanceReviewItems(3);
    expect(items[0].action_url).toBe('/review');
  });

  it('includes a claude_prompt', () => {
    const items = produceGovernanceReviewItems(2);
    expect(items[0].claude_prompt).toBeDefined();
    expect(items[0].claude_prompt).toContain('2');
  });

  it('uses singular grammar in detail for count of 1', () => {
    const items = produceGovernanceReviewItems(1);
    expect(items[0].detail).toContain('1 content item needs');
  });

  it('uses plural grammar in detail for count > 1', () => {
    const items = produceGovernanceReviewItems(5);
    expect(items[0].detail).toContain('5 content items need');
  });
});

describe('produceStaleContentItems', () => {
  it('returns empty array for zero counts', () => {
    expect(produceStaleContentItems(0, 0)).toEqual([]);
  });

  it('returns expired item with high severity', () => {
    const items = produceStaleContentItems(0, 3);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('expired_content');
    expect(items[0].severity).toBe('high');
  });

  it('returns stale item with high severity', () => {
    const items = produceStaleContentItems(5, 0);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('stale_content');
    expect(items[0].severity).toBe('high');
  });

  it('returns both expired and stale items', () => {
    const items = produceStaleContentItems(2, 3);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.type)).toContain('expired_content');
    expect(items.map((i) => i.type)).toContain('stale_content');
  });

  it('items are visible to all roles', () => {
    const items = produceStaleContentItems(1, 1);
    for (const item of items) {
      expect(item.role_visibility).toEqual(['admin', 'editor', 'viewer']);
    }
  });
});

describe('produceQualityFlagItems', () => {
  it('returns empty for zero', () => {
    expect(produceQualityFlagItems(0)).toEqual([]);
  });

  it('returns high severity editor/admin item', () => {
    const items = produceQualityFlagItems(2);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('high');
    expect(items[0].role_visibility).toEqual(['admin', 'editor']);
  });

  it('sets type to quality_flag with correct count', () => {
    const items = produceQualityFlagItems(4);
    expect(items[0].type).toBe('quality_flag');
    expect(items[0].count).toBe(4);
  });
});

describe('produceUnverifiedItems', () => {
  it('returns empty for zero', () => {
    expect(produceUnverifiedItems(0)).toEqual([]);
  });

  it('returns medium severity item', () => {
    const items = produceUnverifiedItems(10);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('medium');
    expect(items[0].role_visibility).toEqual(['admin', 'editor']);
  });

  it('sets type to unverified_content with correct count', () => {
    const items = produceUnverifiedItems(12);
    expect(items[0].type).toBe('unverified_content');
    expect(items[0].count).toBe(12);
  });
});

describe('produceBidDeadlineItems', () => {
  const baseBid: ActiveBidSummary = {
    id: 'bid-1',
    name: 'Test Procurement',
    buyer: 'ACME',
    status: 'active',
    deadline: null,
    days_until_deadline: null,
    total_questions: 10,
    answered_questions: 5,
    approved_questions: 3,
  };

  it('returns empty for no bids', () => {
    expect(produceBidDeadlineItems([])).toEqual([]);
  });

  it('skips bids with normal urgency', () => {
    const bid = {
      ...baseBid,
      deadline: '2099-12-31',
      days_until_deadline: 365,
    };
    expect(produceBidDeadlineItems([bid])).toEqual([]);
  });

  it('returns critical for overdue bids', () => {
    const bid = {
      ...baseBid,
      deadline: '2020-01-01',
      days_until_deadline: -100,
    };
    const items = produceBidDeadlineItems([bid]);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('critical');
    expect(items[0].deadline).toBe('2020-01-01');
  });

  it('returns high for urgent bids (<=3 days)', () => {
    const tomorrow = new Date(Date.now() + 86400000)
      .toISOString()
      .split('T')[0];
    const bid = { ...baseBid, deadline: tomorrow, days_until_deadline: 1 };
    const items = produceBidDeadlineItems([bid]);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('high');
  });

  it('includes progress in detail', () => {
    const bid = { ...baseBid, deadline: '2020-01-01', days_until_deadline: -1 };
    const items = produceBidDeadlineItems([bid]);
    expect(items[0].detail).toContain('5/10 questions answered');
  });

  it('is visible to all roles', () => {
    const bid = { ...baseBid, deadline: '2020-01-01', days_until_deadline: -1 };
    const items = produceBidDeadlineItems([bid]);
    expect(items[0].role_visibility).toEqual(['admin', 'editor', 'viewer']);
  });

  it('returns empty array for bids with no deadline', () => {
    const bids = [makeBid({ deadline: null })];
    expect(produceBidDeadlineItems(bids)).toEqual([]);
  });

  it('maps approaching bids (< 14 days) to medium severity', () => {
    const approachingDate = new Date();
    approachingDate.setDate(approachingDate.getDate() + 7);
    const bids = [
      makeBid({
        deadline: approachingDate.toISOString(),
        days_until_deadline: 7,
      }),
    ];
    const items = produceBidDeadlineItems(bids);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('medium');
  });

  it('includes bid name and deadline info in title', () => {
    const soonDate = new Date();
    soonDate.setDate(soonDate.getDate() + 2);
    const bids = [
      makeBid({
        name: 'Acme Procurement',
        deadline: soonDate.toISOString(),
        days_until_deadline: 2,
      }),
    ];
    const items = produceBidDeadlineItems(bids);
    expect(items[0].title).toContain('Acme Procurement');
    expect(items[0].title).toContain('2 days remaining');
  });

  it('handles "due today" for 0 days remaining', () => {
    const todayDate = new Date();
    todayDate.setHours(todayDate.getHours() + 6);
    const bids = [
      makeBid({
        deadline: todayDate.toISOString(),
        days_until_deadline: 0,
      }),
    ];
    const items = produceBidDeadlineItems(bids);
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain('due today');
  });

  it('includes buyer in detail when present', () => {
    const soonDate = new Date();
    soonDate.setDate(soonDate.getDate() + 1);
    const bids = [
      makeBid({
        buyer: 'Widget Co',
        deadline: soonDate.toISOString(),
        days_until_deadline: 1,
      }),
    ];
    const items = produceBidDeadlineItems(bids);
    expect(items[0].detail).toContain('Widget Co');
  });

  it('sets entity_type to workspace with bid id', () => {
    const soonDate = new Date();
    soonDate.setDate(soonDate.getDate() + 1);
    const bids = [
      makeBid({
        id: 'bid-abc-123',
        deadline: soonDate.toISOString(),
      }),
    ];
    const items = produceBidDeadlineItems(bids);
    expect(items[0].entity_type).toBe('workspace');
    expect(items[0].entity_id).toBe('bid-abc-123');
    expect(items[0].action_url).toBe('/bids/bid-abc-123');
  });

  it('produces multiple items for multiple urgent bids', () => {
    const soonDate = new Date();
    soonDate.setDate(soonDate.getDate() + 1);
    const bids = [
      makeBid({ id: 'bid-1', name: 'Procurement A', deadline: soonDate.toISOString() }),
      makeBid({ id: 'bid-2', name: 'Procurement B', deadline: soonDate.toISOString() }),
    ];
    const items = produceBidDeadlineItems(bids);
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe('attention-bid-bid-1');
    expect(items[1].id).toBe('attention-bid-bid-2');
  });
});

describe('produceExpiringCertItems', () => {
  it('returns empty for zero', () => {
    expect(produceExpiringCertItems(0)).toEqual([]);
  });

  it('returns info severity item', () => {
    const items = produceExpiringCertItems(2);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('info');
    expect(items[0].type).toBe('expiring_certification');
  });

  it('links to /compliance', () => {
    const items = produceExpiringCertItems(2);
    expect(items[0].action_url).toBe('/compliance');
  });

  it('uses singular grammar for 1 certification', () => {
    const items = produceExpiringCertItems(1);
    expect(items[0].title).toBe('1 certification expiring soon');
  });
});

describe('produceExpiringContentDateItems', () => {
  it('returns empty for zero', () => {
    expect(produceExpiringContentDateItems(0)).toEqual([]);
  });

  it('returns medium severity item visible to all', () => {
    const items = produceExpiringContentDateItems(4);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('medium');
    expect(items[0].role_visibility).toEqual(['admin', 'editor', 'viewer']);
  });

  it('sets type to expiring_content_date with correct count', () => {
    const items = produceExpiringContentDateItems(7);
    expect(items[0].type).toBe('expiring_content_date');
    expect(items[0].count).toBe(7);
  });
});

describe('produceUnreadNotificationItems', () => {
  it('returns empty for counts below threshold (5)', () => {
    expect(produceUnreadNotificationItems(0)).toEqual([]);
    expect(produceUnreadNotificationItems(1)).toEqual([]);
    expect(produceUnreadNotificationItems(4)).toEqual([]);
  });

  it('returns item at threshold of 5', () => {
    const items = produceUnreadNotificationItems(5);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('medium');
    expect(items[0].count).toBe(5);
    expect(items[0].action_url).toBe('/');
    expect(items[0].action_label).toBe('Go to dashboard');
    expect(items[0].detail).toContain('notification bell');
  });

  it('returns item above threshold', () => {
    const items = produceUnreadNotificationItems(20);
    expect(items).toHaveLength(1);
    expect(items[0].count).toBe(20);
    expect(items[0].action_url).toBe('/');
  });
});

describe('produceCoverageGapItems', () => {
  it('returns empty for zero', () => {
    expect(produceCoverageGapItems(0)).toEqual([]);
  });

  it('returns info severity editor/admin item', () => {
    const items = produceCoverageGapItems(3);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('info');
    expect(items[0].role_visibility).toEqual(['admin', 'editor']);
  });

  it('sets type to coverage_gap with action_url to /coverage', () => {
    const items = produceCoverageGapItems(5);
    expect(items[0].type).toBe('coverage_gap');
    expect(items[0].action_url).toBe('/coverage');
  });
});

// ---------------------------------------------------------------------------
// Sort and filter tests
// ---------------------------------------------------------------------------

describe('sortAttentionItems', () => {
  const makeItem = (
    severity: AttentionItem['severity'],
    deadline?: string,
  ): AttentionItem => ({
    id: `item-${severity}-${deadline ?? 'none'}`,
    type: 'governance_review',
    severity,
    entity_type: 'aggregate',
    entity_id: 'test',
    title: 'Test',
    detail: 'Test detail',
    action_url: '/test',
    action_label: 'Test',
    role_visibility: ['admin'],
    deadline: deadline ?? null,
  });

  it('sorts by severity: critical > high > medium > info', () => {
    const items = [
      makeItem('info'),
      makeItem('high'),
      makeItem('critical'),
      makeItem('medium'),
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
    const items = [
      makeItem('high', '2026-06-01'),
      makeItem('high', '2026-03-01'),
      makeItem('high', '2026-12-01'),
    ];
    const sorted = sortAttentionItems(items);
    expect(sorted.map((i) => i.deadline)).toEqual([
      '2026-03-01',
      '2026-06-01',
      '2026-12-01',
    ]);
  });

  it('items with deadlines come before items without at same severity', () => {
    const withDeadline = makeItem('high', '2026-06-01');
    const without = makeItem('high');
    const sorted = sortAttentionItems([without, withDeadline]);
    expect(sorted[0].deadline).toBe('2026-06-01');
    expect(sorted[1].deadline).toBeNull();
  });

  it('does not mutate the original array', () => {
    const items = [makeItem('info'), makeItem('critical')];
    const sorted = sortAttentionItems(items);
    expect(sorted).not.toBe(items);
    expect(items[0].severity).toBe('info');
  });

  it('returns empty array for empty input', () => {
    expect(sortAttentionItems([])).toEqual([]);
  });
});

describe('filterByRole', () => {
  const adminOnly: AttentionItem = {
    id: 'admin-only',
    type: 'governance_review',
    severity: 'critical',
    entity_type: 'aggregate',
    entity_id: 'test',
    title: 'Admin item',
    detail: '',
    action_url: '/test',
    action_label: 'Test',
    role_visibility: ['admin', 'editor'],
  };

  const allRoles: AttentionItem = {
    id: 'all-roles',
    type: 'stale_content',
    severity: 'high',
    entity_type: 'aggregate',
    entity_id: 'test',
    title: 'All roles item',
    detail: '',
    action_url: '/test',
    action_label: 'Test',
    role_visibility: ['admin', 'editor', 'viewer'],
  };

  it('admin sees all items', () => {
    const filtered = filterByRole([adminOnly, allRoles], 'admin');
    expect(filtered).toHaveLength(2);
  });

  it('editor sees editor-visible items', () => {
    const filtered = filterByRole([adminOnly, allRoles], 'editor');
    expect(filtered).toHaveLength(2);
  });

  it('viewer only sees viewer-visible items', () => {
    const filtered = filterByRole([adminOnly, allRoles], 'viewer');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('all-roles');
  });

  it('unknown role sees nothing', () => {
    const filtered = filterByRole([adminOnly, allRoles], 'unknown');
    expect(filtered).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(filterByRole([], 'admin')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildAttentionItems integration test
// ---------------------------------------------------------------------------

describe('buildAttentionItems', () => {
  const emptyData: AttentionSourceData = {
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

  it('returns empty array for zero counts', () => {
    expect(buildAttentionItems(emptyData)).toEqual([]);
  });

  it('returns sorted items from multiple sources', () => {
    const data: AttentionSourceData = {
      ...emptyData,
      governance_review_count: 2,
      stale_content_count: 3,
      unread_notification_count: 10,
    };
    const items = buildAttentionItems(data);
    expect(items.length).toBe(3);
    // Critical (governance) first, then high (stale), then medium (notifications)
    expect(items[0].severity).toBe('critical');
    expect(items[1].severity).toBe('high');
    expect(items[2].severity).toBe('medium');
  });

  it('includes bid deadline items', () => {
    const data: AttentionSourceData = {
      ...emptyData,
      active_bids: [
        {
          id: 'bid-1',
          name: 'Overdue Procurement',
          buyer: null,
          status: 'active',
          deadline: '2020-01-01',
          days_until_deadline: -100,
          total_questions: 5,
          answered_questions: 2,
          approved_questions: 1,
        },
      ],
    };
    const items = buildAttentionItems(data);
    expect(items.length).toBe(1);
    expect(items[0].type).toBe('bid_deadline');
    expect(items[0].severity).toBe('critical');
  });

  it('combines all source types correctly', () => {
    const data: AttentionSourceData = {
      governance_review_count: 1,
      stale_content_count: 1,
      expired_content_count: 1,
      quality_flag_count: 1,
      unverified_count: 1,
      active_bids: [],
      expiring_cert_count: 1,
      expiring_content_date_count: 1,
      unread_notification_count: 10,
      coverage_gap_count: 1,
    };
    const items = buildAttentionItems(data);
    // governance(1) + expired(1) + stale(1) + quality(1) + unverified(1) +
    // cert(1) + content_date(1) + notifications(1) + coverage(1) = 9
    expect(items.length).toBe(9);
    // First should be critical (governance)
    expect(items[0].severity).toBe('critical');
    // Last should be info (certs or coverage)
    expect(items[items.length - 1].severity).toBe('info');
  });

  it('aggregates items from all producers including bids', () => {
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

  it('returns items sorted by severity with no lower before higher', () => {
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
        makeBid({ id: 'bid-1', deadline: null }),
        makeBid({ id: 'bid-2', deadline: farDate.toISOString() }),
      ],
    };
    const items = buildAttentionItems(data);
    expect(items).toEqual([]);
  });
});
