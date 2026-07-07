/**
 * useBundleGraph / useBundleNav / useBundleLog — the {132.14} G-VIEWER data
 * hooks. Behaviour under test (test-philosophy.md): the three domain hooks
 * derive their slices from ONE shared network fetch (dedupe via a shared
 * queryKey), not three separate round-trips.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';

const { mockFetchJson } = vi.hoisted(() => ({ mockFetchJson: vi.fn() }));

vi.mock('@/lib/query/fetchers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/query/fetchers')>(
    '@/lib/query/fetchers',
  );
  return { ...actual, fetchJson: mockFetchJson };
});

import {
  useBundleGraph,
  useBundleNav,
  useBundleLog,
} from '@/hooks/okf/use-bundle';

const ENVELOPE = {
  nodes: [
    {
      data: {
        id: 'tables/orders',
        label: 'Orders',
        type: 'BigQuery Table',
        description: 'One row per order.',
        resource: '',
        tags: [],
        size: 30,
      },
    },
  ],
  edges: [],
  bodies: { 'tables/orders': 'Orders body.' },
  types: ['BigQuery Table'],
  nav: [
    {
      heading: 'Sales',
      level: 2,
      concepts: [{ title: 'Orders', path: 'tables/orders', description: '' }],
      children: [],
    },
  ],
  log: [{ heading: '2026-07-01T09:00:00Z', body: '- Added orders.' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchJson.mockResolvedValue(ENVELOPE);
});

describe('OKF bundle data hooks', () => {
  it('useBundleGraph returns only the graph slice', async () => {
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBundleGraph('first-client'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      nodes: ENVELOPE.nodes,
      edges: ENVELOPE.edges,
      bodies: ENVELOPE.bodies,
      types: ENVELOPE.types,
    });
  });

  it('useBundleNav returns the nav tree slice', async () => {
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBundleNav('first-client'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(ENVELOPE.nav);
  });

  it('useBundleLog returns the reverse-chronological log slice', async () => {
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBundleLog('first-client'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(ENVELOPE.log);
  });

  it('dedupes the fetch across all three hooks sharing one QueryClient', async () => {
    const { Wrapper, queryClient } = createQueryWrapper();
    function useAll() {
      return {
        graph: useBundleGraph('first-client'),
        nav: useBundleNav('first-client'),
        log: useBundleLog('first-client'),
      };
    }
    const { result } = renderHook(() => useAll(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.graph.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.nav.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.log.isSuccess).toBe(true));

    expect(mockFetchJson).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });

  it('does not fetch when bundleId is empty', () => {
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBundleGraph(''), {
      wrapper: Wrapper,
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFetchJson).not.toHaveBeenCalled();
  });
});
