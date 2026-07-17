/**
 * {132.32} G-LANDING-IMPL — `<OkfLanding>` (LI-1 the /okf index route's
 * top-level orchestrator: enumerate-all bundle list + full-bundle file
 * explorer on ONE page; LI-4(a)/(b) graceful empty states).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createQueryWrapper } from '../../helpers/query-wrapper';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockFetchOkfBundleList = vi.fn();
const mockFetchOkfBundleTree = vi.fn();
const mockFetchOkfBundleFile = vi.fn();
const mockFetchOkfUnionGraph = vi.fn();

vi.mock('@/lib/query/okf', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/query/okf')>('@/lib/query/okf');
  return {
    ...actual,
    fetchOkfBundleList: () => mockFetchOkfBundleList(),
    fetchOkfBundleTree: (...args: unknown[]) => mockFetchOkfBundleTree(...args),
    fetchOkfBundleFile: (...args: unknown[]) => mockFetchOkfBundleFile(...args),
    fetchOkfUnionGraph: () => mockFetchOkfUnionGraph(),
  };
});

// {132.49}: <UnionGraphView> (the new "Deployment graph" tab) mounts
// <ConceptGraph>, which calls real cytoscape() — jsdom has no canvas 2D
// context, so a minimal fake is needed for any test that opens that tab.
vi.mock('cytoscape', () => ({
  default: (opts: { elements: unknown[] }) => ({
    on: () => {},
    nodes: () => ({ forEach: () => {}, removeClass: () => {} }),
    edges: () => ({ forEach: () => {}, removeClass: () => {} }),
    elements: () => ({
      forEach: () => {},
      removeClass: () => {},
      unselect: () => {},
    }),
    getElementById: () => ({ length: 0 }),
    layout: () => ({ run: () => {} }),
    fit: () => {},
    destroy: () => {},
    __opts: opts,
  }),
}));

import { OkfLanding } from '@/components/okf/okf-landing';

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchOkfUnionGraph.mockResolvedValue({
    nodes: [],
    edges: [],
    bodies: {},
    types: [],
  });
});

describe('OkfLanding', () => {
  it('renders the "not configured" empty state (LI-4(a))', async () => {
    mockFetchOkfBundleList.mockResolvedValue({
      bundles: [],
      configured: false,
    });

    const { Wrapper } = createQueryWrapper();
    render(<OkfLanding />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByText(/no concepts have been published yet/i),
      ).toBeInTheDocument();
    });
  });

  it('lists every bundle (LI-14) and opens the file explorer on selection', async () => {
    mockFetchOkfBundleList.mockResolvedValue({
      bundles: ['alpha-client', 'zeta-client'],
      configured: true,
    });
    mockFetchOkfBundleTree.mockResolvedValue({
      tree: [
        { name: 'index.md', path: 'index.md', type: 'file', renderable: true },
      ],
    });
    mockFetchOkfBundleFile.mockResolvedValue({
      path: 'index.md',
      content: '## Sales\n',
    });

    const { Wrapper } = createQueryWrapper();
    const user = userEvent.setup();
    render(<OkfLanding />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText('alpha-client')).toBeInTheDocument();
      expect(screen.getByText('zeta-client')).toBeInTheDocument();
    });

    await user.click(
      screen.getAllByRole('button', { name: /browse files/i })[0],
    );

    await waitFor(() => {
      expect(mockFetchOkfBundleTree).toHaveBeenCalledWith('alpha-client');
    });
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Sales' }),
      ).toBeInTheDocument();
    });
  });

  it('resets the explorer state when switching to a different bundle', async () => {
    mockFetchOkfBundleList.mockResolvedValue({
      bundles: ['alpha-client', 'zeta-client'],
      configured: true,
    });
    mockFetchOkfBundleTree.mockImplementation(async (bundleId: string) => ({
      tree: [
        {
          name: 'index.md',
          path: 'index.md',
          type: 'file',
          renderable: true,
        },
        {
          name: `${bundleId}.md`,
          path: `${bundleId}.md`,
          type: 'file',
          renderable: true,
        },
      ],
    }));
    mockFetchOkfBundleFile.mockImplementation(
      async (bundleId: string, path: string) => ({
        path,
        content: `## ${bundleId}\n`,
      }),
    );

    const { Wrapper } = createQueryWrapper();
    const user = userEvent.setup();
    render(<OkfLanding />, { wrapper: Wrapper });

    await waitFor(() =>
      expect(screen.getByText('alpha-client')).toBeInTheDocument(),
    );
    await user.click(
      screen.getAllByRole('button', { name: /browse files/i })[0],
    );
    await waitFor(() => {
      expect(screen.getByText('alpha-client.md')).toBeInTheDocument();
    });

    await user.click(
      screen.getAllByRole('button', { name: /browse files/i })[1],
    );
    await waitFor(() => {
      expect(mockFetchOkfBundleTree).toHaveBeenCalledWith('zeta-client');
    });
    await waitFor(() => {
      expect(screen.getByText('zeta-client.md')).toBeInTheDocument();
    });
    expect(screen.queryByText('alpha-client.md')).not.toBeInTheDocument();
  });

  it('surfaces the deployment union graph on the "Deployment graph" tab (ID-132 {132.49})', async () => {
    mockFetchOkfBundleList.mockResolvedValue({
      bundles: ['alpha-client'],
      configured: true,
    });

    const { Wrapper } = createQueryWrapper();
    const user = userEvent.setup();
    render(<OkfLanding />, { wrapper: Wrapper });

    await waitFor(() =>
      expect(screen.getByText('alpha-client')).toBeInTheDocument(),
    );
    // Default tab is "Browse bundles" — the pre-{132.49} landing is unchanged.
    expect(screen.getByTestId('okf-landing')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Deployment graph' }));

    await waitFor(() => {
      expect(mockFetchOkfUnionGraph).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(
        screen.getByText(/no concepts have been published yet/i),
      ).toBeInTheDocument();
    });
  });
});
