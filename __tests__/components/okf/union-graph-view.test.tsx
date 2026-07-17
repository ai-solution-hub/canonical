/**
 * `<UnionGraphView>` — the deployment-level union concept graph (ID-132
 * {132.49} G-CONCEPT-GRAPH-UNION §5). Mirrors `bundle-viewer.test.tsx`'s
 * fake-cytoscape + mocked-fetch pattern; jsdom has no canvas 2D context so
 * real Cytoscape rendering stays out of scope here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import { UnionGraphView } from '@/components/okf/union-graph-view';

const { mockFetchOkfUnionGraph, cyInstances } = vi.hoisted(() => ({
  mockFetchOkfUnionGraph: vi.fn(),
  cyInstances: [] as { __tapNode: (id: string) => void }[],
}));

vi.mock('@/lib/query/okf', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/query/okf')>('@/lib/query/okf');
  return { ...actual, fetchOkfUnionGraph: () => mockFetchOkfUnionGraph() };
});

vi.mock('cytoscape', () => ({
  default: (opts: { elements: { data: Record<string, unknown> }[] }) => {
    const nodeEls = new Map<string, { data: Record<string, unknown> }>();
    for (const el of opts.elements) {
      if (!('source' in el.data)) nodeEls.set(el.data.id as string, el);
    }
    const tapNodeHandlers: ((evt: { target: { id: () => string } }) => void)[] =
      [];
    const noop = () => ({
      forEach: () => {},
      removeClass: () => {},
      unselect: () => {},
    });
    const cy = {
      on: (
        event: string,
        selector: string | ((...a: unknown[]) => void),
        handler?: (evt: { target: { id: () => string } }) => void,
      ) => {
        if (event === 'tap' && typeof selector === 'string' && handler) {
          tapNodeHandlers.push(handler);
        }
      },
      nodes: noop,
      edges: noop,
      elements: () => ({ ...noop(), unselect: () => {} }),
      getElementById: () => ({ length: 0 }),
      layout: () => ({ run: () => {} }),
      fit: () => {},
      destroy: () => {},
      __tapNode: (id: string) => {
        tapNodeHandlers.forEach((h) => h({ target: { id: () => id } }));
      },
    };
    cyInstances.push(cy);
    return cy;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  cyInstances.length = 0;
});

const UNION_GRAPH = {
  nodes: [
    {
      data: {
        id: 'alpha-client::tables/orders',
        label: 'Orders',
        type: 'BigQuery Table',
        description: 'One row per order.',
        resource: '',
        tags: [],
        size: 30,
        bundleId: 'alpha-client',
        bundleClass: 'client' as const,
        confidence: 'strong',
        opacity: 1,
        iriScope: 'base' as const,
      },
    },
    {
      data: {
        id: 'canonical-okf-system::topics/quality',
        label: 'Quality',
        type: 'topic',
        description: 'Platform baseline topic.',
        resource: '',
        tags: [],
        size: 30,
        bundleId: 'canonical-okf-system',
        bundleClass: 'platform' as const,
        confidence: null,
        opacity: 1,
        iriScope: 'base' as const,
      },
    },
  ],
  edges: [
    {
      data: {
        id: 'e1',
        source: 'alpha-client::tables/orders',
        target: 'canonical-okf-system::topics/quality',
        relationship: 'related' as const,
      },
    },
  ],
  bodies: {
    'alpha-client::tables/orders': 'The orders table.',
    'canonical-okf-system::topics/quality': 'Quality overview.',
  },
  types: ['BigQuery Table', 'topic'],
};

describe('UnionGraphView', () => {
  it('renders a loading skeleton while the union graph is in flight', () => {
    mockFetchOkfUnionGraph.mockReturnValue(new Promise(() => {}));
    const { Wrapper } = createQueryWrapper();

    render(<UnionGraphView />, { wrapper: Wrapper });

    expect(screen.queryByTestId('union-graph-view')).not.toBeInTheDocument();
  });

  it('renders a friendly error state when the fetch fails', async () => {
    mockFetchOkfUnionGraph.mockRejectedValue(new Error('boom'));
    const { Wrapper } = createQueryWrapper();

    render(<UnionGraphView />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByText(/failed to load the deployment concept graph/i),
      ).toBeInTheDocument();
    });
  });

  it('renders the empty state when no bundles have any concepts', async () => {
    mockFetchOkfUnionGraph.mockResolvedValue({
      nodes: [],
      edges: [],
      bodies: {},
      types: [],
    });
    const { Wrapper } = createQueryWrapper();

    render(<UnionGraphView />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByText(/no concepts have been published yet/i),
      ).toBeInTheDocument();
    });
  });

  it('renders the graph + detail panes with namespaced union node ids', async () => {
    mockFetchOkfUnionGraph.mockResolvedValue(UNION_GRAPH);
    const { Wrapper } = createQueryWrapper();

    render(<UnionGraphView />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('union-graph-view')).toBeInTheDocument();
    });
    expect(screen.getByTestId('concept-detail-empty')).toBeInTheDocument();

    act(() => {
      cyInstances[0].__tapNode('alpha-client::tables/orders');
    });

    await waitFor(() => {
      expect(screen.getByTestId('concept-detail')).toBeInTheDocument();
    });
    expect(screen.getByText('Orders')).toBeInTheDocument();
  });
});
