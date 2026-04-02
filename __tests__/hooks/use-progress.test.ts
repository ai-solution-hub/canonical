import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockToast, mockUseReadMarks, mockSelect } = vi.hoisted(() => {
  const mockSelect = vi.fn();

  return {
    mockToast: Object.assign(vi.fn(), {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    }),
    mockUseReadMarks: {
      readCount: 0,
      totalCount: 0,
      isLoaded: false,
      loadReadMarks: vi.fn(),
    },
    mockSelect,
  };
});

vi.mock('sonner', () => ({ toast: mockToast }));

vi.mock('@/contexts/read-marks-context', () => ({
  useReadMarks: () => mockUseReadMarks,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: mockSelect,
    }),
  }),
}));

import { useProgress } from '@/hooks/use-progress';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

/** Create a Supabase-like chainable query that resolves to read_marks data */
function setupReadMarksQuery(dates: string[]) {
  const data = dates.map((d) => ({ read_at: d }));
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockResolvedValue({ data, error: null });
  mockSelect.mockReturnValue(chain);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseReadMarks.readCount = 0;
    mockUseReadMarks.totalCount = 0;
    mockUseReadMarks.isLoaded = false;
    mockUseReadMarks.loadReadMarks = vi.fn();

    // Default: no read marks
    setupReadMarksQuery([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------

  it('returns zero values when not loaded', () => {
    const { result } = renderHook(() => useProgress(), {
      wrapper: createWrapper(),
    });

    expect(result.current.readCount).toBe(0);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.percentage).toBe(0);
    expect(result.current.isLoaded).toBe(false);
  });

  it('calls loadReadMarks on mount', () => {
    renderHook(() => useProgress(), {
      wrapper: createWrapper(),
    });
    expect(mockUseReadMarks.loadReadMarks).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Percentage calculation
  // -----------------------------------------------------------------------

  it('calculates percentage correctly', async () => {
    mockUseReadMarks.readCount = 25;
    mockUseReadMarks.totalCount = 100;
    mockUseReadMarks.isLoaded = true;

    const { result } = renderHook(() => useProgress(), {
      wrapper: createWrapper(),
    });

    expect(result.current.percentage).toBe(25);
    expect(result.current.unreadCount).toBe(75);
  });

  it('returns 0 percentage when totalCount is 0', () => {
    mockUseReadMarks.readCount = 0;
    mockUseReadMarks.totalCount = 0;
    mockUseReadMarks.isLoaded = true;

    const { result } = renderHook(() => useProgress(), {
      wrapper: createWrapper(),
    });
    expect(result.current.percentage).toBe(0);
  });

  it('rounds percentage to nearest integer', () => {
    mockUseReadMarks.readCount = 1;
    mockUseReadMarks.totalCount = 3;
    mockUseReadMarks.isLoaded = true;

    const { result } = renderHook(() => useProgress(), {
      wrapper: createWrapper(),
    });
    expect(result.current.percentage).toBe(33); // 33.33... rounds to 33
  });

  // -----------------------------------------------------------------------
  // Streak calculation
  // -----------------------------------------------------------------------

  it('calculates a streak of consecutive days', async () => {
    mockUseReadMarks.readCount = 5;
    mockUseReadMarks.totalCount = 10;
    mockUseReadMarks.isLoaded = true;

    // Today + yesterday + day before = 3-day streak
    setupReadMarksQuery([
      daysAgo(0), // today
      daysAgo(1), // yesterday
      daysAgo(2), // 2 days ago
    ]);

    const { result } = renderHook(() => useProgress(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.streak).toBe(3);
    });
  });

  it('sets streak to 0 when most recent read is older than yesterday', async () => {
    mockUseReadMarks.readCount = 5;
    mockUseReadMarks.totalCount = 10;
    mockUseReadMarks.isLoaded = true;

    // Most recent read was 3 days ago — streak is broken
    setupReadMarksQuery([daysAgo(3), daysAgo(4)]);

    const { result } = renderHook(() => useProgress(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.streak).toBe(0);
    });
  });

  it('counts streak starting from yesterday', async () => {
    mockUseReadMarks.readCount = 5;
    mockUseReadMarks.totalCount = 10;
    mockUseReadMarks.isLoaded = true;

    // Yesterday + day before = 2-day streak (no read today)
    setupReadMarksQuery([daysAgo(1), daysAgo(2)]);

    const { result } = renderHook(() => useProgress(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.streak).toBe(2);
    });
  });

  it('sets streak to 0 when no read marks exist', async () => {
    mockUseReadMarks.readCount = 0;
    mockUseReadMarks.totalCount = 10;
    mockUseReadMarks.isLoaded = true;

    setupReadMarksQuery([]);

    const { result } = renderHook(() => useProgress(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.streak).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Milestone celebration toasts
  // -----------------------------------------------------------------------

  it('shows toast when reaching 10 items', async () => {
    mockUseReadMarks.readCount = 10;
    mockUseReadMarks.totalCount = 100;
    mockUseReadMarks.isLoaded = true;

    renderHook(() => useProgress(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        '10 items reviewed! Keep going!',
        { duration: 4000 },
      );
    });
  });

  it('shows toast for milestone 25', async () => {
    mockUseReadMarks.readCount = 25;
    mockUseReadMarks.totalCount = 100;
    mockUseReadMarks.isLoaded = true;

    renderHook(() => useProgress(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        '25 items reviewed! Keep going!',
        { duration: 4000 },
      );
    });
  });

  it('shows all-items-reviewed toast when readCount equals totalCount', async () => {
    mockUseReadMarks.readCount = 50;
    mockUseReadMarks.totalCount = 50;
    mockUseReadMarks.isLoaded = true;

    renderHook(() => useProgress(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        'All items reviewed! Incredible work!',
        { duration: 5000 },
      );
    });
  });

  it('does not show toast when readCount is 0', async () => {
    mockUseReadMarks.readCount = 0;
    mockUseReadMarks.totalCount = 100;
    mockUseReadMarks.isLoaded = true;

    renderHook(() => useProgress(), {
      wrapper: createWrapper(),
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('does not show milestone toast twice for the same milestone', async () => {
    mockUseReadMarks.readCount = 10;
    mockUseReadMarks.totalCount = 100;
    mockUseReadMarks.isLoaded = true;

    const { rerender } = renderHook(() => useProgress(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledTimes(1);
    });

    // Re-render with same readCount — should not toast again
    rerender();

    await new Promise((r) => setTimeout(r, 50));
    expect(mockToast.success).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Items this week
  // -----------------------------------------------------------------------

  it('counts items read this week', async () => {
    mockUseReadMarks.readCount = 3;
    mockUseReadMarks.totalCount = 10;
    mockUseReadMarks.isLoaded = true;

    // All items read today — should count as this week
    setupReadMarksQuery([daysAgo(0), daysAgo(0), daysAgo(0)]);

    const { result } = renderHook(() => useProgress(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.itemsThisWeek).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it('handles Supabase query error gracefully', async () => {
    mockUseReadMarks.readCount = 5;
    mockUseReadMarks.totalCount = 10;
    mockUseReadMarks.isLoaded = true;

    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.gte = vi.fn().mockReturnValue(chain);
    chain.order = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'DB error' } });
    mockSelect.mockReturnValue(chain);

    const { result } = renderHook(() => useProgress(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.streak).toBe(0);
      expect(result.current.itemsThisWeek).toBe(0);
    });
  });
});
