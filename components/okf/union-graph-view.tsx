'use client';

/**
 * `<UnionGraphView>` — the deployment-level union concept graph surfaced on
 * the `/okf` landing (ID-132 {132.49} G-CONCEPT-GRAPH-UNION §5, alongside
 * the existing `{132.32}` per-bundle file explorer).
 *
 * Deliberately a THIN two-pane layout (graph + detail), not a
 * `<BundleViewer>`-shaped three-pane one: `<BundleNav>` (`index.md`
 * progressive-disclosure) and `<BundleLog>` (`log.md` run history) are both
 * bundle-scoped concepts with no single-bundle meaning across a UNION of
 * bundles, so this view omits them rather than inventing a merged nav/log
 * shape the brief never asked for. Reuses the shipped `<ConceptGraph>` (now
 * carrying the {132.49} legend) and `<ConceptDetail>` verbatim — no new
 * graph library, per the dispatch brief.
 */
import { useMemo, useState } from 'react';
import { ConceptDetail } from '@/components/okf/concept-detail';
import { ConceptGraph } from '@/components/okf/concept-graph';
import { Skeleton } from '@/components/ui/skeleton';
import { useUnionGraph } from '@/hooks/okf/use-union-graph';
import { cn } from '@/lib/utils';
import type { OkfBundleGraphNode } from '@/lib/query/okf';

interface UnionGraphViewProps {
  className?: string;
}

export function UnionGraphView({ className }: UnionGraphViewProps) {
  const graphQuery = useUnionGraph();
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(
    null,
  );

  const graph = graphQuery.data;

  const knownConceptIds = useMemo(
    () => new Set(graph?.nodes.map((n) => n.data.id) ?? []),
    [graph],
  );

  const selectedNode: OkfBundleGraphNode | null = useMemo(() => {
    if (!graph || !selectedConceptId) return null;
    return graph.nodes.find((n) => n.data.id === selectedConceptId) ?? null;
  }, [graph, selectedConceptId]);

  const backlinks = useMemo(() => {
    if (!graph || !selectedConceptId) return [];
    const nodeIndex = new Map(
      graph.nodes.map((n) => [n.data.id, n.data.label]),
    );
    return graph.edges
      .filter((e) => e.data.target === selectedConceptId)
      .map((e) => ({
        id: e.data.source,
        label: nodeIndex.get(e.data.source) ?? e.data.source,
      }));
  }, [graph, selectedConceptId]);

  const body =
    graph && selectedConceptId ? (graph.bodies[selectedConceptId] ?? '') : '';

  if (graphQuery.isLoading) {
    return (
      <div
        className={cn('grid h-full grid-cols-[1fr_400px] gap-2 p-2', className)}
      >
        <Skeleton className="h-full" />
        <Skeleton className="h-full" />
      </div>
    );
  }

  if (graphQuery.isError || !graph) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center p-6 text-sm text-destructive',
          className,
        )}
      >
        Failed to load the deployment concept graph. Please retry shortly.
      </div>
    );
  }

  if (graph.nodes.length === 0) {
    return (
      <div
        data-testid="union-graph-empty"
        className={cn(
          'flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground',
          className,
        )}
      >
        No concepts have been published yet.
      </div>
    );
  }

  return (
    <div
      data-testid="union-graph-view"
      className={cn('grid h-full grid-cols-[1fr_400px]', className)}
    >
      <ConceptGraph
        nodes={graph.nodes}
        edges={graph.edges}
        types={graph.types}
        selectedConceptId={selectedConceptId}
        onSelectConcept={setSelectedConceptId}
      />
      <ConceptDetail
        node={selectedNode}
        body={body}
        backlinks={backlinks}
        knownConceptIds={knownConceptIds}
        onNavigate={setSelectedConceptId}
        className="border-l border-border"
      />
    </div>
  );
}
