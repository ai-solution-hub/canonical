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
});

describe('produceBidDeadlineItems', () => {
  const baseBid: ActiveBidSummary = {
    id: 'bid-1',
    name: 'Test Bid',
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
    const bid = { ...baseBid, deadline: '2099-12-31', days_until_deadline: 365 };
    expect(produceBidDeadlineItems([bid])).toEqual([]);
  });

  it('returns critical for overdue bids', () => {
    const bid = { ...baseBid, deadline: '2020-01-01', days_until_deadline: -100 };
    const items = produceBidDeadlineItems([bid]);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('critical');
    expect(items[0].deadline).toBe('2020-01-01');
  });

  it('returns high for urgent bids (<=3 days)', () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
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
});

describe('produceUnreadNotificationItems', () => {
  it('returns empty for counts below threshold (5)', () => {
    expect(produceUnreadNotificationItems(0)).toEqual([]);
    expect(produceUnreadNotificationItems(4)).toEqual([]);
  });

  it('returns item at threshold of 5', () => {
    const items = produceUnreadNotificationItems(5);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('medium');
    expect(items[0].count).toBe(5);
  });

  it('returns item above threshold', () => {
    const items = produceUnreadNotificationItems(20);
    expect(items).toHaveLength(1);
    expect(items[0].count).toBe(20);
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
});

// ---------------------------------------------------------------------------
// Sort and filter tests
// ---------------------------------------------------------------------------

describe('sortAttentionItems', () => {
  const makeItem = (severity: AttentionItem['severity'], deadline?: string): AttentionItem => ({
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
      'critical', 'high', 'medium', 'info',
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
      '2026-03-01', '2026-06-01', '2026-12-01',
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
          name: 'Overdue Bid',
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
});
