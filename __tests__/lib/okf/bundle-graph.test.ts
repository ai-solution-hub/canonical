import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

  it('skips markdown under a dot-directory — bundle tooling is not a concept', () => {
    // id-439: a bundle is a git clone (DR-016) and may carry checked-in
    // tooling. THREE surfaces share this rule: the `/okf` explorer
    // (`walk-bundle-tree.ts`) and the producer (`_has_dotted_segment`) both
    // already had it; the viewer did not. S551 measured the producer's twin
    // on a real run — `.claude/skills/validate/SKILL.md` was enumerated as a
    // concept and then reported removed.
    const root = bundle({
      'tables/orders.md': orders,
      '.claude/skills/validate/SKILL.md': customers,
      '.github/PULL_REQUEST_TEMPLATE.md': customers,
      '.hidden-note.md': customers,
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

  // ID-427 {427.11} (DR-027 as amended S546): the producer's
  // `ontology.json` payload is now `{ overlay: ... }` — the `base` key
  // retired. Both fixtures below carried `base: {}` and have been restaged
  // onto the shipped shape, so these assertions exercise the read against
  // what the writer actually emits rather than against a payload no
  // producer produces any more. The signal itself is unchanged:
  // `readBundleClassSignal` only ever tested for the presence and nullness
  // of `overlay`.
  it('carries a "platform" bundleClass when ontology.json ships a null overlay', () => {
    const root = bundle({
      'tables/orders.md': orders,
      'ontology.json': JSON.stringify({ overlay: null }),
    });

    const graph = buildBundleGraph(root);

    expect(graph.nodes[0].data.bundleClass).toBe('platform');
  });

  it('carries a "client" bundleClass when ontology.json ships a non-null overlay', () => {
    const root = bundle({
      'tables/orders.md': orders,
      'ontology.json': JSON.stringify({
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

  // ────────────────────────────────────────
  // S550 — the concept-type declaration channel is RETIRED at the BUILDER.
  //
  // These REPLACE the ID-427 {427.14} `typeDeclaration` tests (which had
  // themselves replaced three `iriScope` tests). The owner ruling retired
  // the channel as partly COLLINEAR with `bundleClass` — already the node
  // SHAPE — so the assertion inverts: the builder must emit nothing for it,
  // while still reading the same artefact for the signal that stayed.
  // ────────────────────────────────────────

  it('emits no concept-type declaration, even when the overlay declares that exact type', () => {
    // The retired channel's AFFIRMATIVE case: `BigQuery Table` is in the
    // client's declared vocabulary, so this is the node the old channel gave
    // its declared-type border. Asserting the KEY is absent (rather than
    // that its value changed) is what makes this fail against a half-done
    // retirement that deletes the resolver but leaves the field behind.
    const root = bundle({
      'tables/orders.md': orders, // type: BigQuery Table
      'ontology.json': JSON.stringify({
        overlay: {
          source: 'ontology-overlay.json',
          sha256: 'a'.repeat(64),
          concept_types: ['BigQuery Table'],
          entity_types: [],
          relationship_types: [],
        },
      }),
    });

    const node = buildBundleGraph(root).nodes[0].data;

    expect(node).not.toHaveProperty('typeDeclaration');
    // The node still carries every channel that SURVIVED, so this test
    // fails if the retirement took a neighbour with it.
    expect(node).toMatchObject({ bundleClass: 'client', opacity: 1 });
  });

  it('still reads the overlay it stopped looking inside — a declaring bundle is still classed "client"', () => {
    // `ontology.json`'s `overlay` key carried TWO consumer meanings and only
    // one retired ({427.11} deliberately preserved `overlay: null` for OV-10
    // "no overlay shipped yet"). If the retirement over-deleted the read,
    // every client bundle would answer 'unknown' and the node SHAPE channel
    // would go silently with it.
    const declaring = bundle({
      'tables/orders.md': orders,
      'ontology.json': JSON.stringify({
        overlay: { concept_types: ['BigQuery Table'] },
      }),
    });
    expect(buildBundleGraph(declaring).nodes[0].data.bundleClass).toBe(
      'client',
    );

    // A shape this reader did not expect must still degrade, never throw —
    // the `overlay` half echoes a CLIENT-authored file.
    const malformed = bundle({
      'tables/orders.md': orders,
      'ontology.json': JSON.stringify({
        overlay: { concept_types: 'BigQuery Table' },
      }),
    });
    expect(buildBundleGraph(malformed).nodes[0].data.bundleClass).toBe(
      'client',
    );
  });
});

// ────────────────────────────────────────
// OKF v0.2 sources[] provenance (id-439, S546 rulings + id-426 emission
// contract): cites edges derive from sources[] bundle-path entries;
// the # Citations trailer split survives as the v0.1 fallback (§13.1).
// ────────────────────────────────────────

describe('buildBundleGraph — OKF v0.2 sources[] (id-439)', () => {
  const REPO_ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
  );

  const v02Concept = [
    '---',
    'type: topic',
    'title: Data Encryption',
    'description: Encryption at rest and in transit.',
    'generated:',
    '  by: kh-concept-producer/claude-sonnet-4-5',
    '  at: "2026-08-08T12:00:00Z"',
    'sources:',
    '  - id: src-handbook',
    '    resource: "canonical://source_documents/3fa85f64-5717-4562-b3fc-2c963f66afa6"',
    '    title: Security Handbook',
    '  - id: src-standard',
    '    resource: "https://example.com/iso-27001"',
    '  - id: src-cert',
    '    resource: "/tables/customers.md"',
    'tags: [security]',
    '---',
    '',
    'Encrypted at rest[^src-handbook]. Also mentions [orders](/tables/orders.md)',
    'inline.',
    '',
    '[^src-handbook]: Security Handbook, §3.',
  ].join('\n');

  it('derives a cites edge from a sources[] bundle-path entry, never from canonical:// or https entries', () => {
    const root = bundle({
      'topics/encryption.md': v02Concept,
      'tables/customers.md': customers,
      'tables/orders.md': orders,
    });

    const graph = buildBundleGraph(root);
    const fromConcept = graph.edges.filter(
      (e) => e.data.source === 'topics/encryption',
    );
    const byTarget = Object.fromEntries(
      fromConcept.map((e) => [e.data.target, e.data.relationship]),
    );

    expect(byTarget['tables/customers']).toBe('cites');
    expect(byTarget['tables/orders']).toBe('related');
    expect(fromConcept).toHaveLength(2); // nothing minted for the canonical:// or https sources
  });

  it('keeps link extraction intact in a body carrying [^id] footnote markers and definitions', () => {
    const root = bundle({
      'topics/encryption.md': v02Concept,
      'tables/orders.md': orders,
    });

    const graph = buildBundleGraph(root);
    const fromConcept = graph.edges.filter(
      (e) => e.data.source === 'topics/encryption',
    );

    // The inline body link still resolves; the footnote marker/definition
    // lines mint no edges of their own (they carry no ](…) link shape).
    expect(fromConcept).toHaveLength(1);
    expect(fromConcept[0].data).toMatchObject({
      target: 'tables/orders',
      relationship: 'related',
    });
  });

  it('treats sources[] as authoritative over a leftover # Citations trailer: trailer links type related, not cites', () => {
    const hybrid = [
      '---',
      'type: topic',
      'title: Hybrid',
      'description: Sources present AND a legacy trailer.',
      'sources:',
      '  - id: src-cert',
      '    resource: "/tables/customers.md"',
      '---',
      '',
      'Body prose.',
      '',
      '# Citations',
      '',
      '[1] [Orders](/tables/orders.md)',
    ].join('\n');
    const root = bundle({
      'topics/hybrid.md': hybrid,
      'tables/customers.md': customers,
      'tables/orders.md': orders,
    });

    const graph = buildBundleGraph(root);
    const byTarget = Object.fromEntries(
      graph.edges
        .filter((e) => e.data.source === 'topics/hybrid')
        .map((e) => [e.data.target, e.data.relationship]),
    );

    expect(byTarget['tables/customers']).toBe('cites'); // from sources[]
    expect(byTarget['tables/orders']).toBe('related'); // trailer demoted — sources[] is authoritative
  });

  it('still types legacy v0.1 trailer links as cites when sources[] is absent (§13.1 fallback)', () => {
    const legacy = [
      '---',
      'type: topic',
      'title: Legacy',
      'description: No sources frontmatter.',
      '---',
      '',
      'Body prose.',
      '',
      '# Citations',
      '',
      '[1] [Customers](/tables/customers.md)',
    ].join('\n');
    const root = bundle({
      'topics/legacy.md': legacy,
      'tables/customers.md': customers,
    });

    const graph = buildBundleGraph(root);

    expect(graph.edges[0].data).toMatchObject({
      source: 'topics/legacy',
      target: 'tables/customers',
      relationship: 'cites',
    });
  });

  it("carries each node's sources[] entries for the detail surface, and [] for a legacy concept", () => {
    const root = bundle({
      'topics/encryption.md': v02Concept,
      'tables/orders.md': orders,
    });

    const graph = buildBundleGraph(root);
    const byId = Object.fromEntries(
      graph.nodes.map((n) => [n.data.id, n.data]),
    );

    expect(byId['topics/encryption'].sources).toEqual([
      {
        id: 'src-handbook',
        resource:
          'canonical://source_documents/3fa85f64-5717-4562-b3fc-2c963f66afa6',
        title: 'Security Handbook',
      },
      { id: 'src-standard', resource: 'https://example.com/iso-27001' },
      { id: 'src-cert', resource: '/tables/customers.md' },
    ]);
    expect(byId['tables/orders'].sources).toEqual([]);
  });

  it('drops malformed sources[] entries without rejecting the concept (§11 tolerance)', () => {
    const sloppy = [
      '---',
      'type: topic',
      'title: Sloppy',
      'description: Malformed source entries.',
      'sources:',
      '  - not-a-mapping',
      '  - id: no-resource-at-all',
      '  - id: 7',
      '    resource: "/tables/customers.md"',
      '---',
      '',
      'Body.',
    ].join('\n');
    const root = bundle({
      'topics/sloppy.md': sloppy,
      'tables/customers.md': customers,
    });

    const graph = buildBundleGraph(root);
    const node = graph.nodes.find((n) => n.data.id === 'topics/sloppy');

    // Only the well-formed entry survives (YAML numeric id coerced to a string).
    expect(node?.data.sources).toEqual([
      { id: '7', resource: '/tables/customers.md' },
    ]);
    expect(graph.edges[0].data).toMatchObject({
      source: 'topics/sloppy',
      target: 'tables/customers',
      relationship: 'cites',
    });
  });

  it('walks BOTH on-disk fixture generations in one bundle — the v0.2 and v0.1 concepts each parse and mint their cites', () => {
    const v02Fixture = readFileSync(
      path.resolve(REPO_ROOT, '__tests__/fixtures/okf/concept-v02-sources.md'),
      'utf8',
    );
    const v01Fixture = readFileSync(
      path.resolve(REPO_ROOT, '__tests__/fixtures/okf/concept-v01-legacy.md'),
      'utf8',
    );
    const certTarget = [
      '---',
      'type: certification',
      'title: ISO 27001',
      'description: Information security management certification.',
      '---',
      '',
      'The certification concept.',
    ].join('\n');
    const root = bundle({
      'topics/encryption-v02.md': v02Fixture,
      'topics/encryption-v01.md': v01Fixture,
      'certifications/iso-27001.md': certTarget,
    });

    const graph = buildBundleGraph(root);
    const ids = graph.nodes.map((n) => n.data.id);
    expect(ids).toContain('topics/encryption-v02');
    expect(ids).toContain('topics/encryption-v01');

    const relationships = Object.fromEntries(
      graph.edges.map((e) => [e.data.source, e.data.relationship]),
    );
    // v0.2: cites from sources[]; v0.1: cites from the trailer split.
    expect(relationships['topics/encryption-v02']).toBe('cites');
    expect(relationships['topics/encryption-v01']).toBe('cites');
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
