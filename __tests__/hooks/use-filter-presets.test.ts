import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => currentSearchParams,
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/browse',
}));

// Mock crypto.randomUUID for deterministic IDs in tests
let uuidCounter = 0;
vi.stubGlobal('crypto', {
  ...crypto,
  randomUUID: () => {
    uuidCounter++;
    return `${String(uuidCounter).padStart(8, '0')}-0000-0000-0000-000000000000`;
  },
});

import {
  useFilterPresets,
  normaliseParams,
} from '@/hooks/browse/use-filter-presets';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'kb-filter-presets';

function setStoredPresets(presets: unknown) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFilterPresets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
    localStorage.clear();
    uuidCounter = 0;
  });

  // 1. Returns system presets when localStorage is empty
  it('returns system presets when localStorage is empty', () => {
    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.presets).toHaveLength(4);
    expect(result.current.presets.every((p) => p.isSystem)).toBe(true);
    expect(result.current.presets[0].name).toBe('Stale content');
    expect(result.current.presets[1].name).toBe('Unreviewed items');
    expect(result.current.presets[2].name).toBe('Flagged items');
    expect(result.current.presets[3].name).toBe('My content');
  });

  // 2. Returns system presets + user presets from localStorage
  it('returns system presets + user presets from localStorage', () => {
    setStoredPresets([
      {
        id: 'u_abc123',
        name: 'My custom preset',
        params: 'domain=Corporate',
        isSystem: false,
        createdAt: '2026-03-01T00:00:00.000Z',
      },
    ]);
    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.presets).toHaveLength(5);
    expect(result.current.presets[4].name).toBe('My custom preset');
  });

  // 3. System presets appear before user presets
  it('system presets appear before user presets', () => {
    setStoredPresets([
      {
        id: 'u_abc123',
        name: 'User preset',
        params: 'domain=Corporate',
        isSystem: false,
        createdAt: '2020-01-01T00:00:00.000Z',
      },
    ]);
    const { result } = renderHook(() => useFilterPresets());
    const systemCount = result.current.presets.filter((p) => p.isSystem).length;
    expect(systemCount).toBe(4);
    // All system presets come first
    for (let i = 0; i < 4; i++) {
      expect(result.current.presets[i].isSystem).toBe(true);
    }
    expect(result.current.presets[4].isSystem).toBe(false);
  });

  // 4. applyPreset calls router.push with correct URL
  it('applyPreset calls router.push with correct URL', () => {
    const { result } = renderHook(() => useFilterPresets());
    act(() => {
      result.current.applyPreset('system-stale');
    });
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/browse?'));
    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining('freshness=stale'),
    );
  });

  // 5. applyPreset with unknown ID is a no-op
  it('applyPreset with unknown ID is a no-op', () => {
    const { result } = renderHook(() => useFilterPresets());
    act(() => {
      result.current.applyPreset('nonexistent-id');
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  // 6. savePreset adds to user presets and persists to localStorage
  it('savePreset adds to user presets and persists to localStorage', () => {
    currentSearchParams = new URLSearchParams('domain=Corporate');
    const { result } = renderHook(() => useFilterPresets());
    act(() => {
      result.current.savePreset('My filter');
    });
    expect(result.current.presets).toHaveLength(5);
    expect(result.current.presets[4].name).toBe('My filter');
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('My filter');
  });

  // 7. savePreset generates unique IDs
  it('savePreset generates unique IDs', () => {
    currentSearchParams = new URLSearchParams('domain=Corporate');
    const { result } = renderHook(() => useFilterPresets());
    let id1: string = '';
    let id2: string = '';
    act(() => {
      const p1 = result.current.savePreset('First');
      id1 = p1.id;
    });
    act(() => {
      const p2 = result.current.savePreset('Second');
      id2 = p2.id;
    });
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^u_/);
    expect(id2).toMatch(/^u_/);
  });

  // 8. renamePreset updates name and persists
  it('renamePreset updates name and persists', () => {
    setStoredPresets([
      {
        id: 'u_abc123',
        name: 'Old name',
        params: 'domain=Corporate',
        isSystem: false,
        createdAt: '2026-03-01T00:00:00.000Z',
      },
    ]);
    const { result } = renderHook(() => useFilterPresets());
    act(() => {
      result.current.renamePreset('u_abc123', 'New name');
    });
    expect(result.current.presets[4].name).toBe('New name');
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    expect(stored[0].name).toBe('New name');
  });

  // 9. renamePreset on system preset is a no-op
  it('renamePreset on system preset is a no-op', () => {
    const { result } = renderHook(() => useFilterPresets());
    const originalName = result.current.presets[0].name;
    act(() => {
      result.current.renamePreset('system-stale', 'Hacked');
    });
    expect(result.current.presets[0].name).toBe(originalName);
  });

  // 10. deletePreset removes from array and persists
  it('deletePreset removes from array and persists', () => {
    setStoredPresets([
      {
        id: 'u_abc123',
        name: 'To delete',
        params: 'domain=Corporate',
        isSystem: false,
        createdAt: '2026-03-01T00:00:00.000Z',
      },
    ]);
    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.presets).toHaveLength(5);
    act(() => {
      result.current.deletePreset('u_abc123');
    });
    expect(result.current.presets).toHaveLength(4);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    expect(stored).toHaveLength(0);
  });

  // 11. deletePreset on system preset is a no-op
  it('deletePreset on system preset is a no-op', () => {
    const { result } = renderHook(() => useFilterPresets());
    act(() => {
      result.current.deletePreset('system-stale');
    });
    expect(result.current.presets).toHaveLength(4);
  });

  // 12. activePreset returns matching system preset
  it('activePreset returns matching system preset', () => {
    currentSearchParams = new URLSearchParams('freshness=stale%2Cexpired');
    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.activePreset).not.toBeNull();
    expect(result.current.activePreset?.id).toBe('system-stale');
  });

  // 13. activePreset returns matching user preset
  it('activePreset returns matching user preset', () => {
    setStoredPresets([
      {
        id: 'u_custom1',
        name: 'Corporate filter',
        params: 'domain=Corporate',
        isSystem: false,
        createdAt: '2026-03-01T00:00:00.000Z',
      },
    ]);
    currentSearchParams = new URLSearchParams('domain=Corporate');
    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.activePreset).not.toBeNull();
    expect(result.current.activePreset?.id).toBe('u_custom1');
  });

  // 14. activePreset returns null when no preset matches
  it('activePreset returns null when no preset matches', () => {
    currentSearchParams = new URLSearchParams('domain=Technical&type=article');
    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.activePreset).toBeNull();
  });

  // 15. activePreset matches despite different param ordering
  it('activePreset matches despite different param ordering', () => {
    setStoredPresets([
      {
        id: 'u_order1',
        name: 'Multi filter',
        params: 'domain=Corporate&type=article',
        isSystem: false,
        createdAt: '2026-03-01T00:00:00.000Z',
      },
    ]);
    // URL has params in reverse order
    currentSearchParams = new URLSearchParams('type=article&domain=Corporate');
    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.activePreset).not.toBeNull();
    expect(result.current.activePreset?.id).toBe('u_order1');
  });

  // 16. canSave is true when filters are active
  it('canSave is true when filters are active', () => {
    currentSearchParams = new URLSearchParams('domain=Corporate');
    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.canSave).toBe(true);
  });

  // 17. canSave is false when no filters are active
  it('canSave is false when no filters are active', () => {
    currentSearchParams = new URLSearchParams();
    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.canSave).toBe(false);
  });

  // 18. Handles corrupted localStorage gracefully
  it('handles corrupted localStorage gracefully', () => {
    localStorage.setItem(STORAGE_KEY, 'not valid json!!!');
    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.presets).toHaveLength(4); // Only system presets
  });

  // 19. Handles corrupted localStorage gracefully
  it('handles localStorage with non-array value gracefully', () => {
    localStorage.setItem(STORAGE_KEY, '"just a string"');
    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.presets).toHaveLength(4); // Only system presets
  });

  // 20. normaliseParams strips sort, order, cursor, q
  it('normaliseParams strips sort, order, cursor, q', () => {
    const result = normaliseParams(
      'domain=Corporate&sort=captured_date&order=desc&cursor=abc&q=test',
    );
    expect(result).toBe('domain=Corporate');
    expect(result).not.toContain('sort');
    expect(result).not.toContain('order');
    expect(result).not.toContain('cursor');
    expect(result).not.toContain('q=');
  });
});
