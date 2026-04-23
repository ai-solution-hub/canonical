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
});
