/**
 * <ConceptGraph> — the Cytoscape canvas wrapper. jsdom has no canvas 2D
 * context, so real Cytoscape rendering is out of scope here (that is
 * verified by manual/E2E browser verification, not this unit). What IS
 * verified: the component builds the right elements from props, wires tap
 * selection to `onSelectConcept`, and drives search/type-filter/layout/reset
 * through the real Cytoscape imperative API — against a lightweight fake
 * `cytoscape()` factory that reproduces just the collection/element methods
 * the component calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { ConceptGraph } from '@/components/okf/concept-graph';
import { buildBundleGraph } from '@/lib/okf/bundle-graph';
import type { OkfBundleGraphEdge, OkfBundleGraphNode } from '@/lib/query/okf';

// ---------------------------------------------------------------------------
// Fake cytoscape() factory
// ---------------------------------------------------------------------------

interface FakeElement {
  data: (key?: string) => unknown;
  id: () => string;
  toggleClass: (cls: string, val: boolean) => void;
  hasClass: (cls: string) => boolean;
  select: () => void;
  unselect: () => void;
  source?: () => FakeElement;
  target?: () => FakeElement;
  length: number;
}

const { cytoscapeCalls, layoutCalls, fitCalls, destroyCalls, cyInstances } =
  vi.hoisted(() => ({
    cytoscapeCalls: [] as unknown[],
    layoutCalls: [] as unknown[],
    fitCalls: [] as unknown[],
    destroyCalls: [] as unknown[],
    cyInstances: [] as {
      __tapNode: (id: string) => void;
      __isDimmed: (id: string) => boolean;
    }[],
  }));

function makeFakeElement(rawData: Record<string, unknown>): FakeElement {
  const classes = new Set<string>();
  const el: FakeElement = {
    data: (key?: string) => (key ? rawData[key] : rawData),
    id: () => rawData.id as string,
    toggleClass: vi.fn((cls: string, val: boolean) => {
      if (val) classes.add(cls);
      else classes.delete(cls);
    }),
    hasClass: (cls: string) => classes.has(cls),
    select: vi.fn(),
    unselect: vi.fn(),
    length: 1,
  };
  return el;
}

function fakeCytoscapeFactory(opts: {
  container: HTMLElement;
  elements: { data: Record<string, unknown> }[];
}) {
  cytoscapeCalls.push(opts);

  const nodeEls = new Map<string, FakeElement>();
  const edgeEls = new Map<string, FakeElement>();
  for (const el of opts.elements) {
    if ('source' in el.data && 'target' in el.data) {
      edgeEls.set(el.data.id as string, makeFakeElement(el.data));
    } else {
      nodeEls.set(el.data.id as string, makeFakeElement(el.data));
    }
  }
  for (const edge of edgeEls.values()) {
    const data = edge.data() as { source: string; target: string };
    edge.source = () => nodeEls.get(data.source) as FakeElement;
    edge.target = () => nodeEls.get(data.target) as FakeElement;
  }

  const tapNodeHandlers: ((evt: { target: FakeElement }) => void)[] = [];
  const tapHandlers: ((evt: { target: unknown }) => void)[] = [];

  const collection = (map: Map<string, FakeElement>) => ({
    forEach: (fn: (el: FakeElement) => void) => map.forEach(fn),
    removeClass: (cls: string) => {
      map.forEach((el) => el.toggleClass(cls, false));
    },
    unselect: () => {
      map.forEach((el) => el.unselect());
    },
  });

  const cy = {
    on: (
      event: string,
      selectorOrHandler: string | ((evt: { target: unknown }) => void),
      handler?: (evt: { target: FakeElement }) => void,
    ) => {
      if (event === 'tap' && typeof selectorOrHandler === 'string' && handler) {
        tapNodeHandlers.push(handler);
      } else if (event === 'tap' && typeof selectorOrHandler === 'function') {
        tapHandlers.push(selectorOrHandler);
      }
    },
    nodes: () => collection(nodeEls),
    edges: () => collection(edgeEls),
    elements: () => ({
      ...collection(new Map([...nodeEls, ...edgeEls])),
      unselect: () => {
        nodeEls.forEach((el) => el.unselect());
        edgeEls.forEach((el) => el.unselect());
      },
    }),
    getElementById: (id: string) =>
      nodeEls.get(id) ?? edgeEls.get(id) ?? { length: 0 },
    layout: (layoutOpts: unknown) => {
      layoutCalls.push(layoutOpts);
      return { run: vi.fn() };
    },
    fit: (...args: unknown[]) => fitCalls.push(args),
    destroy: () => destroyCalls.push(true),
    // Test-only escape hatches for simulating user interaction.
    __tapNode: (id: string) => {
      const el = nodeEls.get(id);
      if (el) tapNodeHandlers.forEach((h) => h({ target: el }));
    },
    __isDimmed: (id: string) =>
      (nodeEls.get(id) ?? edgeEls.get(id))?.hasClass('dim') ?? false,
  };

  cyInstances.push(cy);
  return cy;
}

vi.mock('cytoscape', () => ({
  default: (opts: Parameters<typeof fakeCytoscapeFactory>[0]) =>
    fakeCytoscapeFactory(opts),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NODES: OkfBundleGraphNode[] = [
  {
    data: {
      id: 'tables/orders',
      label: 'Orders',
      type: 'BigQuery Table',
      description: '',
      resource: '',
      tags: ['sales'],
      size: 30,
    },
  },
  {
    data: {
      id: 'tables/customers',
      label: 'Customers',
      type: 'BigQuery Table',
      description: '',
      resource: '',
      tags: [],
      size: 30,
    },
  },
  {
    data: {
      id: 'datasets/sales',
      label: 'Sales',
      type: 'BigQuery Dataset',
      description: '',
      resource: '',
      tags: [],
      size: 30,
    },
  },
];

const EDGES: OkfBundleGraphEdge[] = [
  { data: { id: 'e1', source: 'tables/orders', target: 'tables/customers' } },
];

const TYPES = ['BigQuery Dataset', 'BigQuery Table'];

beforeEach(() => {
  cytoscapeCalls.length = 0;
  layoutCalls.length = 0;
  fitCalls.length = 0;
  destroyCalls.length = 0;
  cyInstances.length = 0;
});

describe('ConceptGraph', () => {
  it('initialises Cytoscape with a node+edge element set derived from props', () => {
    render(
      <ConceptGraph
        nodes={NODES}
        edges={EDGES}
        types={TYPES}
        selectedConceptId={null}
        onSelectConcept={vi.fn()}
      />,
    );

    expect(cytoscapeCalls).toHaveLength(1);
    const opts = cytoscapeCalls[0] as { elements: { data: { id: string } }[] };
    expect(opts.elements.map((e) => e.data.id)).toEqual([
      'tables/orders',
      'tables/customers',
      'datasets/sales',
      'e1',
    ]);
  });

  it('calls onSelectConcept when a node is tapped', () => {
    const onSelectConcept = vi.fn();
    render(
      <ConceptGraph
        nodes={NODES}
        edges={EDGES}
        types={TYPES}
        selectedConceptId={null}
        onSelectConcept={onSelectConcept}
      />,
    );

    cyInstances[0].__tapNode('tables/customers');

    expect(onSelectConcept).toHaveBeenCalledWith('tables/customers');
  });

  it('populates the type-filter select from the types prop', () => {
    render(
      <ConceptGraph
        nodes={NODES}
        edges={EDGES}
        types={TYPES}
        selectedConceptId={null}
        onSelectConcept={vi.fn()}
      />,
    );

    const select = screen.getByLabelText('Filter by type') as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual([
      'All types',
      'BigQuery Dataset',
      'BigQuery Table',
    ]);
  });

  it('re-runs layout when the layout selector changes', () => {
    render(
      <ConceptGraph
        nodes={NODES}
        edges={EDGES}
        types={TYPES}
        selectedConceptId={null}
        onSelectConcept={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Layout'), {
      target: { value: 'grid' },
    });

    expect(layoutCalls.at(-1)).toMatchObject({ name: 'grid' });
  });

  it('calls fit() and clears selection when Reset view is clicked', () => {
    render(
      <ConceptGraph
        nodes={NODES}
        edges={EDGES}
        types={TYPES}
        selectedConceptId={null}
        onSelectConcept={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));

    expect(fitCalls).toHaveLength(1);
  });

  it('dims nodes whose label/id/tags do not match the search query', () => {
    render(
      <ConceptGraph
        nodes={NODES}
        edges={EDGES}
        types={TYPES}
        selectedConceptId={null}
        onSelectConcept={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Search title / id / tag'), {
      target: { value: 'orders' },
    });

    const cy = cyInstances[0];
    expect(cy.__isDimmed('tables/orders')).toBe(false);
    expect(cy.__isDimmed('tables/customers')).toBe(true);
    expect(cy.__isDimmed('datasets/sales')).toBe(true);
  });

  it('clears dimming when the search query is emptied', () => {
    render(
      <ConceptGraph
        nodes={NODES}
        edges={EDGES}
        types={TYPES}
        selectedConceptId={null}
        onSelectConcept={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText('Search title / id / tag');
    fireEvent.change(input, { target: { value: 'orders' } });
    fireEvent.change(input, { target: { value: '' } });

    const cy = cyInstances[0];
    expect(cy.__isDimmed('tables/customers')).toBe(false);
  });

  it('dims nodes whose type does not match the type filter', () => {
    render(
      <ConceptGraph
        nodes={NODES}
        edges={EDGES}
        types={TYPES}
        selectedConceptId={null}
        onSelectConcept={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Filter by type'), {
      target: { value: 'BigQuery Dataset' },
    });

    const cy = cyInstances[0];
    expect(cy.__isDimmed('datasets/sales')).toBe(false);
    expect(cy.__isDimmed('tables/orders')).toBe(true);
    expect(cy.__isDimmed('tables/customers')).toBe(true);
  });

  it('destroys the Cytoscape instance on unmount', () => {
    const { unmount } = render(
      <ConceptGraph
        nodes={NODES}
        edges={EDGES}
        types={TYPES}
        selectedConceptId={null}
        onSelectConcept={vi.fn()}
      />,
    );

    unmount();

    expect(destroyCalls).toHaveLength(1);
  });

  it('renders the {132.49} union-doctrine legend', () => {
    render(
      <ConceptGraph
        nodes={NODES}
        edges={EDGES}
        types={TYPES}
        selectedConceptId={null}
        onSelectConcept={vi.fn()}
      />,
    );

    expect(screen.getByTestId('concept-graph-legend')).toBeInTheDocument();
    expect(screen.getByText('Client bundle')).toBeInTheDocument();
    expect(screen.getByText('Platform baseline')).toBeInTheDocument();
    expect(screen.getByText('Cites')).toBeInTheDocument();
    expect(screen.getByText('Related')).toBeInTheDocument();
    // S550: the legend dropped from FOUR channels to THREE. The retired
    // border entry must not linger — a legend that still explains a colour
    // the canvas no longer paints is worse than no legend.
    expect(screen.queryByText('Client-declared type')).not.toBeInTheDocument();
  });

  it('derives per-node shape (bundleClass) and per-edge colour (relationship) into the Cytoscape element data', () => {
    // jsdom never loads app/styles/domain-tokens.css — set the custom
    // properties directly so resolveGraphChromeColors/
    // resolveEdgeRelationshipColor have something real to resolve (mirrors
    // lib/okf/concept-type-tokens.test.ts's own pattern).
    document.documentElement.style.setProperty(
      '--okf-graph-node-fallback',
      NEUTRAL_TOKEN,
    );
    document.documentElement.style.setProperty(
      '--okf-graph-selected-border',
      SELECTED_TOKEN,
    );
    document.documentElement.style.setProperty(
      '--okf-graph-edge',
      'oklch(0.82 0.014 48)',
    );
    document.documentElement.style.setProperty(
      '--okf-graph-label',
      LABEL_TOKEN,
    );
    document.documentElement.style.setProperty(
      '--okf-graph-edge-cites',
      'oklch(0.55 0.15 195)',
    );

    const nodesWithUnionFields: OkfBundleGraphNode[] = [
      { data: { ...NODES[0].data, bundleClass: 'client' } },
      { data: { ...NODES[1].data, bundleClass: 'platform' } },
    ];
    const edgesWithRelationship: OkfBundleGraphEdge[] = [
      { data: { ...EDGES[0].data, relationship: 'cites' } },
    ];

    render(
      <ConceptGraph
        nodes={nodesWithUnionFields}
        edges={edgesWithRelationship}
        types={TYPES}
        selectedConceptId={null}
        onSelectConcept={vi.fn()}
      />,
    );

    const opts = cytoscapeCalls[0] as {
      elements: { data: Record<string, unknown> }[];
    };
    const orders = opts.elements.find((e) => e.data.id === 'tables/orders');
    const customers = opts.elements.find(
      (e) => e.data.id === 'tables/customers',
    );
    const edge = opts.elements.find((e) => e.data.id === 'e1');

    expect(orders?.data.shape).toBe('ellipse');
    expect(customers?.data.shape).toBe('round-rectangle');
    expect(edge?.data.edgeColor).toBeTruthy();
    // S550: `borderColor` was the retired channel's per-node payload. It is
    // gone from element data entirely — the border is now a static value on
    // the stylesheet's base `node` rule (asserted at the render site below).
    expect(orders?.data).not.toHaveProperty('borderColor');
    expect(customers?.data).not.toHaveProperty('borderColor');
  });
});

// ---------------------------------------------------------------------------
// S550 — the typeDeclaration border channel is RETIRED, proved at the RENDER
// SITE over a real bundle.
//
// This block INVERTS the {427.14} block it replaces, and keeps its method for
// the same reason {427.6} taught: a mapping function's own unit test stayed
// green through the whole {427.5} regression while the render site was where
// the meaning was lost. Asserting that a deleted export is deleted proves
// almost nothing — a `data(borderColor)` mapper left in the Cytoscape
// stylesheet would still type-check, and Cytoscape resolves that string at
// RUNTIME. So this block runs the WHOLE chain — an `ontology.json` on disk ->
// `buildBundleGraph` -> `<ConceptGraph>` -> the style array and element data
// handed to Cytoscape — with the retired signal deliberately made LIVE and
// affirmative, and asserts nothing downstream can spend it.
// ---------------------------------------------------------------------------

// The token the retired channel used to paint. Nothing should read it now;
// these tests define it anyway, so "the channel is gone" is proved against a
// stylesheet that could still feed it rather than against its absence.
const DECLARED_TOKEN = 'oklch(0.55 0.15 290)';
const NEUTRAL_TOKEN = 'oklch(0.65 0.012 48)';
const SELECTED_TOKEN = 'oklch(0.6 0.14 70)';
const LABEL_TOKEN = 'oklch(0.25 0.016 48)';

interface CyStyleRule {
  selector: string;
  style: Record<string, unknown>;
}

/** The style array `<ConceptGraph>` handed to Cytoscape on the current render. */
function styleRuleFor(selector: string): CyStyleRule {
  const rules = (cytoscapeCalls[0] as { style: CyStyleRule[] }).style;
  const rule = rules.find((r) => r.selector === selector);
  if (!rule) throw new Error(`no \`${selector}\` rule in the Cytoscape style`);
  return rule;
}

const conceptDoc = (title: string, type: string) =>
  [
    '---',
    `type: ${type}`,
    `title: ${title}`,
    'description: .',
    '---',
    '',
    '.',
  ].join('\n');

describe('ConceptGraph — a node border is chrome now, and carries no concept-type signal', () => {
  const roots: string[] = [];

  function bundleWithOverlay(declaredConceptTypes: string[] | null): string {
    const root = mkdtempSync(nodePath.join(tmpdir(), 'okf-concept-graph-'));
    roots.push(root);
    mkdirSync(nodePath.join(root, 'concepts'), { recursive: true });
    writeFileSync(
      nodePath.join(root, 'concepts', 'alpha.md'),
      conceptDoc('Alpha', 'bid_response'),
      'utf-8',
    );
    writeFileSync(
      nodePath.join(root, 'concepts', 'beta.md'),
      conceptDoc('Beta', 'topic'),
      'utf-8',
    );
    writeFileSync(
      nodePath.join(root, 'ontology.json'),
      JSON.stringify({
        overlay:
          declaredConceptTypes === null
            ? null
            : {
                source: 'ontology-overlay.json',
                sha256: 'c'.repeat(64),
                concept_types: declaredConceptTypes,
                entity_types: [],
                relationship_types: [],
              },
      }),
      'utf-8',
    );
    return root;
  }

  function renderBundle(root: string) {
    const graph = buildBundleGraph(root);
    render(
      <ConceptGraph
        nodes={graph.nodes as OkfBundleGraphNode[]}
        edges={graph.edges as OkfBundleGraphEdge[]}
        types={graph.types}
        selectedConceptId={null}
        onSelectConcept={vi.fn()}
      />,
    );
    return (
      cytoscapeCalls[0] as { elements: { data: Record<string, unknown> }[] }
    ).elements;
  }

  beforeEach(() => {
    document.documentElement.style.setProperty(
      '--okf-graph-node-fallback',
      NEUTRAL_TOKEN,
    );
    document.documentElement.style.setProperty(
      '--okf-graph-selected-border',
      SELECTED_TOKEN,
    );
    document.documentElement.style.setProperty(
      '--okf-graph-edge',
      'oklch(0.82 0.014 48)',
    );
    document.documentElement.style.setProperty(
      '--okf-graph-label',
      LABEL_TOKEN,
    );
    // Deliberately DEFINED, though nothing should read it — see the block
    // comment above. The retirement is proved against a live token.
    document.documentElement.style.setProperty(
      '--okf-graph-type-declared-border',
      DECLARED_TOKEN,
    );
  });

  afterEach(() => {
    while (roots.length > 0) {
      const root = roots.pop();
      if (root) rmSync(root, { recursive: true, force: true });
    }
  });

  it('states one flat neutral border on the base node rule, not a per-node data mapper', () => {
    renderBundle(bundleWithOverlay(['bid_response']));
    const node = styleRuleFor('node');

    // The border is now CHROME: one resolved colour for every node.
    expect(node.style['border-color']).toBe(NEUTRAL_TOKEN);
    // The retired channel's exact shape. Cytoscape resolves a `data(...)`
    // mapper at RUNTIME from a string, so a leftover would survive both the
    // type-checker and any assertion about deleted exports.
    expect(node.style['border-color']).not.toBe('data(borderColor)');
    // And the colour must be STATED, not omitted: Cytoscape defaults
    // `border-color` to `#000`, so dropping it while keeping a non-zero
    // `border-width` paints a black ring on every node — the accidentally
    // inherited border this retirement must not produce.
    expect(node.style['border-width']).toBe(2);
    expect(node.style['border-color']).toBeTruthy();
  });

  it('states the node LABEL colour, so Cytoscape cannot fall through to its #000 default', () => {
    // S550, from a real-browser contrast review: the style array set every
    // text property EXCEPT `color`, so Cytoscape's own `'#000'` default
    // applied and dark-mode labels measured 1.12:1 against the canvas —
    // effectively unreadable. This is the SAME hazard the sibling
    // `border-color` assertion above guards, which is why it is asserted the
    // same way: the colour must be STATED, and must be the resolved token
    // rather than an omission or a per-node mapper.
    renderBundle(bundleWithOverlay(['bid_response']));
    const node = styleRuleFor('node');

    expect(node.style.label).toBe('data(label)');
    expect(node.style.color).toBe(LABEL_TOKEN);
    expect(node.style.color).toBeTruthy();
    // Never Cytoscape's default, whatever the token happens to resolve to.
    expect(node.style.color).not.toBe('#000');
    expect(node.style.color).not.toBe('#000000');
    // Chrome, not a channel: one colour for every node, not a data mapper.
    expect(node.style.color).not.toBe('data(labelColor)');
  });

  it('ADVERSARIAL — a bundle that DOES declare the concept type still reaches the canvas neutral', () => {
    // Every link in the chain is live and the retired signal is affirmative:
    // `ontology.json` declares `bid_response`, `concepts/alpha` IS of that
    // type, and `--okf-graph-type-declared-border` is defined in the
    // document (see beforeEach). Under the old channel this node wore
    // DECLARED_TOKEN. If any link — producer read, builder, component,
    // stylesheet — still carried the channel, this is where it would show.
    const elements = renderBundle(bundleWithOverlay(['bid_response']));

    expect(styleRuleFor('node').style['border-color']).toBe(NEUTRAL_TOKEN);
    expect(styleRuleFor('node').style['border-color']).not.toBe(DECLARED_TOKEN);
    // Nothing per-node survives to feed a border either.
    for (const el of elements) {
      expect(el.data).not.toHaveProperty('borderColor');
      expect(el.data).not.toHaveProperty('typeDeclaration');
    }
  });

  it('keeps the selected-node ring the neutral border exists to be thickened against', () => {
    // The retirement removed a channel, not the selection affordance. This
    // is the reason the base rule keeps a border at all, so it is asserted
    // here rather than assumed: `node:selected` is declared AFTER `node`, so
    // it still wins the cascade.
    renderBundle(bundleWithOverlay(null));
    const selected = styleRuleFor('node:selected');

    expect(selected.style['border-color']).toBe(SELECTED_TOKEN);
    expect(selected.style['border-width']).toBe(3);
    expect(selected.style['border-color']).not.toBe(
      styleRuleFor('node').style['border-color'],
    );
  });

  it('falls back to the un-themed neutral literal when the chrome tokens are undefined', () => {
    // SSR, or a environment that never loaded domain-tokens.css. The border
    // must still be a real colour string — a border resolving to '' would
    // hand Cytoscape an invalid value at the exact moment nothing else works.
    document.documentElement.style.removeProperty('--okf-graph-node-fallback');
    document.documentElement.style.removeProperty(
      '--okf-graph-selected-border',
    );
    document.documentElement.style.removeProperty('--okf-graph-edge');

    renderBundle(bundleWithOverlay(['bid_response']));

    expect(styleRuleFor('node').style['border-color']).toBe(NEUTRAL_TOKEN);
  });
});
