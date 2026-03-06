import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDeadlineUrgency, getDaysUntilDeadline } from '@/lib/dashboard';

// Freeze time to 2026-03-06T12:00:00Z for deterministic results
const FROZEN_NOW = new Date('2026-03-06T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// getDeadlineUrgency
// ---------------------------------------------------------------------------

describe('getDeadlineUrgency', () => {
  it('returns "unknown" for a null deadline', () => {
    expect(getDeadlineUrgency(null)).toBe('unknown');
  });

  it('returns "overdue" for a past deadline', () => {
    expect(getDeadlineUrgency('2026-03-05T00:00:00Z')).toBe('overdue');
  });

  it('returns "urgent" when deadline is within 3 days', () => {
    // ~1.5 days from now
    expect(getDeadlineUrgency('2026-03-08T00:00:00Z')).toBe('urgent');
  });

  it('returns "urgent" when deadline is exactly now (0 days)', () => {
    // diffDays = 0 which is < 3
    expect(getDeadlineUrgency('2026-03-06T12:00:00Z')).toBe('urgent');
  });

  it('returns "approaching" when deadline is within 14 days but beyond 3', () => {
    // 7 days from now
    expect(getDeadlineUrgency('2026-03-13T12:00:00Z')).toBe('approaching');
  });

  it('returns "approaching" at exactly 3 days away', () => {
    // diffDays = 3.0 — not < 3 so not urgent, but < 14 so approaching
    expect(getDeadlineUrgency('2026-03-09T12:00:00Z')).toBe('approaching');
  });

  it('returns "normal" at exactly 14 days away', () => {
    // diffDays = 14.0 — not < 14 so not approaching
    expect(getDeadlineUrgency('2026-03-20T12:00:00Z')).toBe('normal');
  });

  it('returns "normal" when deadline is far in the future', () => {
    expect(getDeadlineUrgency('2026-06-01T00:00:00Z')).toBe('normal');
  });
});

// ---------------------------------------------------------------------------
// getDaysUntilDeadline
// ---------------------------------------------------------------------------

describe('getDaysUntilDeadline', () => {
  it('returns null for a null deadline', () => {
    expect(getDaysUntilDeadline(null)).toBeNull();
  });

  it('returns a negative number for a past deadline', () => {
    // 1 day ago
    const result = getDaysUntilDeadline('2026-03-05T12:00:00Z');
    expect(result).toBe(-1);
  });

  it('returns 0 when deadline is exactly now', () => {
    expect(getDaysUntilDeadline('2026-03-06T12:00:00Z')).toBe(0);
  });

  it('returns a positive number for a future deadline', () => {
    // Exactly 7 days away
    expect(getDaysUntilDeadline('2026-03-13T12:00:00Z')).toBe(7);
  });

  it('rounds up partial days using Math.ceil', () => {
    // 2.5 days from now => Math.ceil(2.5) = 3
    expect(getDaysUntilDeadline('2026-03-09T00:00:00Z')).toBe(3);
  });
});
