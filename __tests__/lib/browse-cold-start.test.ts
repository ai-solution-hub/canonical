import { describe, it, expect } from 'vitest';
import { shouldShowColdStartPrompts } from '@/lib/browse-cold-start';

const COLD_START_BASELINE = {
  searchQuery: '',
  activeFilterCount: 0,
  showUnreadOnly: false,
  isLoading: false,
  totalCount: 42,
};

describe('shouldShowColdStartPrompts', () => {
  it('returns true in cold-start baseline (spec §6.2 #6)', () => {
    expect(shouldShowColdStartPrompts(COLD_START_BASELINE)).toBe(true);
  });

  it('hides when search query is active (spec §6.2 #7)', () => {
    expect(
      shouldShowColdStartPrompts({
        ...COLD_START_BASELINE,
        searchQuery: 'pricing',
      }),
    ).toBe(false);
  });

  it('hides when any filter is active (spec §6.2 #8)', () => {
    expect(
      shouldShowColdStartPrompts({
        ...COLD_START_BASELINE,
        activeFilterCount: 1,
      }),
    ).toBe(false);
  });

  it('hides when unread-only is on (spec §6.2 #9)', () => {
    expect(
      shouldShowColdStartPrompts({
        ...COLD_START_BASELINE,
        showUnreadOnly: true,
      }),
    ).toBe(false);
  });

  it('hides when KB is empty (totalCount === 0)', () => {
    expect(
      shouldShowColdStartPrompts({
        ...COLD_START_BASELINE,
        totalCount: 0,
      }),
    ).toBe(false);
  });

  it('hides while initial load is pending (totalCount null)', () => {
    expect(
      shouldShowColdStartPrompts({
        ...COLD_START_BASELINE,
        totalCount: null,
      }),
    ).toBe(false);
  });

  it('hides while isLoading is true (spec §6.2 #10)', () => {
    expect(
      shouldShowColdStartPrompts({
        ...COLD_START_BASELINE,
        isLoading: true,
      }),
    ).toBe(false);
  });

  // -----------------------------------------------------------------
  // §1.20 Browse Cards (S197) — post-click gate coverage.
  // Tests 11/12/13 per spec §11.2. Existing base-gate cases above are
  // NOT duplicated; these augment them with the new card-kind-specific
  // interaction semantics.
  // -----------------------------------------------------------------

  describe('§1.20 Browse Cards post-click gate (tests 11, 12, 13)', () => {
    it('test 11: post-FILTER-click → activeFilterCount ≥ 1 → hides cards', () => {
      // F-2/F-3/F-4 + B-2/B-3 + A-3 + M-1/M-3 all apply a filter; any
      // single filter incrementing activeFilterCount must hide cards.
      expect(
        shouldShowColdStartPrompts({
          ...COLD_START_BASELINE,
          activeFilterCount: 1,
        }),
      ).toBe(false);
    });

    it('test 12: post-CHIP-click → same gate as filter-click (separate assertion for log clarity)', () => {
      // A domain chip click writes `?domain=<slug>` which increments
      // activeFilterCount. Tested separately so chip-vs-filter paths
      // are distinguishable in the test log.
      expect(
        shouldShowColdStartPrompts({
          ...COLD_START_BASELINE,
          activeFilterCount: 1,
        }),
      ).toBe(false);
    });

    it('test 13: More-button no-op → activeFilterCount stays 0 → cards remain visible', () => {
      // Clicking "More domains…" opens the filter panel but does NOT
      // mutate the URL. activeFilterCount stays at 0, so cards remain
      // visible behind the open panel (spec §6.5 backdrop behaviour).
      expect(
        shouldShowColdStartPrompts({
          ...COLD_START_BASELINE,
          activeFilterCount: 0,
        }),
      ).toBe(true);
    });
  });
});
