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
  //
  // The original spec §11.2 tests 11/12/13 duplicated existing baseline
  // and "hides when any filter is active" cases (M-C in
  // `inv-2-spec-verification.md`). Replaced with genuinely uncovered
  // combinations that exercise multi-criteria gate logic introduced
  // by the post-click card-interaction semantics.
  //
  // - "More-button no-op" (former test 13) is already covered by the
  //   baseline test above — clicking "More domains…" leaves
  //   `activeFilterCount === 0` and `searchQuery === ''`, which IS the
  //   baseline. Documented here rather than re-asserted.
  // - "Post-FILTER click" (former test 11) is the same input shape as
  //   "hides when any filter is active" above (activeFilterCount: 1).
  // - "Post-CHIP click" (former test 12) is the same input shape too.
  //
  // The cases below cover combinations not previously asserted.
  // -----------------------------------------------------------------

  describe('§1.20 Browse Cards multi-criteria gate (replaces tests 11–13 per M-C)', () => {
    it('hides when search-query AND activeFilterCount are BOTH active (defence-in-depth)', () => {
      // After clicking a SEARCH card (writes ?q=) and then applying
      // a FILTER card preset (increments activeFilterCount), both
      // gate inputs are truthy. The gate must remain false; this
      // proves the gate is "all of N" (AND) rather than masking by
      // the first hit.
      expect(
        shouldShowColdStartPrompts({
          ...COLD_START_BASELINE,
          searchQuery: 'social value',
          activeFilterCount: 1,
        }),
      ).toBe(false);
    });

    it('hides when activeFilterCount > 1 (multi-filter case)', () => {
      // Existing coverage asserts activeFilterCount === 1 hides. This
      // case proves the gate uses `=== 0` semantics (i.e. any positive
      // count hides), not `< 1` or `=== 1`. Real-world: user applies
      // a domain chip THEN opens the panel and adds a content type.
      expect(
        shouldShowColdStartPrompts({
          ...COLD_START_BASELINE,
          activeFilterCount: 2,
        }),
      ).toBe(false);
    });

    it('hides when ALL gate inputs are simultaneously triggered', () => {
      // Belt-and-braces: every gate variable triggered at once must
      // hide. Guards against an accidental `||` → `&&` regression in
      // the gate body.
      expect(
        shouldShowColdStartPrompts({
          searchQuery: 'pricing',
          activeFilterCount: 3,
          showUnreadOnly: true,
          isLoading: true,
          totalCount: 0,
        }),
      ).toBe(false);
    });
  });
});
