import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import { ConceptDetail } from '@/components/okf/concept-detail';
import { parseOkfDocument } from '@/lib/okf/okf-document';
import type { OkfBundleGraphNode, OkfConceptSource } from '@/lib/query/okf';

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
  // resolves them. What is missing without this test is proof at the RENDER
  // site — that a system-type concept's badge actually picks up its own
  // token pair rather than silently falling through to the default the way
  // an unrecognised business type (the fixture's "BigQuery Table" above)
  // does.
  //
  // Asserted against the badge's INLINE STYLE, not its className: the badge
  // consumes the token through a `style` prop because concept `type` is an
  // open vocabulary (DR-141), so a Tailwind arbitrary-value class name would
  // only be known at runtime and the build-time scanner would never emit the
  // utility. See the matching note in `lib/okf/concept-type-tokens.ts`.
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

    const style = screen.getByText('schema').getAttribute('style') ?? '';
    expect(style).toContain('--okf-concept-schema-bg');
    expect(style).toContain('--okf-concept-schema-text');
    expect(style).not.toContain('--okf-concept-default-');
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

  // {132.49} union-graph regression. `<UnionGraphView>` passes namespaced
  // node ids (`acme::…`) and a `knownConceptIds` set of the same shape. These
  // two link forms previously resolved WITHOUT the namespace, missed the set,
  // and rendered as dead anchors that navigated the reader off the app.
  // Exercised through the real Streamdown render so the `::` is proven to
  // survive its bundled rehype-harden URL pass.
  const UNION_NODE: OkfBundleGraphNode = {
    data: { ...ORDERS_NODE.data, id: 'acme::services/orders' },
  };
  const UNION_KNOWN = new Set([
    'acme::services/orders',
    'acme::domain/customer',
    'acme::glossary',
  ]);

  it('names the owning bundle as its own field, without internal join syntax', () => {
    renderDetail({
      node: UNION_NODE,
      body: 'Body.',
      knownConceptIds: UNION_KNOWN,
      backlinks: [],
    });

    expect(screen.getByText('Bundle')).toBeInTheDocument();
    expect(screen.getByText('acme')).toBeInTheDocument();
    expect(screen.getByText('services/orders')).toBeInTheDocument();
    expect(screen.queryByText('acme::services/orders')).not.toBeInTheDocument();
  });

  it('omits the bundle field when viewing a single bundle', () => {
    // The per-bundle viewer has only one bundle in scope, so naming it would
    // be noise — ids there are un-namespaced and must render as before.
    renderDetail();

    expect(screen.queryByText('Bundle')).not.toBeInTheDocument();
    expect(screen.getByText('tables/orders')).toBeInTheDocument();
  });

  it('navigates within the same bundle when a union link climbs a directory', () => {
    const onNavigate = vi.fn();
    renderDetail({
      node: UNION_NODE,
      body: 'See [customer](../domain/customer.md).',
      knownConceptIds: UNION_KNOWN,
      backlinks: [],
      onNavigate,
    });

    fireEvent.click(screen.getByRole('button', { name: 'customer' }));

    expect(onNavigate).toHaveBeenCalledWith('acme::domain/customer');
  });

  it('navigates within the same bundle from a union citation-trailer link', () => {
    const onNavigate = vi.fn();
    renderDetail({
      node: UNION_NODE,
      body: '# Citations\n\n[1] [glossary](/glossary.md)',
      knownConceptIds: UNION_KNOWN,
      backlinks: [],
      onNavigate,
    });

    fireEvent.click(screen.getByRole('button', { name: 'glossary' }));

    expect(onNavigate).toHaveBeenCalledWith('acme::glossary');
  });

  it('hides the internal bundle prefix on a union link with no matching concept', () => {
    renderDetail({
      node: UNION_NODE,
      body: 'See the [orphan](../domain/orphan.md) concept.',
      knownConceptIds: UNION_KNOWN,
      backlinks: [],
    });

    // Falls back to a plain anchor, but the `acme::` qualifier is internal
    // bookkeeping and must not surface in a URL the reader can see.
    expect(screen.getByRole('link', { name: 'orphan' })).toHaveAttribute(
      'href',
      '/domain/orphan.md',
    );
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

  // ────────────────────────────────────────
  // OKF v0.2 sources[] provenance surface (id-439, F2-B rework): new
  // bundles carry pointers in sources[] instead of the single top-level
  // resource:. Each canonical:// entry stays clickable through the SAME
  // lazy resolution lane; https entries are plain links; bundle-path
  // entries navigate in-app. The legacy resource: lane (tests above) is
  // unchanged.
  // ────────────────────────────────────────

  const V02_SOURCES: OkfConceptSource[] = [
    {
      id: 'src-handbook',
      resource:
        'canonical://source_documents/3fa85f64-5717-4562-b3fc-2c963f66afa6',
      title: 'Security Handbook',
    },
    {
      id: 'src-standard',
      resource: 'https://example.com/iso-27001',
      title: 'ISO 27001 overview',
    },
    { id: 'src-cert', resource: '/tables/customers.md' },
  ];

  const V02_NODE: OkfBundleGraphNode = {
    data: {
      ...ORDERS_NODE.data,
      resource: '',
      sources: V02_SOURCES,
    },
  };

  it('renders the sources[] provenance list: canonical chip, plain https link, and in-app concept citation', () => {
    const onNavigate = vi.fn();
    renderDetail({ node: V02_NODE, onNavigate });

    expect(screen.getByText('Sources')).toBeInTheDocument();

    // canonical:// — the lazy chip, labelled by the entry title.
    expect(screen.getByText('Security Handbook')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'canonical://source_documents/3fa85f64-5717-4562-b3fc-2c963f66afa6',
      }),
    ).toBeInTheDocument();

    // https — a plain external link, no resolution lane.
    const external = screen.getByRole('link', { name: 'ISO 27001 overview' });
    expect(external).toHaveAttribute('href', 'https://example.com/iso-27001');
    expect(external).toHaveAttribute('target', '_blank');

    // bundle path — an in-app citation (labelled by id when no title).
    fireEvent.click(screen.getByRole('button', { name: 'src-cert' }));
    expect(onNavigate).toHaveBeenCalledWith('tables/customers');
  });

  it('resolves a clicked canonical:// source through the lazy resource lane, never on render', async () => {
    mockFetchJson.mockResolvedValue({
      table: 'source_documents',
      record: { id: 'doc-1', filename: 'handbook.pdf' },
    });

    renderDetail({ node: V02_NODE });

    expect(mockFetchJson).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'canonical://source_documents/3fa85f64-5717-4562-b3fc-2c963f66afa6',
      }),
    );

    await waitFor(() => expect(mockFetchJson).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByText(/"filename": "handbook.pdf"/),
      ).toBeInTheDocument(),
    );
  });

  it('navigates a union-namespaced bundle-path source within its own bundle', () => {
    const onNavigate = vi.fn();
    renderDetail({
      node: {
        data: {
          ...V02_NODE.data,
          id: 'acme::services/orders',
          sources: [{ id: 'src-cert', resource: '/domain/customer.md' }],
        },
      },
      knownConceptIds: UNION_KNOWN,
      backlinks: [],
      onNavigate,
    });

    fireEvent.click(screen.getByRole('button', { name: 'src-cert' }));

    expect(onNavigate).toHaveBeenCalledWith('acme::domain/customer');
  });

  it('renders a bundle-path source to an unknown concept as plain text, never a dead off-app anchor', () => {
    renderDetail({
      node: {
        data: {
          ...V02_NODE.data,
          sources: [{ id: 'src-ghost', resource: '/tables/ghost.md' }],
        },
      },
    });

    expect(screen.getByText('src-ghost')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'src-ghost' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'src-ghost' }),
    ).not.toBeInTheDocument();
  });

  it('omits the Sources row for a legacy concept with no sources[]', () => {
    renderDetail();

    expect(screen.queryByText('Sources')).not.toBeInTheDocument();
  });

  it('renders BOTH on-disk fixture generations end-to-end: the v0.2 sources concept and the v0.1 legacy concept', () => {
    const repoRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
    );
    const v02 = parseOkfDocument(
      readFileSync(
        resolve(repoRoot, '__tests__/fixtures/okf/concept-v02-sources.md'),
        'utf8',
      ),
    );
    const v01 = parseOkfDocument(
      readFileSync(
        resolve(repoRoot, '__tests__/fixtures/okf/concept-v01-legacy.md'),
        'utf8',
      ),
    );

    // v0.2: the sources[] provenance surface renders from fixture bytes.
    const fm02 = v02.frontmatter as {
      title: string;
      type: string;
      description: string;
      sources: OkfConceptSource[];
    };
    const { unmount } = renderDetail({
      node: {
        data: {
          id: 'topics/encryption',
          label: fm02.title,
          type: fm02.type,
          description: fm02.description,
          resource: '',
          tags: [],
          size: 30,
          sources: fm02.sources,
        },
      },
      body: v02.body,
      backlinks: [],
      knownConceptIds: new Set([
        'topics/encryption',
        'certifications/iso-27001',
      ]),
    });

    expect(screen.getByText('Sources')).toBeInTheDocument();
    expect(screen.getByText('Security Handbook')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'src-cert' }),
    ).toBeInTheDocument();
    unmount();

    // v0.1 legacy: no Sources row; the resource: chip lane still renders.
    const fm01 = v01.frontmatter as {
      title: string;
      type: string;
      description: string;
      resource: string;
    };
    renderDetail({
      node: {
        data: {
          id: 'topics/encryption',
          label: fm01.title,
          type: fm01.type,
          description: fm01.description,
          resource: fm01.resource,
          tags: [],
          size: 30,
        },
      },
      body: v01.body,
      backlinks: [],
      knownConceptIds: new Set([
        'topics/encryption',
        'certifications/iso-27001',
      ]),
    });

    expect(screen.queryByText('Sources')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'canonical://source_documents/3fa85f64-5717-4562-b3fc-2c963f66afa6',
      }),
    ).toBeInTheDocument();
  });
});
