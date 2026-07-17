import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import { ConceptDetail } from '@/components/okf/concept-detail';
import type { OkfBundleGraphNode } from '@/lib/query/okf';

const { mockFetchJson } = vi.hoisted(() => ({ mockFetchJson: vi.fn() }));

vi.mock('@/lib/query/fetchers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/query/fetchers')>(
    '@/lib/query/fetchers',
  );
  return { ...actual, fetchJson: mockFetchJson };
});

const ORDERS_NODE: OkfBundleGraphNode = {
  data: {
    id: 'tables/orders',
    label: 'Orders',
    type: 'BigQuery Table',
    description: 'One row per order.',
    resource:
      'canonical://source_documents/3fa85f64-5717-4562-b3fc-2c963f66afa6',
    tags: ['sales', 'orders'],
    size: 30,
  },
};

function renderDetail(
  props: Partial<React.ComponentProps<typeof ConceptDetail>> = {},
) {
  const { Wrapper } = createQueryWrapper();
  return render(
    <Wrapper>
      <ConceptDetail
        node={ORDERS_NODE}
        body="See the [customers](../tables/customers.md) table."
        backlinks={[{ id: 'tables/customers', label: 'Customers' }]}
        knownConceptIds={new Set(['tables/orders', 'tables/customers'])}
        onNavigate={vi.fn()}
        {...props}
      />
    </Wrapper>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ConceptDetail', () => {
  it('renders an empty state when no node is selected', () => {
    renderDetail({ node: null });

    expect(screen.getByTestId('concept-detail-empty')).toHaveTextContent(
      'Click a node to see its details.',
    );
  });

  it('renders the type chip, title, id, and frontmatter fields', () => {
    renderDetail();

    expect(screen.getByText('BigQuery Table')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument();
    expect(screen.getByText('tables/orders')).toBeInTheDocument();
    expect(screen.getByText('One row per order.')).toBeInTheDocument();
    expect(screen.getByText('sales')).toBeInTheDocument();
    expect(screen.getByText('orders')).toBeInTheDocument();
  });

  // PC-7c (TECH id-163) residual check: {163.3} added the schema/tool/api/
  // navigation semantic-token MAPPINGS to conceptTypeTokenVars, and
  // concept-type-tokens.test.ts already proves the mapping function itself
  // resolves them. What was missing was proof at the RENDER site — that a
  // system-type concept's badge actually picks up its own token pair rather
  // than silently falling through to `--okf-concept-default-*` the way an
  // unrecognised business type (e.g. the fixture's "BigQuery Table" above)
  // does.
  it('renders a system-type concept badge with its own semantic token, not the default fallback (PC-7c)', () => {
    renderDetail({
      node: {
        data: {
          ...ORDERS_NODE.data,
          id: 'schemas/orders-table',
          label: 'Orders table schema',
          type: 'schema',
        },
      },
      knownConceptIds: new Set(['schemas/orders-table']),
    });

    const badge = screen.getByText('schema');
    expect(badge.className).toContain('--okf-concept-schema-bg');
    expect(badge.className).toContain('--okf-concept-schema-text');
    expect(badge.className).not.toContain('--okf-concept-default-bg');
  });

  it('renders the body as markdown, rewriting a known internal link to an in-app button', () => {
    const onNavigate = vi.fn();
    renderDetail({ onNavigate });

    const link = screen.getByRole('button', { name: 'customers' });
    fireEvent.click(link);

    expect(onNavigate).toHaveBeenCalledWith('tables/customers');
  });

  it('renders an unknown internal-looking link as a plain external anchor', () => {
    renderDetail({
      body: 'See the [orphan](../tables/orphan.md) concept.',
      knownConceptIds: new Set(['tables/orders']),
    });

    const link = screen.getByRole('link', { name: 'orphan' });
    // Streamdown's rehype-harden pass requires internal links to be resolved
    // up front, so the anchor shows the bundle-root-relative resolved path
    // (marker stripped), not the raw author-written relative form.
    expect(link).toHaveAttribute('href', '/tables/orphan.md');
  });

  it('renders the "Cited by" backlinks section and navigates on click', () => {
    const onNavigate = vi.fn();
    renderDetail({ onNavigate });

    expect(screen.getByText('Cited by')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Customers' }));

    expect(onNavigate).toHaveBeenCalledWith('tables/customers');
  });

  it('omits the "Cited by" section when there are no backlinks', () => {
    renderDetail({ backlinks: [] });

    expect(screen.queryByText('Cited by')).not.toBeInTheDocument();
  });

  it('renders a resource: pointer as a lazy-resolving chip, not fetched until clicked', async () => {
    mockFetchJson.mockResolvedValue({
      table: 'source_documents',
      record: { id: 'doc-1', filename: 'orders.csv' },
    });

    renderDetail();

    expect(mockFetchJson).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'canonical://source_documents/3fa85f64-5717-4562-b3fc-2c963f66afa6',
      }),
    );

    await waitFor(() => expect(mockFetchJson).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByText(/"filename": "orders.csv"/)).toBeInTheDocument(),
    );
  });

  it('renders a plain external resource URL as a direct link, no lazy-resolve chip', () => {
    renderDetail({
      node: {
        data: { ...ORDERS_NODE.data, resource: 'https://example.com/orders' },
      },
    });

    const link = screen.getByRole('link', {
      name: 'https://example.com/orders',
    });
    expect(link).toHaveAttribute('target', '_blank');
    expect(mockFetchJson).not.toHaveBeenCalled();
  });
});
