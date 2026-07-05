/**
 * Dashboard Unified Data Tests
 *
 * Tests the cert count extraction and coverage gap count logic
 * used by fetchUnifiedDashboardData() in lib/dashboard.ts.
 *
 * These tests verify the data processing logic in isolation rather
 * than mocking the full Supabase query chain, since the extraction
 * functions operate on result arrays from Promise.allSettled.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Cert count extraction logic tests
// ---------------------------------------------------------------------------

describe('certification expiry count extraction', () => {
  const FROZEN_NOW = new Date('2026-03-24T12:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Mirrors the extraction logic from fetchUnifiedDashboardData for
   * query 11 results. Extracted here for isolated testing.
   */
  function countExpiringCerts(
    data: {
      canonical_name: string;
      metadata: Record<string, unknown> | null;
    }[],
  ): number {
    const now = new Date();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    const seen = new Set<string>();
    let count = 0;

    for (const row of data) {
      if (seen.has(row.canonical_name)) continue;
      seen.add(row.canonical_name);
      const expiryDate = row.metadata?.expiry_date as string | undefined;
      if (expiryDate) {
        const expiry = new Date(expiryDate);
        const diffMs = expiry.getTime() - now.getTime();
        if (diffMs <= ninetyDaysMs) {
          count++;
        }
      }
    }

    return count;
  }

  it('counts certifications expiring within 90 days', () => {
    const data = [
      {
        canonical_name: 'ISO 27001',
        metadata: { expiry_date: '2026-05-01T00:00:00Z' }, // ~38 days away
      },
      {
        canonical_name: 'Cyber Essentials',
        metadata: { expiry_date: '2026-06-15T00:00:00Z' }, // ~83 days away
      },
    ];

    expect(countExpiringCerts(data)).toBe(2);
  });

  it('excludes certifications expiring beyond 90 days', () => {
    const data = [
      {
        canonical_name: 'ISO 9001',
        metadata: { expiry_date: '2027-01-01T00:00:00Z' }, // ~282 days away
      },
    ];

    expect(countExpiringCerts(data)).toBe(0);
  });

  it('counts already-expired certifications', () => {
    const data = [
      {
        canonical_name: 'Expired Cert',
        metadata: { expiry_date: '2025-12-01T00:00:00Z' }, // past
      },
    ];

    expect(countExpiringCerts(data)).toBe(1);
  });

  it('skips certifications without expiry dates', () => {
    const data = [
      {
        canonical_name: 'No Expiry',
        metadata: { issuing_body: 'BSI' }, // no expiry_date
      },
      {
        canonical_name: 'Null Metadata',
        metadata: null,
      },
    ];

    expect(countExpiringCerts(data)).toBe(0);
  });

  it('deduplicates by canonical_name', () => {
    const data = [
      {
        canonical_name: 'ISO 27001',
        metadata: { expiry_date: '2026-05-01T00:00:00Z' },
      },
      {
        canonical_name: 'ISO 27001', // duplicate
        metadata: { expiry_date: '2026-05-01T00:00:00Z' },
      },
      {
        canonical_name: 'ISO 27001', // another duplicate
        metadata: { expiry_date: '2026-04-15T00:00:00Z' },
      },
    ];

    // Should count only once
    expect(countExpiringCerts(data)).toBe(1);
  });

  it('returns 0 for empty data', () => {
    expect(countExpiringCerts([])).toBe(0);
  });

  it('handles mixed: some expiring, some not, some without dates', () => {
    const data = [
      {
        canonical_name: 'Expiring Soon',
        metadata: { expiry_date: '2026-04-15T00:00:00Z' }, // ~22 days
      },
      {
        canonical_name: 'Valid Long',
        metadata: { expiry_date: '2027-06-01T00:00:00Z' }, // ~434 days
      },
      {
        canonical_name: 'No Date',
        metadata: {},
      },
      {
        canonical_name: 'Already Expired',
        metadata: { expiry_date: '2026-01-01T00:00:00Z' }, // past
      },
    ];

    // Expiring Soon + Already Expired = 2
    expect(countExpiringCerts(data)).toBe(2);
  });
});

// Coverage gap count extraction tests REMOVED (ID-131.19 S450 Wave 1 Fix 1)
// — coverage_gap_count is RETIRED per DR-034 (content_items-era coverage
// feature retired). This describe block tested a client-side taxonomy/
// content-item mirror of logic that had already moved entirely into the
// get_dashboard_attention_counts RPC (fetchUnifiedDashboardData just reads
// counts.coverage_gap_count) — it was already stale relative to the real
// code path even before the retirement. See lib/attention.ts and
// lib/dashboard.ts for the full disposition.
