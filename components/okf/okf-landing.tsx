'use client';

/**
 * `<OkfLanding>` — the `/okf` Concepts landing's top-level orchestrator
 * (ID-132 {132.32} G-LANDING-IMPL, OKF-LANDING.md LI-1/LI-3(a)/LI-14).
 *
 * Owns the bundle-enumeration query (`GET /api/okf/bundles`) and the
 * `selectedBundleId` piece of state `<BundleList>` and `<FileExplorer>`
 * coordinate through: the landing is ONE page (LI-14: "no bundleId in the
 * path") that lists every configured bundle, then opens a chosen bundle's
 * full-tree file explorer inline. `<FileExplorer key={selectedBundleId}>`
 * resets its own local state cleanly on a bundle switch (components/CLAUDE.md
 * "reset local state via key prop" convention) rather than a `useEffect`.
 *
 * **{132.49} G-CONCEPT-GRAPH-UNION §5.** A `<Tabs>` toggle surfaces the
 * whole-deployment union concept graph (`<UnionGraphView>`) ALONGSIDE this
 * existing per-bundle browse experience, per the dispatch brief ("surface a
 * deployment union view on the /okf landing... alongside the per-bundle
 * viewer"). "Browse bundles" is the `defaultValue` — the pre-{132.49}
 * default landing experience is unchanged for a visitor who never opens the
 * new tab.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BundleList } from '@/components/okf/bundle-list';
import { FileExplorer } from '@/components/okf/file-explorer';
import { UnionGraphView } from '@/components/okf/union-graph-view';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchOkfBundleList } from '@/lib/query/okf';

interface OkfLandingProps {
  className?: string;
}

export function OkfLanding({ className }: OkfLandingProps) {
  const bundlesQuery = useQuery({
    queryKey: queryKeys.okf.bundles,
    queryFn: fetchOkfBundleList,
  });

  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null);

  if (bundlesQuery.isLoading) {
    return (
      <div
        className={cn('grid h-full grid-cols-[280px_1fr] gap-2 p-2', className)}
      >
        <Skeleton className="h-full" />
        <Skeleton className="h-full" />
      </div>
    );
  }

  if (bundlesQuery.isError || !bundlesQuery.data) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center p-6 text-sm text-destructive',
          className,
        )}
      >
        Failed to load the Concepts bundles. Please retry shortly.
      </div>
    );
  }

  const { bundles, configured } = bundlesQuery.data;

  return (
    <Tabs
      defaultValue="browse"
      className={cn('flex h-full flex-col', className)}
    >
      <TabsList className="mx-2 mt-2 w-fit">
        <TabsTrigger value="browse">Browse bundles</TabsTrigger>
        <TabsTrigger value="deployment-graph">Deployment graph</TabsTrigger>
      </TabsList>
      <TabsContent value="browse" className="min-h-0 flex-1">
        <div
          data-testid="okf-landing"
          className={cn(
            'grid h-full',
            selectedBundleId ? 'grid-cols-[280px_1fr]' : 'grid-cols-1',
          )}
        >
          <BundleList
            bundles={bundles}
            configured={configured}
            selectedBundleId={selectedBundleId}
            onSelectBundle={setSelectedBundleId}
            className="border-r border-border"
          />
          {selectedBundleId && (
            <FileExplorer key={selectedBundleId} bundleId={selectedBundleId} />
          )}
        </div>
      </TabsContent>
      <TabsContent value="deployment-graph" className="min-h-0 flex-1">
        <UnionGraphView className="h-full" />
      </TabsContent>
    </Tabs>
  );
}
