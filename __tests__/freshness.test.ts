import { describe, it, expect } from 'vitest';
import { calculateFreshness, batchCalculateFreshness } from '@/lib/freshness';

// Fixed reference date for deterministic tests: 1 March 2026
const NOW = new Date('2026-03-01T12:00:00Z');

describe('calculateFreshness', () => {
  describe('evergreen lifecycle', () => {
    it('returns fresh for content updated less than 12 months ago', () => {
      expect(
        calculateFreshness(
          {
            lifecycle_type: 'evergreen',
            updated_at: '2025-06-01T00:00:00Z', // ~9 months ago
            expiry_date: null,
          },
          NOW,
        ),
      ).toBe('fresh');
    });

    it('returns aging for content updated 12-18 months ago', () => {
      expect(
        calculateFreshness(
          {
            lifecycle_type: 'evergreen',
            updated_at: '2025-01-01T00:00:00Z', // ~14 months ago
            expiry_date: null,
          },
          NOW,
        ),
      ).toBe('aging');
    });

    it('returns stale for content updated 18-24 months ago', () => {
      expect(
        calculateFreshness(
          {
            lifecycle_type: 'evergreen',
            updated_at: '2024-06-01T00:00:00Z', // ~21 months ago
            expiry_date: null,
          },
          NOW,
        ),
      ).toBe('stale');
    });

    it('returns expired for content updated more than 24 months ago', () => {
      expect(
        calculateFreshness(
          {
            lifecycle_type: 'evergreen',
            updated_at: '2023-06-01T00:00:00Z', // ~33 months ago
            expiry_date: null,
          },
          NOW,
        ),
      ).toBe('expired');
    });
  });

  describe('date_bound lifecycle', () => {
    it('returns fresh when expiry is more than 3 months away', () => {
      expect(
        calculateFreshness(
          {
            lifecycle_type: 'date_bound',
            updated_at: null,
            expiry_date: '2026-07-01T00:00:00Z', // 4 months away
          },
          NOW,
        ),
      ).toBe('fresh');
    });

    it('returns aging when expiry is 1-3 months away', () => {
      expect(
        calculateFreshness(
          {
            lifecycle_type: 'date_bound',
            updated_at: null,
            expiry_date: '2026-04-15T00:00:00Z', // ~1.5 months away
          },
          NOW,
        ),
      ).toBe('aging');
    });

    it('returns stale when expiry is less than 1 month away', () => {
      expect(
        calculateFreshness(
          {
            lifecycle_type: 'date_bound',
            updated_at: null,
            expiry_date: '2026-03-20T00:00:00Z', // ~19 days away
          },
          NOW,
        ),
      ).toBe('stale');
    });

    it('returns expired when expiry date has passed', () => {
      expect(
        calculateFreshness(
          {
            lifecycle_type: 'date_bound',
            updated_at: null,
            expiry_date: '2026-02-01T00:00:00Z', // 1 month ago
          },
          NOW,
        ),
      ).toBe('expired');
    });

    it('returns aging when no expiry date is set', () => {
      expect(
        calculateFreshness(
          {
            lifecycle_type: 'date_bound',
            updated_at: null,
            expiry_date: null,
          },
          NOW,
        ),
      ).toBe('aging');
    });
  });

  describe('regulation lifecycle', () => {
    it('returns fresh for content updated less than 6 months ago', () => {
      expect(
        calculateFreshness(
          {
            lifecycle_type: 'regulation',
            updated_at: '2025-12-01T00:00:00Z', // ~3 months ago
            expiry_date: null,
          },
          NOW,
        ),
      ).toBe('fresh');
    });

    it('returns aging for content updated 6-9 months ago', () => {
      expect(
        calculateFreshness(
          {
            lifecycle_type: 'regulation',
            updated_at: '2025-07-01T00:00:00Z', // ~8 months ago
            expiry_date: null,
          },
          NOW,
        ),
      ).toBe('aging');
    });

    it('returns stale for content updated 9-12 months ago', () => {
      expect(
        calculateFreshness(
          {
            lifecycle_type: 'regulation',
            updated_at: '2025-04-01T00:00:00Z', // ~11 months ago
            expiry_date: null,
          },
          NOW,
        ),
      ).toBe('stale');
    });

    it('returns expired for content updated more than 12 months ago', () => {
      expect(
        calculateFreshness(
          {
            lifecycle_type: 'regulation',
            updated_at: '2024-12-01T00:00:00Z', // ~15 months ago
            expiry_date: null,
          },
          NOW,
        ),
      ).toBe('expired');
    });
  });

  describe('bid_discovered lifecycle', () => {
    it('always returns fresh regardless of dates', () => {
      expect(
        calculateFreshness(
          {
            lifecycle_type: 'bid_discovered',
            updated_at: '2020-01-01T00:00:00Z', // very old
            expiry_date: null,
          },
          NOW,
        ),
      ).toBe('fresh');
    });

    it('returns fresh even with null updated_at', () => {
      expect(
        calculateFreshness(
          {
            lifecycle_type: 'bid_discovered',
            updated_at: null,
            expiry_date: null,
          },
          NOW,
        ),
      ).toBe('fresh');
    });
  });

  describe('null/default lifecycle', () => {
    it('uses evergreen rules when lifecycle_type is null', () => {
      expect(
        calculateFreshness(
          {
            lifecycle_type: null,
            updated_at: '2025-06-01T00:00:00Z', // ~9 months ago
            expiry_date: null,
          },
          NOW,
        ),
      ).toBe('fresh');
    });

    it('returns stale when no update date is available', () => {
      expect(
        calculateFreshness(
          {
            lifecycle_type: null,
            updated_at: null,
            expiry_date: null,
          },
          NOW,
        ),
      ).toBe('stale');
    });
  });
});

describe('batchCalculateFreshness', () => {
  it('calculates freshness for multiple items', () => {
    const items = [
      {
        id: 'item-1',
        lifecycle_type: 'evergreen',
        updated_at: '2025-06-01T00:00:00Z',
        expiry_date: null,
      },
      {
        id: 'item-2',
        lifecycle_type: 'bid_discovered',
        updated_at: null,
        expiry_date: null,
      },
      {
        id: 'item-3',
        lifecycle_type: 'regulation',
        updated_at: '2024-12-01T00:00:00Z',
        expiry_date: null,
      },
    ];

    const results = batchCalculateFreshness(items, NOW);
    expect(results.get('item-1')).toBe('fresh');
    expect(results.get('item-2')).toBe('fresh');
    expect(results.get('item-3')).toBe('expired');
    expect(results.size).toBe(3);
  });

  it('returns empty map for empty input', () => {
    const results = batchCalculateFreshness([], NOW);
    expect(results.size).toBe(0);
  });
});
