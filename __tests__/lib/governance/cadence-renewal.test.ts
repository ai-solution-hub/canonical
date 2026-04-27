/**
 * Unit tests for `computeNextReviewDate` — the cadence-renewal helper used
 * by both the `POST /api/governance/review` handler and the MCP
 * `review_governance_item` tool.
 *
 * Spec: docs/specs/p0-document-control-lifecycle-spec.md §6.5 + §6.9 AC8
 * Plan:  docs/plans/§5.5-phase-2-cron-plan.md T2
 *
 * Pinned-time pattern per CLAUDE.md ("Date-sensitive tests need pinned time"
 * gotcha) — `vi.spyOn(Date, 'now')` to avoid `setDate()`-style midnight
 * boundary flakiness when the test happens to run near 00:00 UTC.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeNextReviewDate } from '@/lib/governance/cadence-renewal';

// Pinned "today" — 15/04/2026 12:00:00 UTC. Chosen so today + 180d falls on
// 12/10/2026, a deterministic ISO date avoiding any DST or month-boundary
// rounding quirks.
const PINNED_TODAY_ISO = '2026-04-15T12:00:00.000Z';
const PINNED_TODAY = new Date(PINNED_TODAY_ISO);
const PINNED_TODAY_MS = PINNED_TODAY.getTime();

describe('computeNextReviewDate', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(PINNED_TODAY_MS);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when reviewCadenceDays is null (no cadence configured)', () => {
    expect(computeNextReviewDate('2026-04-01', null, PINNED_TODAY)).toBeNull();
  });

  it('returns null when both inputs are null', () => {
    expect(computeNextReviewDate(null, null, PINNED_TODAY)).toBeNull();
  });

  it('uses today when currentNextReviewDate is in the past', () => {
    // current=2025-12-01 (~135d in the past relative to 2026-04-15) +180d
    // GREATEST(past, today) picks today → today + 180d = 2026-10-12
    const result = computeNextReviewDate('2025-12-01', 180, PINNED_TODAY);
    expect(result).toBe('2026-10-12');
  });

  it('uses currentNextReviewDate when it is in the future (GREATEST branch)', () => {
    // current=2027-12-31 + 180d = 2028-06-28 (spec §13.2 row 7)
    const result = computeNextReviewDate('2027-12-31', 180, PINNED_TODAY);
    expect(result).toBe('2028-06-28');
  });

  it('falls back to today when currentNextReviewDate is empty string (malformed)', () => {
    const result = computeNextReviewDate('', 180, PINNED_TODAY);
    expect(result).toBe('2026-10-12');
  });

  it('falls back to today when currentNextReviewDate is "invalid" (malformed)', () => {
    const result = computeNextReviewDate('invalid', 180, PINNED_TODAY);
    expect(result).toBe('2026-10-12');
  });

  it('uses today when currentNextReviewDate is null (item not yet scheduled)', () => {
    const result = computeNextReviewDate(null, 180, PINNED_TODAY);
    expect(result).toBe('2026-10-12');
  });

  it('handles cadence=1 (minimum CHECK value) without underflow', () => {
    const result = computeNextReviewDate(null, 1, PINNED_TODAY);
    expect(result).toBe('2026-04-16');
  });

  it('handles cadence=1095 (maximum CHECK value) without overflow', () => {
    // 2026-04-15 + 1095d = 2029-04-14
    const result = computeNextReviewDate(null, 1095, PINNED_TODAY);
    expect(result).toBe('2029-04-14');
  });

  it('returns YYYY-MM-DD format (not full ISO timestamp)', () => {
    const result = computeNextReviewDate('2026-04-01', 30, PINNED_TODAY);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns a YYYY-MM-DD-shaped string when third arg is omitted (default today=new Date())', () => {
    // Smoke check — the default-arg branch at least produces a valid ISO date
    // string. We don't pin against the wall clock (`new Date()` ignores
    // `Date.now` spies on V8/Bun) — explicit-today coverage above is the
    // load-bearing assertion for the formula.
    const result = computeNextReviewDate('2026-04-01', 30);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
