import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFilterDraft } from '@/hooks/browse/use-filter-draft';
import type { BrowseFilters } from '@/types/content';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const emptyFilters: BrowseFilters = {
  sort: 'captured_date',
  order: 'desc',
  page: 1,
} as BrowseFilters & { page: number };

function defaultParams(
  overrides: Partial<Parameters<typeof useFilterDraft>[0]> = {},
) {
  return {
    filters: emptyFilters,
    setFilters: vi.fn(),
    clearFilters: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFilterDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Initial state ----

  describe('initial state', () => {
    it('initialises draft from provided filters', () => {
      const filters: BrowseFilters = {
        domain: ['Technical'],
        subtopic: 'APIs',
        content_type: ['article'],
        platform: ['web'],
        author: ['Alice'],
        date_from: '2026-01-01',
        date_to: '2026-02-01',
        keywords: ['testing', 'hooks'],
        starred: true,
        priority: ['high'],
        workspace: 'ws-1',
        user_tags: ['important'],
        freshness: ['fresh'],
        layer: 'executive',
        quality_issues: true,
        include_drafts: true,
        include_qa: true,
      };
      const { result } = renderHook(() =>
        useFilterDraft(defaultParams({ filters })),
      );

      expect(result.current.draft.domains).toEqual(['Technical']);
      expect(result.current.draft.subtopic).toBe('APIs');
      expect(result.current.draft.content_types).toEqual(['article']);
      expect(result.current.draft.platforms).toEqual(['web']);
      expect(result.current.draft.authors).toEqual(['Alice']);
      expect(result.current.draft.date_from).toBe('2026-01-01');
      expect(result.current.draft.date_to).toBe('2026-02-01');
      expect(result.current.draft.keywords).toBe('testing, hooks');
      expect(result.current.draft.starred).toBe(true);
      expect(result.current.draft.priorities).toEqual(['high']);
      expect(result.current.draft.workspace).toBe('ws-1');
      expect(result.current.draft.user_tags).toEqual(['important']);
      expect(result.current.draft.freshness).toEqual(['fresh']);
      expect(result.current.draft.layer).toBe('executive');
      expect(result.current.draft.quality_issues).toBe(true);
      expect(result.current.draft.include_drafts).toBe(true);
      expect(result.current.draft.include_qa).toBe(true);
    });

    it('returns draftFilterCount of 0 when no filters are active', () => {
      const { result } = renderHook(() => useFilterDraft(defaultParams()));

      expect(result.current.draftFilterCount).toBe(0);
    });

    it('syncs draft when filters prop changes externally', () => {
      const params = defaultParams();
      const { result, rerender } = renderHook(
        (props) => useFilterDraft(props),
        { initialProps: params },
      );

      expect(result.current.draft.domains).toEqual([]);

      // Simulate external filter change (e.g. badge removal)
      const updatedParams = defaultParams({
        filters: { ...emptyFilters, domain: ['Commercial'] },
      });
      rerender(updatedParams);

      expect(result.current.draft.domains).toEqual(['Commercial']);
    });
  });

  // ---- Domain toggles ----

  describe('handleDomainToggle', () => {
    it('adds a domain when not already selected', () => {
      const { result } = renderHook(() => useFilterDraft(defaultParams()));

      act(() => {
        result.current.handleDomainToggle('Technical');
      });

      expect(result.current.draft.domains).toEqual(['Technical']);
    });

    it('removes a domain when already selected', () => {
      const filters: BrowseFilters = { ...emptyFilters, domain: ['Technical'] };
      const { result } = renderHook(() =>
        useFilterDraft(defaultParams({ filters })),
      );

      act(() => {
        result.current.handleDomainToggle('Technical');
      });

      expect(result.current.draft.domains).toEqual([]);
    });

    it('clears subtopic when multiple domains are selected', () => {
      const filters: BrowseFilters = {
        ...emptyFilters,
        domain: ['Technical'],
        subtopic: 'APIs',
      };
      const { result } = renderHook(() =>
        useFilterDraft(defaultParams({ filters })),
      );

      // Adding a second domain should clear subtopic
      act(() => {
        result.current.handleDomainToggle('Commercial');
      });

      expect(result.current.draft.domains).toEqual(['Technical', 'Commercial']);
      expect(result.current.draft.subtopic).toBe('');
    });

    it('preserves subtopic when exactly one domain remains', () => {
      const filters: BrowseFilters = {
        ...emptyFilters,
        domain: ['Technical', 'Commercial'],
        subtopic: '',
      };
      const { result } = renderHook(() =>
        useFilterDraft(defaultParams({ filters })),
      );

      // Removing one domain, leaving exactly one — subtopic is preserved (remains empty here)
      act(() => {
        result.current.handleDomainToggle('Commercial');
      });

      expect(result.current.draft.domains).toEqual(['Technical']);
      // Subtopic was already empty, so stays empty — but it is NOT forcibly cleared
      expect(result.current.draft.subtopic).toBe('');
    });
  });

  // ---- Subtopic ----

  describe('handleSubtopicToggle', () => {
    it('sets subtopic when toggling a new value', () => {
      const { result } = renderHook(() => useFilterDraft(defaultParams()));

      act(() => {
        result.current.handleSubtopicToggle('APIs');
      });

      expect(result.current.draft.subtopic).toBe('APIs');
    });

    it('clears subtopic when toggling the same value', () => {
      const filters: BrowseFilters = { ...emptyFilters, subtopic: 'APIs' };
      const { result } = renderHook(() =>
        useFilterDraft(defaultParams({ filters })),
      );

      act(() => {
        result.current.handleSubtopicToggle('APIs');
      });

      expect(result.current.draft.subtopic).toBe('');
    });
  });

  // ---- Content type ----

  describe('handleContentTypeToggle', () => {
    it('adds a content type when not selected', () => {
      const { result } = renderHook(() => useFilterDraft(defaultParams()));

      act(() => {
        result.current.handleContentTypeToggle('article');
      });

      expect(result.current.draft.content_types).toEqual(['article']);
    });

    it('removes a content type when already selected', () => {
      const filters: BrowseFilters = {
        ...emptyFilters,
        content_type: ['article', 'blog'],
      };
      const { result } = renderHook(() =>
        useFilterDraft(defaultParams({ filters })),
      );

      act(() => {
        result.current.handleContentTypeToggle('article');
      });

      expect(result.current.draft.content_types).toEqual(['blog']);
    });
  });

  // ---- Platform ----

  describe('handlePlatformToggle', () => {
    it('toggles a platform on and off', () => {
      const { result } = renderHook(() => useFilterDraft(defaultParams()));

      act(() => {
        result.current.handlePlatformToggle('web');
      });
      expect(result.current.draft.platforms).toEqual(['web']);

      act(() => {
        result.current.handlePlatformToggle('web');
      });
      expect(result.current.draft.platforms).toEqual([]);
    });
  });

  // ---- Priority ----

  describe('handlePriorityToggle', () => {
    it('toggles a priority on and off', () => {
      const { result } = renderHook(() => useFilterDraft(defaultParams()));

      act(() => {
        result.current.handlePriorityToggle('high');
      });
      expect(result.current.draft.priorities).toEqual(['high']);

      act(() => {
        result.current.handlePriorityToggle('high');
      });
      expect(result.current.draft.priorities).toEqual([]);
    });
  });

  // ---- Freshness ----

  describe('handleFreshnessToggle', () => {
    it('toggles a freshness state on and off', () => {
      const { result } = renderHook(() => useFilterDraft(defaultParams()));

      act(() => {
        result.current.handleFreshnessToggle('stale');
      });
      expect(result.current.draft.freshness).toEqual(['stale']);

      act(() => {
        result.current.handleFreshnessToggle('stale');
      });
      expect(result.current.draft.freshness).toEqual([]);
    });
  });

  // ---- User tags ----

  describe('handleUserTagToggle', () => {
    it('toggles a user tag on and off', () => {
      const { result } = renderHook(() => useFilterDraft(defaultParams()));

      act(() => {
        result.current.handleUserTagToggle('important');
      });
      expect(result.current.draft.user_tags).toEqual(['important']);

      act(() => {
        result.current.handleUserTagToggle('important');
      });
      expect(result.current.draft.user_tags).toEqual([]);
    });
  });

  // ---- Layer ----

  describe('handleLayerToggle', () => {
    it('toggles a layer on and off', () => {
      const { result } = renderHook(() => useFilterDraft(defaultParams()));

      act(() => {
        result.current.handleLayerToggle('executive');
      });
      expect(result.current.draft.layer).toBe('executive');

      act(() => {
        result.current.handleLayerToggle('executive');
      });
      expect(result.current.draft.layer).toBe('');
    });

    it('switches layer when toggling a different value', () => {
      const filters: BrowseFilters = { ...emptyFilters, layer: 'executive' };
      const { result } = renderHook(() =>
        useFilterDraft(defaultParams({ filters })),
      );

      act(() => {
        result.current.handleLayerToggle('technical');
      });

      expect(result.current.draft.layer).toBe('technical');
    });
  });

  // ---- Authors ----

  describe('handleAddAuthor / handleRemoveAuthor', () => {
    it('adds an author to the draft', () => {
      const { result } = renderHook(() => useFilterDraft(defaultParams()));

      act(() => {
        result.current.handleAddAuthor('Alice');
      });

      expect(result.current.draft.authors).toEqual(['Alice']);
    });

    it('removes an author from the draft', () => {
      const filters: BrowseFilters = {
        ...emptyFilters,
        author: ['Alice', 'Bob'],
      };
      const { result } = renderHook(() =>
        useFilterDraft(defaultParams({ filters })),
      );

      act(() => {
        result.current.handleRemoveAuthor('Alice');
      });

      expect(result.current.draft.authors).toEqual(['Bob']);
    });
  });

  // ---- Workspace ----

  describe('handleWorkspaceChange', () => {
    it('sets workspace when toggling a new value', () => {
      const { result } = renderHook(() => useFilterDraft(defaultParams()));

      act(() => {
        result.current.handleWorkspaceChange('ws-1');
      });

      expect(result.current.draft.workspace).toBe('ws-1');
    });

    it('clears workspace when toggling the same value', () => {
      const filters: BrowseFilters = { ...emptyFilters, workspace: 'ws-1' };
      const { result } = renderHook(() =>
        useFilterDraft(defaultParams({ filters })),
      );

      act(() => {
        result.current.handleWorkspaceChange('ws-1');
      });

      expect(result.current.draft.workspace).toBe('');
    });
  });

  // ---- Apply ----

  describe('handleApply', () => {
    it('applies the draft values and closes the panel', () => {
      const setFilters = vi.fn();
      const onClose = vi.fn();
      const filters: BrowseFilters = {
        ...emptyFilters,
        domain: ['Technical'],
        starred: true,
      };
      const { result } = renderHook(() =>
        useFilterDraft(defaultParams({ filters, setFilters, onClose })),
      );

      act(() => {
        result.current.handleApply();
      });

      expect(setFilters).toHaveBeenCalledTimes(1);
      const appliedFilters = setFilters.mock.calls[0][0];
      expect(appliedFilters.domain).toEqual(['Technical']);
      expect(appliedFilters.starred).toBe(true);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('parses keywords from comma-separated string', () => {
      const setFilters = vi.fn();
      const { result } = renderHook(() =>
        useFilterDraft(defaultParams({ setFilters })),
      );

      // Manually set keywords via setDraft
      act(() => {
        result.current.setDraft((prev) => ({
          ...prev,
          keywords: 'react, hooks, testing',
        }));
      });

      act(() => {
        result.current.handleApply();
      });

      const appliedFilters = setFilters.mock.calls[0][0];
      expect(appliedFilters.keywords).toEqual(['react', 'hooks', 'testing']);
    });

    it('deduplicates keywords', () => {
      const setFilters = vi.fn();
      const { result } = renderHook(() =>
        useFilterDraft(defaultParams({ setFilters })),
      );

      act(() => {
        result.current.setDraft((prev) => ({
          ...prev,
          keywords: 'react, hooks, react',
        }));
      });

      act(() => {
        result.current.handleApply();
      });

      const appliedFilters = setFilters.mock.calls[0][0];
      expect(appliedFilters.keywords).toEqual(['react', 'hooks']);
    });

    it('sets empty arrays to undefined when applying', () => {
      const setFilters = vi.fn();
      const { result } = renderHook(() =>
        useFilterDraft(defaultParams({ setFilters })),
      );

      act(() => {
        result.current.handleApply();
      });

      const appliedFilters = setFilters.mock.calls[0][0];
      expect(appliedFilters.domain).toBeUndefined();
      expect(appliedFilters.content_type).toBeUndefined();
      expect(appliedFilters.platform).toBeUndefined();
      expect(appliedFilters.author).toBeUndefined();
      expect(appliedFilters.priority).toBeUndefined();
      expect(appliedFilters.user_tags).toBeUndefined();
      expect(appliedFilters.freshness).toBeUndefined();
      expect(appliedFilters.keywords).toBeUndefined();
      expect(appliedFilters.subtopic).toBeUndefined();
      expect(appliedFilters.workspace).toBeUndefined();
      expect(appliedFilters.layer).toBeUndefined();
      expect(appliedFilters.starred).toBeUndefined();
      expect(appliedFilters.quality_issues).toBeUndefined();
      expect(appliedFilters.include_drafts).toBeUndefined();
      expect(appliedFilters.include_qa).toBeUndefined();
    });
  });

  // ---- Clear all ----

  describe('handleClearAll', () => {
    it('resets all draft fields, clears filters, and closes the panel', () => {
      const clearFilters = vi.fn();
      const onClose = vi.fn();
      const filters: BrowseFilters = {
        ...emptyFilters,
        domain: ['Technical'],
        content_type: ['article'],
        starred: true,
      };
      const { result } = renderHook(() =>
        useFilterDraft(defaultParams({ filters, clearFilters, onClose })),
      );

      expect(result.current.draft.domains).toEqual(['Technical']);

      act(() => {
        result.current.handleClearAll();
      });

      expect(result.current.draft.domains).toEqual([]);
      expect(result.current.draft.content_types).toEqual([]);
      expect(result.current.draft.starred).toBe(false);
      expect(result.current.draft.subtopic).toBe('');
      expect(result.current.draft.keywords).toBe('');
      expect(result.current.draft.platforms).toEqual([]);
      expect(result.current.draft.authors).toEqual([]);
      expect(result.current.draft.priorities).toEqual([]);
      expect(result.current.draft.freshness).toEqual([]);
      expect(result.current.draft.user_tags).toEqual([]);
      expect(result.current.draft.layer).toBe('');
      expect(result.current.draft.workspace).toBe('');
      expect(result.current.draft.quality_issues).toBe(false);
      expect(result.current.draft.include_drafts).toBe(false);
      expect(result.current.draft.include_qa).toBe(false);
      expect(clearFilters).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('clears the author search field when the callback is provided', () => {
      const onClearAuthorSearch = vi.fn();
      const { result } = renderHook(() =>
        useFilterDraft(defaultParams({ onClearAuthorSearch })),
      );

      act(() => {
        result.current.handleClearAll();
      });

      expect(onClearAuthorSearch).toHaveBeenCalledTimes(1);
    });

    it('does not fail when onClearAuthorSearch is not provided', () => {
      const { result } = renderHook(() => useFilterDraft(defaultParams()));

      // Should not throw
      act(() => {
        result.current.handleClearAll();
      });

      expect(result.current.draft.domains).toEqual([]);
    });
  });

  // ---- Filter count ----

  describe('draftFilterCount', () => {
    it('counts active filters correctly', () => {
      const filters: BrowseFilters = {
        ...emptyFilters,
        domain: ['Technical'], // 1
        subtopic: 'APIs', // 2
        content_type: ['article'], // 3
        platform: ['web'], // 4
        author: ['Alice'], // 5
        date_from: '2026-01-01', // 6 (date_from || date_to counts as 1)
        keywords: ['react'], // 7
        starred: true, // 8
        priority: ['high'], // 9
        workspace: 'ws-1', // 10
        user_tags: ['tag1'], // 11
        freshness: ['fresh'], // 12
        layer: 'executive', // 13
        quality_issues: true, // 14
        include_drafts: true, // 15
        include_qa: true, // 16
      };
      const { result } = renderHook(() =>
        useFilterDraft(defaultParams({ filters })),
      );

      expect(result.current.draftFilterCount).toBe(16);
    });

    it('counts date range as a single filter whether date_from or date_to or both', () => {
      const filtersFrom: BrowseFilters = {
        ...emptyFilters,
        date_from: '2026-01-01',
      };
      const filtersTo: BrowseFilters = {
        ...emptyFilters,
        date_to: '2026-02-01',
      };
      const filtersBoth: BrowseFilters = {
        ...emptyFilters,
        date_from: '2026-01-01',
        date_to: '2026-02-01',
      };

      const { result: r1 } = renderHook(() =>
        useFilterDraft(defaultParams({ filters: filtersFrom })),
      );
      const { result: r2 } = renderHook(() =>
        useFilterDraft(defaultParams({ filters: filtersTo })),
      );
      const { result: r3 } = renderHook(() =>
        useFilterDraft(defaultParams({ filters: filtersBoth })),
      );

      expect(r1.current.draftFilterCount).toBe(1);
      expect(r2.current.draftFilterCount).toBe(1);
      expect(r3.current.draftFilterCount).toBe(1);
    });

    it('updates count when draft changes via toggle', () => {
      const { result } = renderHook(() => useFilterDraft(defaultParams()));

      expect(result.current.draftFilterCount).toBe(0);

      act(() => {
        result.current.handleDomainToggle('Technical');
      });
      expect(result.current.draftFilterCount).toBe(1);

      act(() => {
        result.current.handlePriorityToggle('high');
      });
      expect(result.current.draftFilterCount).toBe(2);

      act(() => {
        result.current.handleDomainToggle('Technical');
      });
      expect(result.current.draftFilterCount).toBe(1);
    });
  });
});
