/**
 * Provenance tab-ids guard test
 *
 * Ensures the canonical tab list remains structurally correct. Any change to
 * the tab list must be reflected in the provenance-content component and tests.
 */
import { describe, it, expect } from 'vitest';
import { PROVENANCE_TABS } from '@/components/provenance/tab-ids';

describe('PROVENANCE_TABS', () => {
  it('has exactly 5 entries', () => {
    expect(PROVENANCE_TABS).toHaveLength(5);
  });

  it('has no duplicate IDs', () => {
    const ids = PROVENANCE_TABS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has exactly one default tab', () => {
    const defaults = PROVENANCE_TABS.filter((t) => t.default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe('per-item');
  });

  it('marks cost and disputes as stubs', () => {
    const stubs = PROVENANCE_TABS.filter(
      (t) => 'stub' in t && t.stub === true,
    );
    const stubIds = stubs.map((t) => t.id);
    expect(stubIds).toEqual(expect.arrayContaining(['cost', 'disputes']));
    expect(stubs).toHaveLength(2);
  });
});
