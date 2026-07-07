import { describe, expect, it } from 'vitest';

import { formatReorientation } from '@/lib/mcp/formatters/dashboard';
import type { ProcurementBriefing, ReorientData } from '@/types/reorient';

// Regression guard for MCP eval l3 TE-05: the reorientation briefing's
// "Procurement Summary" used to iterate every bid with no cap, so a large
// procurement corpus pushed get_reorientation past the 10,000-char response
// budget. The list is now capped at 10 with an overflow line.

function makeBriefing(i: number): ProcurementBriefing {
  return {
    id: `bid-${i}`,
    name: `Procurement ${i}`,
    buyer: `Buyer ${i}`,
    status: 'active',
    deadline: null,
    days_until_deadline: null,
    urgency: 'normal',
    total_questions: 10,
    answered_questions: 5,
    approved_questions: 3,
    gap_count: 0,
    href: `/p/${i}`,
  };
}

function makeData(bidCount: number): ReorientData {
  return {
    last_active_at: null,
    last_active_relative: '',
    urgent: [],
    team_changes: [],
    my_recent_work: [],
    forms_summary: Array.from({ length: bidCount }, (_, i) =>
      makeBriefing(i + 1),
    ),
    counts: {
      unread_notifications: 0,
      pending_reviews: 0,
      stale_or_expired: 0,
      quality_flags: 0,
    },
    generated_at: '2026-06-25T00:00:00Z',
    user_display_name: null,
    has_display_name: false,
    errors: [],
  };
}

const countBidHeaders = (markdown: string): number =>
  (markdown.match(/^### Procurement /gm) ?? []).length;

describe('formatReorientation — Procurement Summary cap (TE-05)', () => {
  it('renders every bid and no overflow line when the list is <= 10', () => {
    const out = formatReorientation(makeData(10));
    expect(countBidHeaders(out)).toBe(10);
    expect(out).not.toContain('more procurements');
  });

  it('caps the rendered list at 10 and appends an overflow line when > 10', () => {
    const out = formatReorientation(makeData(25));
    expect(countBidHeaders(out)).toBe(10);
    expect(out).toContain('...and 15 more procurements');
  });

  it('keeps the briefing well under the 10k response budget for a huge bid list', () => {
    const out = formatReorientation(makeData(500));
    expect(out.length).toBeLessThan(10_000);
  });
});
