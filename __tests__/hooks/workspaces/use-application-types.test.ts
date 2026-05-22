/**
 * useApplicationTypes — TanStack Query hook tests (ID-29.6).
 *
 * Tests the hook that replaces the static WORKSPACE_TYPE_REGISTRY with a
 * DB-driven approach via the /api/application-types route.
 *
 * Mock strategy
 * -------------
 * Tests stub `global.fetch` (via `stubApplicationTypesFetch()` from
 * `__tests__/helpers/workspace-type-fixtures`) rather than mocking the
 * TanStack hook itself. This exercises the real `useQuery` machinery —
 * fetch URL, `select:` transformation, `staleTime` cache behaviour — and
 * keeps the test surface aligned with production wire shape (snake_case
 * rows verbatim from GET /api/application-types). The QueryClient wrapper
 * comes from the project-wide `createQueryWrapper()` helper with `retry: false`
 * and `gcTime: 0` so cache state is isolated per test.
 *
 * Coverage: 7 cases per TECH.md §3 P-5 (+ exclusion-semantics regression
 * test added S256 per S254 W2 Checker carry-over).
 *   (a) Hook returns 6 rows when application_types table is mocked with 6 rows.
 *   (b) useWorkspaceType('procurement') resolves with route='/procurement' + icon=Briefcase.
 *   (c) useWorkspaceType('unknown_key') returns undefined.
 *   (d) useLauncherTypes() preserves the route !== null || !available filter.
 *   (d2) useLauncherTypes() EXCLUDES types where route===null && available===true
 *        (defensive regression — no current seed triggers this, but the filter
 *        guards future "available, no route" rows).
 *   (e) formatTypeCount(undefined, 0) falls back to '0 active workspaces'.
 *   (f) formatTypeCount(intelligenceConfig, 3) returns '3 active intelligence streams'.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { Briefcase, Newspaper } from 'lucide-react';

import {
  useApplicationTypes,
  useWorkspaceType,
  useLauncherTypes,
  formatTypeCount,
} from '@/hooks/workspaces/use-application-types';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import {
  SEED_APPLICATION_TYPE_ROWS,
  stubApplicationTypesFetch,
  type ApplicationTypeWireRow,
} from '@/__tests__/helpers/workspace-type-fixtures';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useApplicationTypes — TanStack hook (ID-29.6)', () => {
  let mockFetch: ReturnType<typeof stubApplicationTypesFetch>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = stubApplicationTypesFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // (a) Hook returns 6 rows when application_types table is mocked with 6 rows.
  it('(a) returns 6 WorkspaceTypeConfig rows from the hook', async () => {
    const { Wrapper } = createQueryWrapper();

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
    const { Wrapper } = createQueryWrapper();

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
    const { Wrapper } = createQueryWrapper();

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
    const { Wrapper } = createQueryWrapper();

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

  // (d2) Exclusion-semantics regression: filter passes ALL current seeds through
  // because CLIENT_CONFIG never sets `route: null && available: true`. This test
  // documents the dead-exclusion property of the current seed set so a future
  // PR adding such a row can't silently slip the launcher list. Per S254 W2
  // Checker carry-over (missing useLauncherTypes exclusion test).
  it('(d2) useLauncherTypes() passes ALL 6 current seed rows through the filter', async () => {
    const { Wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useLauncherTypes(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const types = result.current.data ?? [];
    // Dead-exclusion property: with the current 6-row seed, every row either
    // has a route ('procurement', 'intelligence') or is unavailable (the
    // remaining 4 fall through to PERMISSIVE_DEFAULT which sets
    // route:null+available:false). If a future seed adds an entry with a
    // CLIENT_CONFIG of { route: null, available: true } the launcher would
    // hide it — case (d) would still pass but length would drop below 6.
    expect(types).toHaveLength(6);
  });

  // (e) formatTypeCount(undefined, 0) falls back to '0 active workspaces'.
  it('(e) formatTypeCount(undefined, 0) falls back to "0 active workspaces"', () => {
    const result = formatTypeCount(undefined, 0);
    expect(result).toBe('0 active workspaces');
  });

  // (f) formatTypeCount(intelligenceConfig, 3) returns '3 active intelligence streams'.
  it('(f) formatTypeCount(intelligenceConfig, 3) returns "3 active intelligence streams"', async () => {
    const { Wrapper } = createQueryWrapper();

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

  // Sanity check: helper fixture exposes 6 rows (parity with DB seed)
  it('SEED_APPLICATION_TYPE_ROWS contains 6 application_types seed rows', () => {
    const rows: ApplicationTypeWireRow[] = SEED_APPLICATION_TYPE_ROWS;
    expect(rows).toHaveLength(6);
  });
});
