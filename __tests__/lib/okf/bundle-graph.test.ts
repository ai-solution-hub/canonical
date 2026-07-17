import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildBundleGraph,
  buildUnionBundleGraph,
  confidenceToOpacity,
} from '@/lib/okf/bundle-graph';

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

  it('defaults bundleId to the resolved directory basename when omitted', () => {
    const root = bundle({ 'tables/orders.md': orders });

    const graph = buildBundleGraph(root);

    expect(graph.nodes[0].data.bundleId).toBe(path.basename(root));
  });

  it('accepts an explicit bundleId, tagging every node with it', () => {
    const root = bundle({
      'tables/orders.md': orders,
      'tables/customers.md': customers,
    });

    const graph = buildBundleGraph(root, { bundleId: 'acme-client' });

    expect(graph.nodes.every((n) => n.data.bundleId === 'acme-client')).toBe(
      true,
    );
  });

  it('carries per-node A19 confidence + derived opacity, defaulting to full-opacity when absent', () => {
    const strongConcept = [
      '---',
      'type: topic',
      'title: Strong',
      'confidence: strong',
      '---',
      '',
      'Body.',
    ].join('\n');
    const partialConcept = [
      '---',
      'type: topic',
      'title: Partial',
      'confidence: partial',
      '---',
      '',
      'Body.',
    ].join('\n');
    const root = bundle({
      'topics/strong.md': strongConcept,
      'topics/partial.md': partialConcept,
      'tables/orders.md': orders, // no confidence frontmatter at all
    });

    const graph = buildBundleGraph(root);
    const byId = Object.fromEntries(
      graph.nodes.map((n) => [n.data.id, n.data]),
    );

    expect(byId['topics/strong'].confidence).toBe('strong');
    expect(byId['topics/strong'].opacity).toBe(1);
    expect(byId['topics/partial'].confidence).toBe('partial');
    expect(byId['topics/partial'].opacity).toBeLessThan(1);
    expect(byId['tables/orders'].confidence).toBeNull();
    expect(byId['tables/orders'].opacity).toBe(1);
  });

  it('types a link found in the # Citations trailer as "cites" and any other internal link as "related"', () => {
    const citing = [
      '---',
      'type: topic',
      'title: Quality Management',
      '---',
      '',
      'Mentions [orders](/tables/orders.md) inline.',
      '',
      '# Citations',
      '',
      '[1] [Customers](/tables/customers.md)',
    ].join('\n');
    const root = bundle({
      'topics/quality.md': citing,
      'tables/orders.md': orders,
      'tables/customers.md': customers,
    });

    const graph = buildBundleGraph(root);
    const byTarget = Object.fromEntries(
      graph.edges
        .filter((e) => e.data.source === 'topics/quality')
        .map((e) => [e.data.target, e.data.relationship]),
    );

    expect(byTarget['tables/orders']).toBe('related');
    expect(byTarget['tables/customers']).toBe('cites');
  });

  it('types a citations-trailer link as "cites" even when the same target is ALSO mentioned inline', () => {
    const citing = [
      '---',
      'type: topic',
      'title: Quality Management',
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
    });

    const graph = buildBundleGraph(root);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].data).toMatchObject({
      source: 'topics/quality',
      target: 'tables/customers',
      relationship: 'cites',
    });
  });

  it('carries a "platform" bundleClass when ontology.json ships a null overlay', () => {
    const root = bundle({
      'tables/orders.md': orders,
      'ontology.json': JSON.stringify({ base: {}, overlay: null }),
    });

    const graph = buildBundleGraph(root);

    expect(graph.nodes[0].data.bundleClass).toBe('platform');
  });

  it('carries a "client" bundleClass when ontology.json ships a non-null overlay', () => {
    const root = bundle({
      'tables/orders.md': orders,
      'ontology.json': JSON.stringify({
        base: {},
        overlay: { concept_types: ['bespoke_type'] },
      }),
    });

    const graph = buildBundleGraph(root);

    expect(graph.nodes[0].data.bundleClass).toBe('client');
  });

  it('carries an "unknown" bundleClass when ontology.json is absent', () => {
    const root = bundle({ 'tables/orders.md': orders });

    const graph = buildBundleGraph(root);

    expect(graph.nodes[0].data.bundleClass).toBe('unknown');
  });

  it('carries an "unknown" bundleClass without throwing when ontology.json is malformed', () => {
    const root = bundle({
      'tables/orders.md': orders,
      'ontology.json': '{not valid json',
    });

    const graph = buildBundleGraph(root);

    expect(graph.nodes[0].data.bundleClass).toBe('unknown');
  });

  it('projects a node\'s type to iriScope "base" via context.jsonld\'s @context (bl-457/DR-082)', () => {
    const root = bundle({
      'tables/orders.md': orders, // type: BigQuery Table
      'context.jsonld': JSON.stringify({
        '@context': {
          base: 'https://w3id.org/canonical/ontology/base#',
          'BigQuery Table':
            'https://w3id.org/canonical/ontology/base#BigQuery Table',
        },
      }),
    });

    const graph = buildBundleGraph(root);

    expect(graph.nodes[0].data.iriScope).toBe('base');
  });

  it('projects a node\'s type to iriScope "client" when its minted IRI sits under the client namespace', () => {
    const root = bundle({
      'tables/orders.md': orders,
      'context.jsonld': JSON.stringify({
        '@context': {
          base: 'https://w3id.org/canonical/ontology/base#',
          client: 'https://w3id.org/canonical/ontology/client/acme#',
          'BigQuery Table':
            'https://w3id.org/canonical/ontology/client/acme#BigQuery Table',
        },
      }),
    });

    const graph = buildBundleGraph(root);

    expect(graph.nodes[0].data.iriScope).toBe('client');
  });

  it('projects iriScope "unmapped" when context.jsonld is absent, or the type has no @context entry', () => {
    const rootAbsent = bundle({ 'tables/orders.md': orders });
    expect(buildBundleGraph(rootAbsent).nodes[0].data.iriScope).toBe(
      'unmapped',
    );

    const rootNoEntry = bundle({
      'tables/orders.md': orders,
      'context.jsonld': JSON.stringify({
        '@context': { base: 'https://w3id.org/canonical/ontology/base#' },
      }),
    });
    expect(buildBundleGraph(rootNoEntry).nodes[0].data.iriScope).toBe(
      'unmapped',
    );
  });
});

describe('confidenceToOpacity', () => {
  it('renders full-opacity for an absent confidence', () => {
    expect(confidenceToOpacity(null)).toBe(1);
    expect(confidenceToOpacity(undefined)).toBe(1);
  });

  it('renders full-opacity for the "strong" tier', () => {
    expect(confidenceToOpacity('strong')).toBe(1);
  });

  it('dims the "partial" tier below full-opacity', () => {
    expect(confidenceToOpacity('partial')).toBeLessThan(1);
    expect(confidenceToOpacity('partial')).toBeGreaterThan(0);
  });

  it('dims "no-content" and "needs-SME" at least as much as "partial"', () => {
    expect(confidenceToOpacity('no-content')).toBeLessThanOrEqual(
      confidenceToOpacity('partial'),
    );
    expect(confidenceToOpacity('needs-SME')).toBeLessThanOrEqual(
      confidenceToOpacity('partial'),
    );
  });

  it('never throws on an unrecognised value — falls back to full-opacity', () => {
    expect(confidenceToOpacity('some-future-A19-value')).toBe(1);
  });
});

describe('buildUnionBundleGraph', () => {
  it('returns an empty graph (never throws) for zero bundle sources', () => {
    expect(buildUnionBundleGraph([])).toEqual({
      nodes: [],
      edges: [],
      bodies: {},
      types: [],
    });
  });

  it('namespaces a single bundle source (one-bundle fallback)', () => {
    const root = bundle({ 'tables/orders.md': orders });

    const graph = buildUnionBundleGraph([{ bundleId: 'only-client', root }]);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].data.id).toBe('only-client::tables/orders');
    expect(graph.nodes[0].data.bundleId).toBe('only-client');
    expect(graph.bodies['only-client::tables/orders']).toContain(
      'The orders table.',
    );
  });

  it('namespaces node AND edge ids by bundleId across multiple bundles, with no id collisions', () => {
    const rootA = bundle({
      'tables/orders.md': orders,
      'tables/customers.md': customers,
    });
    const rootB = bundle({ 'tables/orders.md': orders }); // same relative concept id as rootA, deliberately

    const graph = buildUnionBundleGraph([
      { bundleId: 'client-a', root: rootA },
      { bundleId: 'client-b', root: rootB },
    ]);

    const ids = graph.nodes.map((n) => n.data.id);
    expect(ids).toContain('client-a::tables/orders');
    expect(ids).toContain('client-b::tables/orders');
    expect(new Set(ids).size).toBe(ids.length); // no collisions despite the shared relative id

    const edgeIds = graph.edges.map(
      (e) => `${e.data.source}->${e.data.target}`,
    );
    expect(edgeIds).toContain(
      'client-a::tables/orders->client-a::tables/customers',
    );
  });

  it('merges the distinct sorted type set across every bundle in the union', () => {
    const rootA = bundle({ 'tables/orders.md': orders }); // type: BigQuery Table
    const rootB = bundle({ 'datasets/sales.md': salesDataset }); // type: BigQuery Dataset

    const graph = buildUnionBundleGraph([
      { bundleId: 'client-a', root: rootA },
      { bundleId: 'client-b', root: rootB },
    ]);

    expect(graph.types).toEqual(['BigQuery Dataset', 'BigQuery Table']);
  });

  it('skips a missing/non-existent bundle root without throwing or breaking the rest of the union', () => {
    const rootA = bundle({ 'tables/orders.md': orders });

    const graph = buildUnionBundleGraph([
      { bundleId: 'client-a', root: rootA },
      { bundleId: 'ghost-client', root: '/nonexistent/okf-bundle-root' },
    ]);

    expect(graph.nodes.map((n) => n.data.id)).toEqual([
      'client-a::tables/orders',
    ]);
  });
});
