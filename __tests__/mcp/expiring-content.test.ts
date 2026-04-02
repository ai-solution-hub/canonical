/**
 * MCP Tool: get_expiring_content
 *
 * Tests the formatter, type interfaces, and urgency classification for the
 * expiring content tool. Follows the pattern from certification-status-tool.test.ts
 * — tests the formatter output rather than the live MCP server.
 */
import { describe, it, expect } from 'vitest';
import {
  formatExpiringContent,
  type ExpiringContentData,
  type ExpiringContentItem,
  type ExpiringEntityMention,
} from '@/lib/mcp/formatters/dashboard';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

const expiringItem: ExpiringContentItem = {
  id: 'item-1',
  title: 'ISO 27001 Policy Document',
  expiry_date: daysFromNow(15),
  days_remaining: 15,
  domain: 'Information Governance',
  lifecycle_type: 'date_bound',
};

const urgentItem: ExpiringContentItem = {
  id: 'item-2',
  title: 'Cyber Essentials Certificate',
  expiry_date: daysFromNow(3),
  days_remaining: 3,
  domain: 'Information Governance',
  lifecycle_type: 'date_bound',
};

const overdueItem: ExpiringContentItem = {
  id: 'item-3',
  title: 'DBS Check Policy',
  expiry_date: daysFromNow(-5),
  days_remaining: -5,
  domain: 'People Management',
  lifecycle_type: 'date_bound',
};

const differentDomainItem: ExpiringContentItem = {
  id: 'item-4',
  title: 'Fire Safety Assessment',
  expiry_date: daysFromNow(20),
  days_remaining: 20,
  domain: 'Health & Safety',
  lifecycle_type: 'date_bound',
};

const upcomingItem: ExpiringContentItem = {
  id: 'item-5',
  title: 'Annual Review Document',
  expiry_date: daysFromNow(45),
  days_remaining: 45,
  domain: 'Quality Management',
  lifecycle_type: 'date_bound',
};

const expiringEntity: ExpiringEntityMention = {
  canonical_name: 'ISO 27001',
  entity_type: 'certification',
  expiry_date: daysFromNow(10),
  days_remaining: 10,
  expiry_status: 'expiring_soon',
};

const expiredEntity: ExpiringEntityMention = {
  canonical_name: 'Cyber Essentials Plus',
  entity_type: 'certification',
  expiry_date: daysFromNow(-2),
  days_remaining: -2,
  expiry_status: 'expired',
};

const validEntity: ExpiringEntityMention = {
  canonical_name: 'ICO Registration',
  entity_type: 'regulation',
  expiry_date: daysFromNow(25),
  days_remaining: 25,
  expiry_status: 'expiring_soon',
};

function buildData(
  overrides?: Partial<ExpiringContentData>,
): ExpiringContentData {
  return {
    content_items: [expiringItem, urgentItem],
    entity_mentions: [expiringEntity],
    days_ahead: 30,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Formatter tests
// ---------------------------------------------------------------------------

describe('formatExpiringContent', () => {
  it('produces a markdown report with the correct heading', () => {
    const result = formatExpiringContent(buildData());
    expect(result).toContain('# Expiring Content');
  });

  it('includes the lookahead period', () => {
    const result = formatExpiringContent(buildData({ days_ahead: 60 }));
    expect(result).toContain('**60 days**');
  });

  it('includes content items section with count', () => {
    const result = formatExpiringContent(buildData());
    expect(result).toContain('## Expiring Content Items (2)');
  });

  it('includes content item details in the table', () => {
    const result = formatExpiringContent(buildData());
    expect(result).toContain('ISO 27001 Policy Document');
    expect(result).toContain('Information Governance');
    expect(result).toContain('15');
    expect(result).toContain('SOON');
  });

  it('shows URGENT for items within 7 days', () => {
    const result = formatExpiringContent(
      buildData({ content_items: [urgentItem] }),
    );
    expect(result).toContain('URGENT');
    expect(result).toContain('Cyber Essentials Certificate');
  });

  it('shows OVERDUE for items past expiry', () => {
    const result = formatExpiringContent(
      buildData({ content_items: [overdueItem] }),
    );
    expect(result).toContain('OVERDUE');
    expect(result).toContain('5 overdue');
  });

  it('shows UPCOMING for items beyond 30 days', () => {
    const result = formatExpiringContent(
      buildData({ content_items: [upcomingItem], days_ahead: 60 }),
    );
    expect(result).toContain('UPCOMING');
  });

  it('includes entity mentions section with count', () => {
    const result = formatExpiringContent(buildData());
    expect(result).toContain('## Expiring Certifications/Registrations (1)');
  });

  it('includes entity mention details in the table', () => {
    const result = formatExpiringContent(
      buildData({ entity_mentions: [expiringEntity, validEntity] }),
    );
    expect(result).toContain('ISO 27001');
    expect(result).toContain('certification');
    expect(result).toContain('ICO Registration');
    expect(result).toContain('regulation');
  });

  it('shows expired entity mentions', () => {
    const result = formatExpiringContent(
      buildData({ entity_mentions: [expiredEntity] }),
    );
    expect(result).toContain('Cyber Essentials Plus');
    expect(result).toContain('OVERDUE');
    expect(result).toContain('2 overdue');
  });

  it('returns empty state when no content items are expiring', () => {
    const result = formatExpiringContent(buildData({ content_items: [] }));
    expect(result).toContain('No content items expiring within this period.');
  });

  it('returns empty state when no entity mentions are expiring', () => {
    const result = formatExpiringContent(buildData({ entity_mentions: [] }));
    expect(result).toContain(
      'No certifications or registrations expiring within this period.',
    );
  });

  it('returns empty state for both sections when nothing is expiring', () => {
    const result = formatExpiringContent(
      buildData({
        content_items: [],
        entity_mentions: [],
      }),
    );
    expect(result).toContain('No content items expiring within this period.');
    expect(result).toContain(
      'No certifications or registrations expiring within this period.',
    );
  });

  it('respects custom days_ahead parameter in display', () => {
    const result = formatExpiringContent(buildData({ days_ahead: 90 }));
    expect(result).toContain('**90 days**');
  });

  it('handles items from different domains', () => {
    const result = formatExpiringContent(
      buildData({
        content_items: [expiringItem, differentDomainItem],
      }),
    );
    expect(result).toContain('Information Governance');
    expect(result).toContain('Health & Safety');
  });

  it('shows Unclassified for items without a domain', () => {
    const noDomainItem: ExpiringContentItem = {
      ...expiringItem,
      domain: null,
    };
    const result = formatExpiringContent(
      buildData({ content_items: [noDomainItem] }),
    );
    expect(result).toContain('Unclassified');
  });

  it('includes table headers for content items', () => {
    const result = formatExpiringContent(buildData());
    expect(result).toContain(
      '| Item | Domain | Expiry Date | Days Remaining | Urgency |',
    );
  });

  it('includes table headers for entity mentions', () => {
    const result = formatExpiringContent(buildData());
    expect(result).toContain(
      '| Name | Type | Expiry Date | Days Remaining | Status |',
    );
  });

  it('excludes entity mentions section when include_entities would be false (empty array)', () => {
    const result = formatExpiringContent(buildData({ entity_mentions: [] }));
    // Should NOT have a table of entity mentions
    expect(result).not.toContain(
      '| Name | Type | Expiry Date | Days Remaining | Status |',
    );
    expect(result).toContain(
      'No certifications or registrations expiring within this period.',
    );
  });

  it('correctly handles a mix of urgency levels', () => {
    const result = formatExpiringContent(
      buildData({
        content_items: [overdueItem, urgentItem, expiringItem, upcomingItem],
        days_ahead: 60,
      }),
    );
    expect(result).toContain('OVERDUE');
    expect(result).toContain('URGENT');
    expect(result).toContain('SOON');
    expect(result).toContain('UPCOMING');
    expect(result).toContain('## Expiring Content Items (4)');
  });
});
