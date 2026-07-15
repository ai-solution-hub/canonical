import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildBundleGraph } from '@/lib/okf/bundle-graph';

/**
 * Builds a throwaway bundle directory on disk (TDD unit — the bundle-graph
 * port reads the filesystem directly, mirroring `generate_visualization`'s
 * `bundle_root` walk, so a real temp directory is the most faithful fixture).
 */
function makeBundle(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'okf-bundle-graph-'));
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(root, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf-8');
  }
  return root;
}

const createdRoots: string[] = [];
function bundle(files: Record<string, string>): string {
  const root = makeBundle(files);
  createdRoots.push(root);
  return root;
}

afterEach(() => {
  while (createdRoots.length > 0) {
    const root = createdRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

const orders = [
  '---',
  'type: BigQuery Table',
  'title: Orders',
  'description: One row per order.',
  'resource: https://example.com/orders',
  'tags: [orders, sales]',
  '---',
  '',
  'The orders table. See the [customers](customers.md) table and the',
  '[sales dataset](../datasets/sales.md).',
].join('\n');

const customers = [
  '---',
  'type: BigQuery Table',
  'title: Customers',
  'description: One row per customer.',
  '---',
  '',
  'The customers table, referenced by [orders](orders.md).',
].join('\n');

const salesDataset = [
  '---',
  'type: BigQuery Dataset',
  'title: Sales',
  'description: The sales dataset.',
  '---',
  '',
  'Parent dataset for the tables under tables/.',
].join('\n');

describe('buildBundleGraph', () => {
  it('walks concept .md files into nodes with frontmatter-derived fields', () => {
    const root = bundle({ 'tables/orders.md': orders });

    const graph = buildBundleGraph(root);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].data).toMatchObject({
      id: 'tables/orders',
      label: 'Orders',
      type: 'BigQuery Table',
      description: 'One row per order.',
      resource: 'https://example.com/orders',
      tags: ['orders', 'sales'],
    });
  });

  it('resolves internal .md links to edges, dropping unresolvable/external links', () => {
    const root = bundle({
      'tables/orders.md': orders,
      'tables/customers.md': customers,
      'datasets/sales.md': salesDataset,
    });

    const graph = buildBundleGraph(root);

    const edgeIds = graph.edges.map(
      (e) => `${e.data.source}->${e.data.target}`,
    );
    expect(edgeIds).toContain('tables/orders->tables/customers');
    expect(edgeIds).toContain('tables/orders->datasets/sales');
    expect(edgeIds).toContain('tables/customers->tables/orders');
    expect(graph.edges).toHaveLength(3);
  });

  it('resolves leading-/ bundle-absolute links (SPEC §5.1 citation-trailer form) into edges', () => {
    const citing = [
      '---',
      'type: topic',
      'title: Quality Management',
      'description: Quality management overview.',
      '---',
      '',
      'Certified per [ISO 9001](/tables/customers.md).',
      '',
      '# Citations',
      '',
      '[1] [Customers](/tables/customers.md)',
    ].join('\n');
    const root = bundle({
      'topics/quality.md': citing,
      'tables/customers.md': customers,
      'tables/orders.md': orders,
    });

    const graph = buildBundleGraph(root);

    const edgeIds = graph.edges.map(
      (e) => `${e.data.source}->${e.data.target}`,
    );
    // The bundle-absolute link resolves against the BUNDLE root — one
    // de-duplicated edge from the citing concept to the target.
    expect(edgeIds).toContain('topics/quality->tables/customers');
  });

  it('skips bundle-root README.md and CONFORMANCE.md (reserved hand-authored docs), but not nested ones', () => {
    const root = bundle({
      'tables/orders.md': orders,
      'README.md': '# Bundle repo\n',
      'CONFORMANCE.md': '# Conformance statement\n',
      'guides/README.md': customers, // nested — still a walkable file
    });

    const graph = buildBundleGraph(root);

    const ids = graph.nodes.map((n) => n.data.id);
    expect(ids).toContain('tables/orders');
    expect(ids).toContain('guides/README');
    expect(ids).not.toContain('README');
    expect(ids).not.toContain('CONFORMANCE');
  });

  it('skips index.md when walking concepts', () => {
    const root = bundle({
      'tables/orders.md': orders,
      'index.md': '# BigQuery Table\n\n* [Orders](tables/orders.md)\n',
    });

    const graph = buildBundleGraph(root);

    expect(graph.nodes.map((n) => n.data.id)).toEqual(['tables/orders']);
  });

  it('collects concept bodies keyed by concept id', () => {
    const root = bundle({ 'tables/orders.md': orders });

    const graph = buildBundleGraph(root);

    expect(graph.bodies['tables/orders']).toContain('The orders table.');
  });

  it('returns the distinct sorted set of concept types', () => {
    const root = bundle({
      'tables/orders.md': orders,
      'tables/customers.md': customers,
      'datasets/sales.md': salesDataset,
    });

    const graph = buildBundleGraph(root);

    expect(graph.types).toEqual(['BigQuery Dataset', 'BigQuery Table']);
  });

  it('defaults missing frontmatter fields (type/title/tags) sensibly', () => {
    const root = bundle({
      'notes/mystery.md':
        '---\ndescription: Undated note.\n---\n\nNo type or title set.',
    });

    const graph = buildBundleGraph(root);

    expect(graph.nodes[0].data).toMatchObject({
      id: 'notes/mystery',
      label: 'notes/mystery',
      type: 'Unknown',
      tags: [],
    });
  });

  it('skips a concept file whose frontmatter fails to parse, without throwing', () => {
    const root = bundle({
      'tables/orders.md': orders,
      'tables/broken.md':
        '---\ntitle: "unterminated\n---\n\nBroken frontmatter.',
    });

    const graph = buildBundleGraph(root);

    expect(graph.nodes.map((n) => n.data.id)).toEqual(['tables/orders']);
  });

  it('never emits an edge to a link target outside the concept set', () => {
    const root = bundle({
      'tables/orders.md': orders, // links to customers.md and ../datasets/sales.md, neither present
    });

    const graph = buildBundleGraph(root);

    expect(graph.edges).toHaveLength(0);
  });

  it('throws when the bundle directory does not exist', () => {
    expect(() => buildBundleGraph('/nonexistent/okf-bundle-root')).toThrow(
      /Bundle directory not found/,
    );
  });
});
