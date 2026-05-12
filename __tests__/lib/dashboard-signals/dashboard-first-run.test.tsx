/**
 * Dashboard first-run integration tests (P0-4 Phase 1)
 *
 * Exercises the shared `deriveIsKBEmpty` / `deriveIsFirstLogin` predicates
 * from `@/lib/dashboard-signals` — the exact functions `app/page.tsx`
 * consumes. Keeps the integration boundary narrow while guaranteeing the
 * page and the tests cannot diverge.
 *
 * Spec §7.2 — tests 11-15.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveIsKBEmpty,
  deriveIsFirstLogin,
  type FreshnessSummary,
  type ReorientFirstLoginInput,
} from '@/lib/dashboard-signals';

// Suppressed sections when KB is empty (mirrors app/page.tsx guards).
const SUPPRESSED_SECTIONS = [
  'ContentPerformanceSection',
  'QuickStatsStrip',
  'ComplianceStatusSection',
  'PipelineRunsPanel',
  'RecentActivity',
] as const;

const ALWAYS_VISIBLE = [
  'WarningsBanner',
  'McpSetupNudge',
  'ReorientSection',
  'UnifiedAttentionSection',
  'ActiveBidsSection',
  'OwnedContentHealth',
] as const;

describe('Dashboard first-run signals', () => {
  it('derives isKBEmpty=true when all freshness buckets are zero', () => {
    const freshness: FreshnessSummary = {
      fresh: 0,
      aging: 0,
      stale: 0,
      expired: 0,
    };
    expect(deriveIsKBEmpty(freshness)).toBe(true);
    expect(SUPPRESSED_SECTIONS).toHaveLength(5);
  });

  it('derives isKBEmpty=false when any freshness bucket is non-zero', () => {
    expect(deriveIsKBEmpty({ fresh: 1, aging: 0, stale: 0, expired: 0 })).toBe(
      false,
    );
    expect(deriveIsKBEmpty({ fresh: 0, aging: 3, stale: 0, expired: 0 })).toBe(
      false,
    );
    expect(deriveIsKBEmpty({ fresh: 0, aging: 0, stale: 1, expired: 0 })).toBe(
      false,
    );
    expect(deriveIsKBEmpty({ fresh: 0, aging: 0, stale: 0, expired: 1 })).toBe(
      false,
    );
  });

  it('derives isFirstLogin=true when user has no prior activity', () => {
    const reorient: ReorientFirstLoginInput = {
      last_active_at: null,
      my_recent_work: [],
      team_changes: [],
    };
    expect(deriveIsFirstLogin(reorient)).toBe(true);
  });

  it('derives isFirstLogin=false when last_active_at is set', () => {
    const reorient: ReorientFirstLoginInput = {
      last_active_at: '2026-04-23T08:00:00Z',
      my_recent_work: [],
      team_changes: [],
    };
    expect(deriveIsFirstLogin(reorient)).toBe(false);
  });

  it('treats isKBEmpty and isFirstLogin as independent signals', () => {
    const freshness: FreshnessSummary = {
      fresh: 0,
      aging: 0,
      stale: 0,
      expired: 0,
    };
    const reorient: ReorientFirstLoginInput = {
      last_active_at: '2026-04-23T08:00:00Z',
      my_recent_work: [],
      team_changes: [],
    };

    expect(deriveIsKBEmpty(freshness)).toBe(true);
    expect(deriveIsFirstLogin(reorient)).toBe(false);
  });

  it('handles first login with existing KB content', () => {
    const freshness: FreshnessSummary = {
      fresh: 5,
      aging: 2,
      stale: 1,
      expired: 0,
    };
    const reorient: ReorientFirstLoginInput = {
      last_active_at: null,
      my_recent_work: [],
      team_changes: [],
    };

    expect(deriveIsKBEmpty(freshness)).toBe(false);
    expect(deriveIsFirstLogin(reorient)).toBe(true);
  });

  it('detects non-first-login when user has recent work', () => {
    const reorient: ReorientFirstLoginInput = {
      last_active_at: null,
      my_recent_work: [{ entity_id: 'item-1' }],
      team_changes: [],
    };
    expect(deriveIsFirstLogin(reorient)).toBe(false);
  });

  it('detects non-first-login when team changes exist', () => {
    const reorient: ReorientFirstLoginInput = {
      last_active_at: null,
      my_recent_work: [],
      team_changes: [{ user_id: 'user-a' }],
    };
    expect(deriveIsFirstLogin(reorient)).toBe(false);
  });

  it('correctly categorises sections for KB empty suppression', () => {
    expect(SUPPRESSED_SECTIONS).toContain('ContentPerformanceSection');
    expect(SUPPRESSED_SECTIONS).toContain('QuickStatsStrip');
    expect(SUPPRESSED_SECTIONS).toContain('ComplianceStatusSection');
    expect(SUPPRESSED_SECTIONS).toContain('PipelineRunsPanel');
    expect(SUPPRESSED_SECTIONS).toContain('RecentActivity');

    expect(ALWAYS_VISIBLE).toContain('ReorientSection');
    expect(ALWAYS_VISIBLE).toContain('UnifiedAttentionSection');
    expect(ALWAYS_VISIBLE).toContain('ActiveBidsSection');
  });
});
