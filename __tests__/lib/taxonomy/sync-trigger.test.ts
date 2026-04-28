/**
 * Tests for `lib/taxonomy/sync-trigger.ts`.
 *
 * P0-TX WP2: verifies the taxonomy sync trigger helpers:
 * - computeTaxonomyHash determinism and sensitivity
 * - Hash projection excludes cosmetic fields (colour, provenance, display_order)
 * - Hash is input-order independent (sorted internally)
 * - enqueueTaxonomySync debounce collapse (5 calls in <2 s = 1 fetch)
 * - enqueueTaxonomySync fires separately for calls spaced >2 s apart
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import {
  computeTaxonomyHash,
  enqueueTaxonomySync,
  type TaxonomySnapshot,
} from '@/lib/taxonomy/sync-trigger';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSnapshot(
  overrides: Partial<TaxonomySnapshot> = {},
): TaxonomySnapshot {
  return {
    domains: [
      {
        id: 'dom-1',
        name: 'Public Sector',
        description: 'Government and public body work',
        key_signal: 'Funded by taxpayer money',
        display_order: 1,
        is_active: true,
        colour: '#ff0000',
        provenance: 'manual',
      },
      {
        id: 'dom-2',
        name: 'Health & Social Care',
        description: 'NHS and social care services',
        key_signal: 'Clinical or care settings',
        display_order: 2,
        is_active: true,
        colour: '#00ff00',
        provenance: 'manual',
      },
    ],
    subtopics: [
      {
        id: 'sub-1',
        domain_id: 'dom-1',
        name: 'Procurement',
        description: 'Public procurement processes',
        display_order: 1,
        is_active: true,
        provenance: 'manual',
      },
      {
        id: 'sub-2',
        domain_id: 'dom-1',
        name: 'Compliance',
        description: 'Regulatory compliance',
        display_order: 2,
        is_active: true,
        provenance: 'manual',
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeTaxonomyHash
// ---------------------------------------------------------------------------

describe('computeTaxonomyHash', () => {
  it('produces the same hash for identical input (determinism)', () => {
    const snapshot = makeSnapshot();
    const hash1 = computeTaxonomyHash(snapshot);
    const hash2 = computeTaxonomyHash(snapshot);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex digest
  });

  it('produces different hashes for different inputs (sensitivity)', () => {
    const base = makeSnapshot();
    const altered = makeSnapshot({
      domains: [
        ...base.domains.map((d, i) =>
          i === 0 ? { ...d, name: 'Changed Domain Name' } : d,
        ),
      ],
    });

    expect(computeTaxonomyHash(base)).not.toBe(computeTaxonomyHash(altered));
  });

  it('ignores colour changes (cosmetic field excluded from hash)', () => {
    const base = makeSnapshot();
    const recoloured = makeSnapshot({
      domains: base.domains.map((d) => ({ ...d, colour: '#000000' })),
    });

    expect(computeTaxonomyHash(base)).toBe(computeTaxonomyHash(recoloured));
  });

  it('ignores provenance changes (cosmetic field excluded from hash)', () => {
    const base = makeSnapshot();
    const retagged = makeSnapshot({
      domains: base.domains.map((d) => ({
        ...d,
        provenance: 'automated',
      })),
    });

    expect(computeTaxonomyHash(base)).toBe(computeTaxonomyHash(retagged));
  });

  it('ignores display_order changes that do not alter relative sort', () => {
    // Same relative order, different absolute values — sort is stable
    // so the projected output is identical.
    const base = makeSnapshot();
    const renumbered = makeSnapshot({
      domains: base.domains.map((d, i) => ({
        ...d,
        display_order: (i + 1) * 10,
      })),
    });

    expect(computeTaxonomyHash(base)).toBe(computeTaxonomyHash(renumbered));
  });

  it('is input-order independent (domains reordered produce same hash)', () => {
    const base = makeSnapshot();
    const reversed = makeSnapshot({
      domains: [...base.domains].reverse(),
    });

    expect(computeTaxonomyHash(base)).toBe(computeTaxonomyHash(reversed));
  });

  it('is input-order independent (subtopics reordered produce same hash)', () => {
    const base = makeSnapshot();
    const reversed = makeSnapshot({
      subtopics: [...base.subtopics].reverse(),
    });

    expect(computeTaxonomyHash(base)).toBe(computeTaxonomyHash(reversed));
  });

  it('excludes inactive domains from the hash', () => {
    const base = makeSnapshot();
    const withInactive = makeSnapshot({
      domains: [
        ...base.domains,
        {
          id: 'dom-3',
          name: 'Retired Domain',
          description: 'No longer used',
          key_signal: null,
          display_order: 3,
          is_active: false,
          colour: '#999999',
          provenance: 'manual',
        },
      ],
    });

    expect(computeTaxonomyHash(base)).toBe(computeTaxonomyHash(withInactive));
  });

  it('excludes inactive subtopics from the hash', () => {
    const base = makeSnapshot();
    const withInactive = makeSnapshot({
      subtopics: [
        ...base.subtopics,
        {
          id: 'sub-3',
          domain_id: 'dom-2',
          name: 'Retired Subtopic',
          description: 'No longer used',
          display_order: 3,
          is_active: false,
          provenance: 'manual',
        },
      ],
    });

    expect(computeTaxonomyHash(base)).toBe(computeTaxonomyHash(withInactive));
  });

  it('produces different hash when key_signal changes', () => {
    const base = makeSnapshot();
    const altered = makeSnapshot({
      domains: base.domains.map((d, i) =>
        i === 0 ? { ...d, key_signal: 'Completely new signal' } : d,
      ),
    });

    expect(computeTaxonomyHash(base)).not.toBe(computeTaxonomyHash(altered));
  });

  it('produces different hash when subtopic description changes', () => {
    const base = makeSnapshot();
    const altered = makeSnapshot({
      subtopics: base.subtopics.map((s, i) =>
        i === 0 ? { ...s, description: 'Updated description' } : s,
      ),
    });

    expect(computeTaxonomyHash(base)).not.toBe(computeTaxonomyHash(altered));
  });
});

// ---------------------------------------------------------------------------
// enqueueTaxonomySync — debounce behaviour
// ---------------------------------------------------------------------------

describe('enqueueTaxonomySync', () => {
  let fetchMock: Mock<(...args: unknown[]) => Promise<unknown>>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({ ok: true });
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('called 5 times within 2 s results in exactly 1 fetch call', async () => {
    // Simulate 5 rapid mutations 200 ms apart
    for (let i = 0; i < 5; i++) {
      enqueueTaxonomySync();
      await vi.advanceTimersByTimeAsync(200);
    }

    // Advance past the 2 s debounce window from the last call
    await vi.advanceTimersByTimeAsync(2_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/taxonomy-sync', {
      method: 'POST',
      headers: { 'x-internal-trigger': 'taxonomy-mutation' },
    });
  });

  it('called 3 times with >2 s gaps results in 3 fetch calls', async () => {
    // Call 1
    enqueueTaxonomySync();
    await vi.advanceTimersByTimeAsync(2_100);

    // Call 2
    enqueueTaxonomySync();
    await vi.advanceTimersByTimeAsync(2_100);

    // Call 3
    enqueueTaxonomySync();
    await vi.advanceTimersByTimeAsync(2_100);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('resets the timer on each call (trailing edge)', async () => {
    enqueueTaxonomySync();
    await vi.advanceTimersByTimeAsync(1_500);

    // 1.5 s in — reset the timer
    enqueueTaxonomySync();
    await vi.advanceTimersByTimeAsync(1_500);

    // 3 s total, but only 1.5 s since last call — not fired yet
    expect(fetchMock).toHaveBeenCalledTimes(0);

    // Advance past the 2 s window from the second call
    await vi.advanceTimersByTimeAsync(600);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('swallows fetch errors without throwing', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network failure'));

    enqueueTaxonomySync();
    await vi.advanceTimersByTimeAsync(2_100);

    // The error is swallowed — no unhandled rejection
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
