import { describe, it, expect } from 'vitest';
import { computeDriftAge } from '../../../scripts/lib/task-view-drift-age';

/**
 * Tests for the pure drift-age tiering helper (ID-157).
 *
 * Provenance: bl-464 / ID-148.12 — the lib/ledger/ primitive-drift step went
 * unactioned for ~5 upstream releases before the {148.12} re-vendor caught
 * up. This helper compares the last time TASK_VIEW_TAG moved (a proxy for
 * "a newer upstream release exists") against the last time lib/ledger/ was
 * actually re-synced, and buckets the gap into a severity tier used to
 * escalate LOUDER within the workflow's non-blocking (OQ-T2) constraint.
 */

describe('computeDriftAge', () => {
  it('is in-sync when the vendor sync happened at the same moment as the tag bump', () => {
    const result = computeDriftAge(
      '2026-07-10T00:00:00Z',
      '2026-07-10T00:00:00Z',
    );
    expect(result).toEqual({
      ageDays: 0,
      tier: 'in-sync',
      message: expect.stringContaining('no staleness'),
    });
  });

  it('is in-sync when the vendor sync happened AFTER the last tag bump', () => {
    // A re-vendor commit that lands after the tag moved is current, even
    // though the two timestamps differ.
    const result = computeDriftAge(
      '2026-07-01T00:00:00Z',
      '2026-07-10T00:00:00Z',
    );
    expect(result.ageDays).toBe(0);
    expect(result.tier).toBe('in-sync');
  });

  it('is a notice for a small gap (10 days)', () => {
    const result = computeDriftAge(
      '2026-07-11T00:00:00Z',
      '2026-07-01T00:00:00Z',
    );
    expect(result.ageDays).toBe(10);
    expect(result.tier).toBe('notice');
  });

  it('stays a notice at exactly the 45-day boundary', () => {
    const result = computeDriftAge(
      '2026-08-15T00:00:00Z',
      '2026-07-01T00:00:00Z',
    );
    expect(result.ageDays).toBe(45);
    expect(result.tier).toBe('notice');
  });

  it('escalates to warning just past the 45-day boundary', () => {
    const result = computeDriftAge(
      '2026-08-16T00:00:00Z',
      '2026-07-01T00:00:00Z',
    );
    expect(result.ageDays).toBe(46);
    expect(result.tier).toBe('warning');
  });

  it('stays a warning at exactly the 120-day boundary', () => {
    const result = computeDriftAge(
      '2026-10-29T00:00:00Z',
      '2026-07-01T00:00:00Z',
    );
    expect(result.ageDays).toBe(120);
    expect(result.tier).toBe('warning');
  });

  it('escalates to critical just past the 120-day boundary, echoing the {148.12} provenance', () => {
    const result = computeDriftAge(
      '2026-10-30T00:00:00Z',
      '2026-07-01T00:00:00Z',
    );
    expect(result.ageDays).toBe(121);
    expect(result.tier).toBe('critical');
    expect(result.message).toContain('148.12');
  });

  it('throws a RangeError on an unparseable tag-bump date', () => {
    expect(() => computeDriftAge('not-a-date', '2026-07-01T00:00:00Z')).toThrow(
      RangeError,
    );
  });

  it('throws a RangeError on an unparseable vendor-sync date', () => {
    expect(() => computeDriftAge('2026-07-01T00:00:00Z', 'not-a-date')).toThrow(
      RangeError,
    );
  });
});
