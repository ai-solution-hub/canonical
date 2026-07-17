'use client';

/**
 * `useUnionGraph` — the deployment-level union concept graph (ID-132
 * {132.49} G-CONCEPT-GRAPH-UNION). Kept in its own file rather than folded
 * into `hooks/okf/use-bundle.ts`: that file's three hooks share ONE
 * bundle-scoped query (`queryKeys.okf.bundle(bundleId)`) by design (module
 * doc: "one fetch; the bundle fits one context window"); the union graph is
 * deployment-scoped (no `bundleId`), a distinct query with no `nav`/`log`
 * siblings to share a fetch with.
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchOkfUnionGraph } from '@/lib/query/okf';

/** The whole-deployment union concept graph — `<UnionGraphView>`'s data source. */
export function useUnionGraph() {
  return useQuery({
    queryKey: queryKeys.okf.unionGraph,
    queryFn: fetchOkfUnionGraph,
  });
}
