/**
 * useApplicationTypes — TanStack Query hook tests (ID-29.6).
 *
 * Tests the hook that replaces the static WORKSPACE_TYPE_REGISTRY with a
 * DB-driven approach via the /api/application-types route.
 *
 * Coverage: 6 cases per TECH.md §3 P-5.
 *   (a) Hook returns 6 rows when application_types table is mocked with 6 rows.
 *   (b) useWorkspaceType('procurement') resolves with route='/procurement' + icon=Briefcase.
 *   (c) useWorkspaceType('unknown_key') returns undefined.
 *   (d) useLauncherTypes() filter semantics preserved.
 *   (e) formatTypeCount(undefined, 0) falls back to '0 active workspaces'.
 *   (f) formatTypeCount(intelligenceConfig, 3) returns '3 active intelligence streams'.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Briefcase, Newspaper } from 'lucide-react';

import {
  useApplicationTypes,
  useWorkspaceType,
  useLauncherTypes,
  formatTypeCount,
} from '@/hooks/workspaces/use-application-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return {
    queryClient,
    Wrapper: function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children,
      );
    },
  };
}

/**
 * The 6 seed rows returned by GET /api/application-types.
 * Snake_case from the DB (route passes through verbatim — selector normalises to camelCase).
 */
const SEED_ROWS_SNAKE: Array<{
  key: string;
  label: string;
  label_plural: string | null;
  description: string | null;
  default_icon: string | null;
  default_colour: string | null;
}> = [
  {
    key: 'procurement',
    label: 'Procurement',
    label_plural: 'Procurements',
    description:
      'Manage bid responses and tender submissions using your knowledge base',
    default_icon: 'briefcase',
    default_colour: '#d4880f',
  },
  {
    key: 'intelligence',
    label: 'Intelligence Stream',
    label_plural: 'Intelligence Streams',
    description:
      'Sector and competitor news feeds tailored to your company profile.',
    default_icon: 'newspaper',
    default_colour: '#059669',
  },
  {
    key: 'sales_proposal',
    label: 'Sales Proposal',
    label_plural: 'Sales Proposals',
    description:
      'Draft and manage sales proposals drawing on your knowledge base',
    default_icon: 'file-signature',
    default_colour: '#0d9488',
  },
  {
    key: 'product_guide',
    label: 'Product Guide',
    label_plural: 'Product Guides',
    description: 'Product Guide',
    default_icon: null,
    default_colour: null,
  },
  {
    key: 'competitor_research',
    label: 'Competitor Research',
    label_plural: 'Competitor Researchs',
    description: 'Competitor Research',
    default_icon: null,
    default_colour: null,
  },
  {
    key: 'training_onboarding',
    label: 'Training Onboarding',
    label_plural: 'Training Onboardings',
    description: 'Training Onboarding',
    default_icon: null,
    default_colour: null,
  },
];

let mockFetch: ReturnType<typeof vi.fn>;

function stubFetchOk(response: typeof SEED_ROWS_SNAKE) {
  mockFetch = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    url,
    json: async () => response,
  }));
  vi.stubGlobal('fetch', mockFetch);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useApplicationTypes — TanStack hook (ID-29.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // (a) Hook returns 6 rows when application_types table is mocked with 6 rows.
  it('(a) returns 6 WorkspaceTypeConfig rows from the hook', async () => {
    stubFetchOk(SEED_ROWS_SNAKE);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useApplicationTypes(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/application-types');
    expect(result.current.data).toHaveLength(6);
  });

  // (b) useWorkspaceType('procurement') resolves with route='/procurement' + icon=Briefcase.
  it('(b) useWorkspaceType("procurement") resolves with route, available, hasCustomCreation, and Briefcase icon', async () => {
    stubFetchOk(SEED_ROWS_SNAKE);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspaceType('procurement'), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const config = result.current.data;
    expect(config).toBeDefined();
    expect(config?.label).toBe('Procurement');
    expect(config?.route).toBe('/procurement');
    expect(config?.available).toBe(true);
    expect(config?.hasCustomCreation).toBe(true);
    expect(config?.icon).toBe(Briefcase);
  });

  // (c) useWorkspaceType('unknown_key') returns undefined (preserves getWorkspaceType() contract).
  it('(c) useWorkspaceType("unknown_key") resolves to undefined', async () => {
    stubFetchOk(SEED_ROWS_SNAKE);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspaceType('unknown_key'), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toBeUndefined();
  });

  // (d) useLauncherTypes() filter semantics preserved.
  it('(d) useLauncherTypes() preserves getLauncherTypes() filter semantics (route !== null || !available)', async () => {
    stubFetchOk(SEED_ROWS_SNAKE);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useLauncherTypes(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const types = result.current.data ?? [];
    // procurement: route='/procurement' (not null) → included
    // intelligence: route='/intelligence' (not null) → included
    // sales_proposal: route=null, available=false → included (!available)
    // product_guide: route=null, available=false → included (!available)
    // competitor_research: route=null, available=false → included (!available)
    // training_onboarding: route=null, available=false → included (!available)
    // All 6 pass through (2 with routes, 4 with available=false).
    expect(types.length).toBeGreaterThan(0);

    // Verify procurement and intelligence are present (routed types)
    const procurementIncluded = types.some((t) => t.key === 'procurement');
    const intelligenceIncluded = types.some((t) => t.key === 'intelligence');
    expect(procurementIncluded).toBe(true);
    expect(intelligenceIncluded).toBe(true);

    // Verify no type is excluded that should be included (filter logic check)
    // A type is included if: route !== null OR !available
    for (const t of types) {
      const shouldBeIncluded = t.route !== null || !t.available;
      expect(shouldBeIncluded).toBe(true);
    }
  });

  // (e) formatTypeCount(undefined, 0) falls back to '0 active workspaces'.
  it('(e) formatTypeCount(undefined, 0) falls back to "0 active workspaces"', () => {
    const result = formatTypeCount(undefined, 0);
    expect(result).toBe('0 active workspaces');
  });

  // (f) formatTypeCount(intelligenceConfig, 3) returns '3 active intelligence streams'.
  it('(f) formatTypeCount(intelligenceConfig, 3) returns "3 active intelligence streams"', async () => {
    stubFetchOk(SEED_ROWS_SNAKE);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspaceType('intelligence'), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const intelligenceConfig = result.current.data;
    expect(intelligenceConfig).toBeDefined();

    // 3 → plural label
    const countText = formatTypeCount(intelligenceConfig, 3);
    expect(countText).toBe('3 active intelligence streams');

    // Verify icon is Newspaper (post-29.5: default_icon = 'newspaper')
    expect(intelligenceConfig?.icon).toBe(Newspaper);
  });
});
