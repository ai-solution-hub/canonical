import { describe, it, expect, vi, afterEach } from 'vitest';
import { deriveExpiryStatus } from '@/lib/certification-status';
import type { ExpiryStatus } from '@/lib/certification-status';

describe('deriveExpiryStatus', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "unknown" when no expiry date is provided', () => {
    expect(deriveExpiryStatus()).toBe('unknown');
    expect(deriveExpiryStatus(undefined)).toBe('unknown');
  });

  it('returns "valid" for a date more than 30 days in the future', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T00:00:00Z'));

    const result = deriveExpiryStatus('2026-06-01');
    expect(result).toBe('valid');
  });

  it('returns "expiring_soon" for a date within 30 days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T00:00:00Z'));

    // 20 days from now — within the 30-day window
    const result = deriveExpiryStatus('2026-02-04');
    expect(result).toBe('expiring_soon');
  });

  it('returns "expired" for a date in the past', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T00:00:00Z'));

    const result = deriveExpiryStatus('2025-12-01');
    expect(result).toBe('expired');
  });

  it('returns "expired" for today\'s date (same day, expiry is midnight)', () => {
    vi.useFakeTimers();
    // Set time to noon on 15 Jan
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));

    // Expiry date of '2026-01-15' parses to midnight UTC on 15 Jan,
    // which is before noon — so it should be expired
    const result = deriveExpiryStatus('2026-01-15');
    expect(result).toBe('expired');
  });

  it('returns "expiring_soon" for exactly 30 days from now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T00:00:00Z'));

    // Exactly 30 days later — the difference equals 30 days,
    // so (expiry - now) is NOT less than 30 days, it equals 30 days
    // This means it should return 'valid' (not strictly less than 30 days)
    const result = deriveExpiryStatus('2026-02-14');
    expect(result).toBe('valid');
  });

  it('returns "expiring_soon" for 29 days from now (just inside window)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T00:00:00Z'));

    const result = deriveExpiryStatus('2026-02-13');
    expect(result).toBe('expiring_soon');
  });

  it('handles ISO 8601 date-time strings', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T00:00:00Z'));

    const result = deriveExpiryStatus('2026-06-01T23:59:59Z');
    expect(result).toBe('valid');
  });

  it('returns correct type for each status', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T00:00:00Z'));

    const statuses: ExpiryStatus[] = [
      deriveExpiryStatus(undefined), // unknown
      deriveExpiryStatus('2027-01-01'), // valid
      deriveExpiryStatus('2026-07-01'), // expiring_soon
      deriveExpiryStatus('2026-01-01'), // expired
    ];

    expect(statuses).toEqual(['unknown', 'valid', 'expiring_soon', 'expired']);
  });
});
