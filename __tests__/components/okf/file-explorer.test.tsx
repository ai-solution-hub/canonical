/**
 * {132.32} G-LANDING-IMPL — `<FileExplorer>` (LI-15 full-bundle tree
 * navigation; `index.md` is the default-selected entry point, not the
 * boundary; LI-4(c) per-bundle empty state when no index.md exists).
 * Connected container — owns the tree + file TanStack Query calls; asserted
 * via a real QueryClient with a mocked fetch (mirrors the
 * `CorpusRelatedRecords` connected-container test pattern).
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

const mockFetchOkfBundleTree = vi.fn();
const mockFetchOkfBundleFile = vi.fn();

vi.mock('@/lib/query/okf', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/query/okf')>('@/lib/query/okf');
  return {
    ...actual,
    fetchOkfBundleTree: (...args: unknown[]) => mockFetchOkfBundleTree(...args),
    fetchOkfBundleFile: (...args: unknown[]) => mockFetchOkfBundleFile(...args),
  };
});

import { FileExplorer } from '@/components/okf/file-explorer';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FileExplorer', () => {
  it('defaults to rendering index.md when present (LI-15 entry point, not the boundary)', async () => {
    mockFetchOkfBundleTree.mockResolvedValue({
      tree: [
        { name: 'index.md', path: 'index.md', type: 'file', renderable: true },
        {
          name: 'theme',
          path: 'theme',
          type: 'directory',
          children: [
            {
              name: 'concept.md',
              path: 'theme/concept.md',
              type: 'file',
              renderable: true,
            },
          ],
        },
      ],
    });
    mockFetchOkfBundleFile.mockResolvedValue({
      path: 'index.md',
      content: '## Sales\n',
    });

    const { Wrapper } = createQueryWrapper();
    render(<FileExplorer bundleId="first-client" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(mockFetchOkfBundleFile).toHaveBeenCalledWith(
        'first-client',
        'index.md',
      );
    });
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Sales' }),
      ).toBeInTheDocument();
    });
    // The nested concept is listed and reachable, per LI-15.
    expect(screen.getByText('concept.md')).toBeInTheDocument();
  });

  it('opening a different tree file re-fetches and renders it', async () => {
    mockFetchOkfBundleTree.mockResolvedValue({
      tree: [
        { name: 'index.md', path: 'index.md', type: 'file', renderable: true },
        { name: 'log.md', path: 'log.md', type: 'file', renderable: true },
      ],
    });
    mockFetchOkfBundleFile.mockImplementation(
      async (_bundleId: string, path: string) => ({
        path,
        content: path === 'index.md' ? '## Sales\n' : '## Run history\n',
      }),
    );

    const { Wrapper } = createQueryWrapper();
    const user = userEvent.setup();
    render(<FileExplorer bundleId="first-client" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Sales' }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'log.md' }));

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Run history' }),
      ).toBeInTheDocument();
    });
  });

  it('shows a per-bundle empty state when no index.md exists (LI-4(c))', async () => {
    mockFetchOkfBundleTree.mockResolvedValue({
      tree: [
        { name: 'log.md', path: 'log.md', type: 'file', renderable: true },
      ],
    });

    const { Wrapper } = createQueryWrapper();
    render(<FileExplorer bundleId="first-client" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText('log.md')).toBeInTheDocument();
    });
    expect(
      screen.getByText(/select a file from the tree/i),
    ).toBeInTheDocument();
    expect(mockFetchOkfBundleFile).not.toHaveBeenCalled();
  });

  it('links to the /okf/[bundleId] graph viewer (LI-18)', async () => {
    mockFetchOkfBundleTree.mockResolvedValue({ tree: [] });

    const { Wrapper } = createQueryWrapper();
    render(<FileExplorer bundleId="first-client" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /graph view/i })).toHaveAttribute(
        'href',
        '/okf/first-client',
      );
    });
  });
});
