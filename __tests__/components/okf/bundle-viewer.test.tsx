import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';
import { BundleViewer } from '@/components/okf/bundle-viewer';

installRadixPointerShims();

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockFetchJson, cyInstances } = vi.hoisted(() => ({
  mockFetchJson: vi.fn(),
  cyInstances: [] as { __tapNode: (id: string) => void }[],
}));

vi.mock('@/lib/query/fetchers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/query/fetchers')>(
    '@/lib/query/fetchers',
  );
  return { ...actual, fetchJson: mockFetchJson };
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
    {
      data: {
        id: 'tables/customers',
        label: 'Customers',
        type: 'BigQuery Table',
        description: 'One row per customer.',
        resource: '',
        tags: [],
        size: 30,
      },
    },
  ],
  edges: [
    { data: { id: 'e1', source: 'tables/orders', target: 'tables/customers' } },
  ],
  bodies: {
    'tables/orders': 'Orders body.',
    'tables/customers': 'Customers body, cited by orders.',
  },
  types: ['BigQuery Table'],
  nav: [
    {
      heading: 'Sales',
      level: 2,
      concepts: [
        {
          title: 'Orders',
          path: 'tables/orders',
          description: 'One row per order.',
        },
        {
          title: 'Customers',
          path: 'tables/customers',
          description: 'One row per customer.',
        },
      ],
      children: [],
    },
  ],
  log: [{ heading: '2026-07-01T09:00:00Z', body: '- Added `tables/orders`.' }],
};

function renderViewer() {
  const { Wrapper } = createQueryWrapper();
  return render(
    <Wrapper>
      <BundleViewer bundleId="first-client" />
    </Wrapper>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  cyInstances.length = 0;
  mockFetchJson.mockResolvedValue(ENVELOPE);
});

describe('BundleViewer', () => {
  it('renders the nav, graph, and an empty concept-detail state on load', async () => {
    renderViewer();

    await waitFor(() =>
      expect(screen.getByTestId('bundle-viewer')).toBeInTheDocument(),
    );

    expect(screen.getByText('Sales')).toBeInTheDocument(); // BundleNav theme
    expect(screen.getByTestId('concept-graph-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('concept-detail-empty')).toBeInTheDocument();
  });

  it('selecting a concept from BundleNav renders it in ConceptDetail', async () => {
    renderViewer();
    await waitFor(() =>
      expect(screen.getByTestId('bundle-viewer')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText('Sales'));
    fireEvent.click(screen.getByText('Orders'));

    expect(screen.getByTestId('concept-detail')).toBeInTheDocument();
    expect(screen.getByText('Orders body.')).toBeInTheDocument();
  });

  it('tapping a graph node updates the same selection state as the nav', async () => {
    renderViewer();
    await waitFor(() =>
      expect(screen.getByTestId('bundle-viewer')).toBeInTheDocument(),
    );

    act(() => {
      cyInstances[0].__tapNode('tables/customers');
    });

    expect(screen.getByTestId('concept-detail')).toHaveTextContent(
      'Customers body, cited by orders.',
    );
  });

  it('renders the History tab with the parsed log.md entries', async () => {
    const user = userEvent.setup();
    renderViewer();
    await waitFor(() =>
      expect(screen.getByTestId('bundle-viewer')).toBeInTheDocument(),
    );

    await user.click(screen.getByRole('tab', { name: 'History' }));

    await waitFor(() =>
      expect(screen.getByTestId('bundle-log')).toHaveTextContent(
        'Added tables/orders.',
      ),
    );
  });

  it('renders a non-blank error state when the bundle fetch fails', async () => {
    mockFetchJson.mockRejectedValue(new Error('network error'));

    renderViewer();

    await waitFor(() =>
      expect(
        screen.getByText(/Failed to load this bundle/),
      ).toBeInTheDocument(),
    );
  });

  it('fetches the bundle envelope exactly once (nav/graph/log/detail share one query)', async () => {
    renderViewer();
    await waitFor(() =>
      expect(screen.getByTestId('bundle-viewer')).toBeInTheDocument(),
    );

    expect(mockFetchJson).toHaveBeenCalledTimes(1);
  });
});
