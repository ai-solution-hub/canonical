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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConceptGraph } from '@/components/okf/concept-graph';
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
  });

  it('derives per-node shape (bundleClass) and border colour (iriScope), and per-edge colour (relationship) into the Cytoscape element data', () => {
    // jsdom never loads app/styles/domain-tokens.css — set the custom
    // properties directly so resolveIriScopeBorderColor/
    // resolveEdgeRelationshipColor have something real to resolve (mirrors
    // lib/okf/concept-type-tokens.test.ts's own pattern).
    document.documentElement.style.setProperty(
      '--okf-graph-iri-base-border',
      'oklch(0.55 0.12 240)',
    );
    document.documentElement.style.setProperty(
      '--okf-graph-iri-client-border',
      'oklch(0.55 0.15 290)',
    );
    document.documentElement.style.setProperty(
      '--okf-graph-edge-cites',
      'oklch(0.55 0.15 195)',
    );

    const nodesWithUnionFields: OkfBundleGraphNode[] = [
      {
        data: {
          ...NODES[0].data,
          bundleClass: 'client',
          iriScope: 'base',
        },
      },
      {
        data: {
          ...NODES[1].data,
          bundleClass: 'platform',
          iriScope: 'client',
        },
      },
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
    expect(orders?.data.borderColor).not.toBe(customers?.data.borderColor);
    expect(edge?.data.edgeColor).toBeTruthy();
  });
});
