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
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import { resolveConceptTypeColor } from '@/lib/okf/concept-type-tokens';
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

const FALLBACK_NODE_COLOR = '#94a3b8';
const SELECTED_BORDER_COLOR = '#f59e0b';
const EDGE_COLOR = '#cbd5e1';

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
  const nodeElements: ElementDefinition[] = nodes.map((n) => ({
    data: {
      ...n.data,
      color: resolveConceptTypeColor(n.data.type)?.bg ?? FALLBACK_NODE_COLOR,
    },
  }));
  const edgeElements: ElementDefinition[] = edges.map((e) => ({
    data: e.data,
  }));
  return [...nodeElements, ...edgeElements];
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
          },
        },
        {
          selector: 'node:selected',
          style: { 'border-width': 3, 'border-color': SELECTED_BORDER_COLOR },
        },
        {
          selector: 'edge',
          style: {
            width: 1.5,
            'line-color': EDGE_COLOR,
            'target-arrow-color': EDGE_COLOR,
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
      <div
        ref={containerRef}
        data-testid="concept-graph-canvas"
        className="min-h-0 flex-1"
      />
    </div>
  );
}
