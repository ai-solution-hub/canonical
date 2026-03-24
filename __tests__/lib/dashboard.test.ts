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
    data: { canonical_name: string; metadata: Record<string, unknown> | null }[],
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

// ---------------------------------------------------------------------------
// Coverage gap count extraction logic tests
// ---------------------------------------------------------------------------

describe('coverage gap count extraction', () => {
  /**
   * Mirrors the extraction logic from fetchUnifiedDashboardData for
   * queries 12+13. Extracted here for isolated testing.
   */
  function countCoverageGaps(
    activeSubtopics: { id: string; name: string; domain_id: string }[],
    contentItems: { primary_subtopic: string | null }[],
  ): number {
    const coveredSubtopics = new Set(
      contentItems
        .map((item) => item.primary_subtopic)
        .filter((s): s is string => s !== null),
    );
    return activeSubtopics.filter((st) => !coveredSubtopics.has(st.name)).length;
  }

  it('counts subtopics with zero content items', () => {
    const subtopics = [
      { id: '1', name: 'Data Protection', domain_id: 'd1' },
      { id: '2', name: 'Network Security', domain_id: 'd1' },
      { id: '3', name: 'Business Continuity', domain_id: 'd2' },
    ];

    const contentItems = [
      { primary_subtopic: 'Data Protection' },
      { primary_subtopic: 'Data Protection' },
    ];

    // Network Security and Business Continuity have no content
    expect(countCoverageGaps(subtopics, contentItems)).toBe(2);
  });

  it('returns 0 when all subtopics have content', () => {
    const subtopics = [
      { id: '1', name: 'A', domain_id: 'd1' },
      { id: '2', name: 'B', domain_id: 'd1' },
    ];

    const contentItems = [
      { primary_subtopic: 'A' },
      { primary_subtopic: 'B' },
    ];

    expect(countCoverageGaps(subtopics, contentItems)).toBe(0);
  });

  it('returns full count when no content items exist', () => {
    const subtopics = [
      { id: '1', name: 'X', domain_id: 'd1' },
      { id: '2', name: 'Y', domain_id: 'd1' },
      { id: '3', name: 'Z', domain_id: 'd2' },
    ];

    expect(countCoverageGaps(subtopics, [])).toBe(3);
  });

  it('returns 0 for empty subtopics', () => {
    expect(countCoverageGaps([], [{ primary_subtopic: 'A' }])).toBe(0);
  });

  it('ignores content items with null primary_subtopic', () => {
    const subtopics = [
      { id: '1', name: 'A', domain_id: 'd1' },
    ];

    const contentItems = [
      { primary_subtopic: null },
      { primary_subtopic: null },
    ];

    // A has no content (null subtopics don't count)
    expect(countCoverageGaps(subtopics, contentItems)).toBe(1);
  });

  it('handles large taxonomy correctly', () => {
    const subtopics = Array.from({ length: 34 }, (_, i) => ({
      id: `${i}`,
      name: `Subtopic ${i}`,
      domain_id: `d${Math.floor(i / 5)}`,
    }));

    // Cover 20 out of 34 subtopics
    const contentItems = Array.from({ length: 20 }, (_, i) => ({
      primary_subtopic: `Subtopic ${i}`,
    }));

    expect(countCoverageGaps(subtopics, contentItems)).toBe(14);
  });
});
