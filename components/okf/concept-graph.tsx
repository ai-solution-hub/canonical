'use client';

/**
 * `<ConceptGraph>` — the Cytoscape force-graph canvas (ID-132 {132.14}
 * G-VIEWER, TS port of `viz.js`'s Cytoscape wiring + `viz.html`'s
 * search/type-filter/layout/reset controls).
 *
 * Reframe A (TECH-ADDENDUM-reference-agents.md Part 2): every literal colour
 * in `viz.js`'s style block is replaced by a semantic token, resolved once
 * per node at mount/update via `resolveConceptTypeColor`
 * (`lib/okf/concept-type-tokens.ts`) rather than the reference's hardcoded
 * `_TYPE_PALETTE`. Selection/search/type-filter/layout/reset are the same
 * imperative Cytoscape calls as the reference, just React-effect-scoped.
 *
 * **{132.49} G-CONCEPT-GRAPH-UNION doctrine deltas.** Four additional
 * per-node/per-edge visual channels, layered onto the existing
 * `background-color`(type)/`border-color`(selection) pair so no channel
 * collides:
 *  - `bundleClass` -> node **shape** (`bundleClassShape` — a structural,
 *    non-colour channel, so no new design token).
 *  - `iriScope` (bl-457) -> node **border-color** (only when NOT selected —
 *    `node:selected` is declared after `node` in the style array, so it
 *    still wins the cascade for a selected node).
 *  - `confidence` (A19) -> node **opacity**, pre-computed server-side.
 *  - `relationship` (cites/related) -> edge **line/arrow colour**.
 * `<GraphLegend>` renders a compact key for all four so a union view (or a
 * single bundle carrying the same fields) is legible without a doc lookup.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, {
  type Core,
  type ElementDefinition,
  type NodeSingular,
} from 'cytoscape';
import {
  resolveConceptTypeColor,
  resolveGraphChromeColors,
  bundleClassShape,
  resolveIriScopeBorderColor,
  resolveEdgeRelationshipColor,
} from '@/lib/okf/concept-type-tokens';
import { cn } from '@/lib/utils';
import type { OkfBundleGraphEdge, OkfBundleGraphNode } from '@/lib/query/okf';

const LAYOUTS = [
  'cose',
  'concentric',
  'breadthfirst',
  'circle',
  'grid',
] as const;
type LayoutName = (typeof LAYOUTS)[number];

// Last-resort literals for when the `--okf-graph-*` custom properties can't
// be read (SSR, or a test environment that never loaded
// `app/styles/domain-tokens.css`) — mirror those tokens' light-mode :root
// values so the un-themed fallback still reads as the same colour family.
const FALLBACK_NODE_COLOR = 'oklch(0.65 0.012 48)'; // --okf-graph-node-fallback
const SELECTED_BORDER_COLOR = 'oklch(0.6 0.14 70)'; // --okf-graph-selected-border
const EDGE_COLOR = 'oklch(0.82 0.014 48)'; // --okf-graph-edge

interface ConceptGraphProps {
  nodes: OkfBundleGraphNode[];
  edges: OkfBundleGraphEdge[];
  types: string[];
  selectedConceptId: string | null;
  onSelectConcept: (conceptId: string) => void;
  className?: string;
}

function toElements(
  nodes: OkfBundleGraphNode[],
  edges: OkfBundleGraphEdge[],
): ElementDefinition[] {
  const chrome = resolveGraphChromeColors();
  const fallbackNodeColor = chrome?.fallbackNode ?? FALLBACK_NODE_COLOR;
  const fallbackEdgeColor = chrome?.edge ?? EDGE_COLOR;
  const nodeElements: ElementDefinition[] = nodes.map((n) => ({
    data: {
      ...n.data,
      color: resolveConceptTypeColor(n.data.type)?.bg ?? fallbackNodeColor,
      shape: bundleClassShape(n.data.bundleClass),
      borderColor: resolveIriScopeBorderColor(
        n.data.iriScope,
        fallbackNodeColor,
      ),
      opacity: n.data.opacity ?? 1,
    },
  }));
  const edgeElements: ElementDefinition[] = edges.map((e) => ({
    data: {
      ...e.data,
      edgeColor: resolveEdgeRelationshipColor(
        e.data.relationship,
        fallbackEdgeColor,
      ),
    },
  }));
  return [...nodeElements, ...edgeElements];
}

/** Compact key for the four {132.49} visual channels — shape (bundleClass), border colour (bl-457 iriScope), opacity (A19 confidence), edge colour (relationship). */
function GraphLegend() {
  return (
    <div
      data-testid="concept-graph-legend"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground"
    >
      <span className="font-medium text-foreground">Legend</span>
      <span className="flex items-center gap-1">
        <span className="inline-block size-2.5 rounded-full border border-foreground/50" />
        Client bundle
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block size-2.5 border border-foreground/50" />
        Platform baseline
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block size-2 rotate-45 border border-foreground/50" />
        Unknown bundle class
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block size-2.5 rounded-full border-2 bg-[var(--okf-graph-iri-base-border)]" />
        Base vocabulary term
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block size-2.5 rounded-full border-2 bg-[var(--okf-graph-iri-client-border)]" />
        Client-overlay term
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-0.5 w-4 bg-[var(--okf-graph-edge-cites)]" />
        Cites
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-0.5 w-4 bg-[var(--okf-graph-edge)]" />
        Related
      </span>
      <span>Fainter node = lower A19 confidence</span>
    </div>
  );
}

export function ConceptGraph({
  nodes,
  edges,
  types,
  selectedConceptId,
  onSelectConcept,
  className,
}: ConceptGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const onSelectConceptRef = useRef(onSelectConcept);
  // "Latest ref" pattern (React refs must not be written during render) — the
  // tap handler registered in the mount effect below always reads the
  // CURRENT callback via this ref, so `onSelectConcept` never has to be an
  // effect dependency (which would force a full Cytoscape teardown/rebuild
  // on every parent re-render).
  useEffect(() => {
    onSelectConceptRef.current = onSelectConcept;
  });

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [layout, setLayout] = useState<LayoutName>('cose');

  const elements = useMemo(() => toElements(nodes, edges), [nodes, edges]);

  // Mount / rebuild the Cytoscape instance when the element set changes.
  useEffect(() => {
    if (!containerRef.current) return;
    const chrome = resolveGraphChromeColors();
    const selectedBorderColor = chrome?.selectedBorder ?? SELECTED_BORDER_COLOR;
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(label)',
            'font-size': 11,
            'text-valign': 'bottom',
            'text-margin-y': 4,
            width: 'data(size)',
            height: 'data(size)',
            // {132.49}: bundleClass -> shape, bl-457 iriScope -> border,
            // A19 confidence -> opacity (pre-computed server-side). Cytoscape's
            // own style DSL supports a `'data(x)'` mapper STRING for any
            // property at runtime, but its TS types only model the mapper
            // FUNCTION form (`(ele) => value`) for non-`Colour` (non-string)
            // property types — `shape`/`opacity` need the function form to
            // type-check; `background-color`/`border-color` above/below only
            // "work" with the string form because `Colour` IS `string`.
            shape: (ele: NodeSingular) => ele.data('shape'),
            'border-width': 2,
            'border-color': 'data(borderColor)',
            opacity: (ele: NodeSingular) => ele.data('opacity'),
          },
        },
        {
          // Declared AFTER `node` — still wins the cascade for a selected
          // node despite the base rule's own `border-color`/`border-width`.
          selector: 'node:selected',
          style: { 'border-width': 3, 'border-color': selectedBorderColor },
        },
        {
          selector: 'edge',
          style: {
            width: 1.5,
            // {132.49}: relationship (cites/related) -> edge colour.
            'line-color': 'data(edgeColor)',
            'target-arrow-color': 'data(edgeColor)',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
          },
        },
        { selector: '.dim', style: { opacity: 0.15 } },
      ],
      layout: { name: 'cose', animate: false, padding: 30 },
      wheelSensitivity: 0.2,
    });

    cy.on('tap', 'node', (evt) => {
      onSelectConceptRef.current(evt.target.id());
    });
    cy.on('tap', (evt) => {
      if (evt.target === cy) cy.elements().unselect();
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
    // Rebuild only on element-set change — the tap handler always reads the
    // latest callback via `onSelectConceptRef`, so `onSelectConcept` is
    // deliberately not a dependency here (the linter agrees; no disable needed).
  }, [elements]);

  // Search — dim nodes/edges whose label/id/tags don't match.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const q = search.trim().toLowerCase();
    if (!q) {
      cy.elements().removeClass('dim');
      return;
    }
    cy.nodes().forEach((n) => {
      const d = n.data();
      const haystack =
        `${d.label ?? ''} ${d.id} ${(d.tags ?? []).join(' ')}`.toLowerCase();
      n.toggleClass('dim', !haystack.includes(q));
    });
    cy.edges().forEach((e) => {
      e.toggleClass(
        'dim',
        e.source().hasClass('dim') || e.target().hasClass('dim'),
      );
    });
  }, [search, elements]);

  // Type filter — dim nodes whose type doesn't match.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    if (!typeFilter) {
      cy.elements().removeClass('dim');
      return;
    }
    cy.nodes().forEach((n) => {
      n.toggleClass('dim', n.data('type') !== typeFilter);
    });
    cy.edges().forEach((e) => {
      e.toggleClass(
        'dim',
        e.source().hasClass('dim') || e.target().hasClass('dim'),
      );
    });
  }, [typeFilter, elements]);

  // Layout selector.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.layout({ name: layout, animate: false, padding: 30 }).run();
  }, [layout]);

  // External selection (nav click, backlink click) — select + centre the node.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !selectedConceptId) return;
    const node = cy.getElementById(selectedConceptId);
    if (node && node.length > 0) {
      cy.elements().unselect();
      node.select();
    }
  }, [selectedConceptId, elements]);

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
        <input
          type="search"
          placeholder="Search title / id / tag"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
        <select
          aria-label="Filter by type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          aria-label="Layout"
          value={layout}
          onChange={(e) => setLayout(e.target.value as LayoutName)}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        >
          {LAYOUTS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            cyRef.current?.fit(undefined, 30);
            cyRef.current?.elements().unselect();
          }}
          className="rounded-md border border-border bg-muted px-2 py-1 text-sm hover:bg-accent"
        >
          Reset view
        </button>
      </div>
      <GraphLegend />
      <div
        ref={containerRef}
        data-testid="concept-graph-canvas"
        className="min-h-0 flex-1"
      />
    </div>
  );
}
