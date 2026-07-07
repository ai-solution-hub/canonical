'use client';

/**
 * `<BundleViewer>` — the top-level three-region layout (nav rail + graph +
 * detail) for the `{132.14}` G-VIEWER bundle viewer
 * (TECH-ADDENDUM-reference-agents.md Part 2 §Target TS surface: "three
 * regions: nav rail + graph + detail").
 *
 * `<BundleLog>` (a native addition) sits in the right-hand panel as a
 * "History" tab alongside `<ConceptDetail>`'s "Detail" tab — the addendum
 * names the four components but does not pin the log's exact placement
 * within the three-region layout, so this is an Executor placement decision
 * (flagged in the discrepancy report), not a spec requirement.
 *
 * Owns `selectedConceptId` — the one piece of state `<BundleNav>`,
 * `<ConceptGraph>`, and `<ConceptDetail>` all coordinate through (a nav
 * click, a graph tap, and a backlink/internal-link click all converge here).
 */
import { useMemo, useState } from 'react';
import { BundleNav } from '@/components/okf/bundle-nav';
import { BundleLog } from '@/components/okf/bundle-log';
import { ConceptDetail } from '@/components/okf/concept-detail';
import { ConceptGraph } from '@/components/okf/concept-graph';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useBundleGraph,
  useBundleLog,
  useBundleNav,
} from '@/hooks/okf/use-bundle';
import type { OkfBundleGraphNode } from '@/lib/query/okf';

interface BundleViewerProps {
  bundleId: string;
}

export function BundleViewer({ bundleId }: BundleViewerProps) {
  const graphQuery = useBundleGraph(bundleId);
  const navQuery = useBundleNav(bundleId);
  const logQuery = useBundleLog(bundleId);
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
      <div className="grid h-full grid-cols-[260px_1fr_400px] gap-2 p-2">
        <Skeleton className="h-full" />
        <Skeleton className="h-full" />
        <Skeleton className="h-full" />
      </div>
    );
  }

  if (graphQuery.isError || !graph) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">
        Failed to load this bundle. Please retry shortly.
      </div>
    );
  }

  return (
    <div
      data-testid="bundle-viewer"
      className="grid h-full grid-cols-[260px_1fr_400px]"
    >
      <BundleNav
        themes={navQuery.data ?? null}
        fallbackNodes={graph.nodes}
        selectedConceptId={selectedConceptId}
        onSelectConcept={setSelectedConceptId}
        className="border-r border-border"
      />
      <ConceptGraph
        nodes={graph.nodes}
        edges={graph.edges}
        types={graph.types}
        selectedConceptId={selectedConceptId}
        onSelectConcept={setSelectedConceptId}
      />
      <Tabs
        defaultValue="detail"
        className="flex h-full flex-col border-l border-border"
      >
        <TabsList className="mx-2 mt-2 w-fit">
          <TabsTrigger value="detail">Detail</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="detail" className="min-h-0 flex-1">
          <ConceptDetail
            node={selectedNode}
            body={body}
            backlinks={backlinks}
            knownConceptIds={knownConceptIds}
            onNavigate={setSelectedConceptId}
            className="h-full"
          />
        </TabsContent>
        <TabsContent value="history" className="min-h-0 flex-1">
          <BundleLog entries={logQuery.data ?? []} className="h-full" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
