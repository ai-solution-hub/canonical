'use client';

/**
 * OKF concept-bundle viewer data hooks (ID-132 {132.14} G-VIEWER).
 *
 * Three domain-shaped selector hooks over ONE shared query — matches
 * TECH-ADDENDUM-reference-agents.md Part 2's "Data (TanStack Query only)"
 * spec ("one fetch; the bundle fits one context window (BI-24) so wholesale
 * is fine") while still giving `<ConceptGraph>`, `<BundleNav>`, and
 * `<BundleLog>` their own named hook + narrowly-typed `data`. All three
 * share `queryKeys.okf.bundle(bundleId)`, so TanStack Query dedupes the
 * network request across the three call sites — no extra round-trips.
 *
 * There is deliberately NO full-envelope hook for a consumer's top-level
 * loading/error guard. A `select` that throws sets a PER-OBSERVER error
 * (query-core's `#selectError`), so a subscription without `select` can never
 * observe it: measured against a null envelope, a plain `useQuery` on this key
 * reports SUCCESS while all three selectors below report error. Guarding on
 * one of these three (as `<BundleViewer>` does) is therefore strictly safer
 * than guarding on the raw query, not merely equivalent to it.
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import {
  fetchOkfBundle,
  type OkfBundleGraphNode,
  type OkfBundleGraphEdge,
  type OkfBundleNavTheme,
  type OkfBundleLogEntry,
} from '@/lib/query/okf';

/** The graph slice of the bundle envelope — `<ConceptGraph>`'s data source. */
export interface OkfBundleGraph {
  nodes: OkfBundleGraphNode[];
  edges: OkfBundleGraphEdge[];
  bodies: Record<string, string>;
  types: string[];
}

/** The concept graph (nodes/edges/bodies/types) — `<ConceptGraph>`. */
export function useBundleGraph(bundleId: string) {
  return useQuery({
    queryKey: queryKeys.okf.bundle(bundleId),
    queryFn: () => fetchOkfBundle(bundleId),
    enabled: !!bundleId,
    select: (data): OkfBundleGraph => ({
      nodes: data.nodes,
      edges: data.edges,
      bodies: data.bodies,
      types: data.types,
    }),
  });
}

/**
 * The `index.md` progressive-disclosure nav tree — `<BundleNav>`.
 * `data` is `null` when `index.md` is absent (soft-dep `{132.10}`); the
 * caller falls back to grouping the graph's nodes by `type`.
 */
export function useBundleNav(bundleId: string) {
  return useQuery({
    queryKey: queryKeys.okf.bundle(bundleId),
    queryFn: () => fetchOkfBundle(bundleId),
    enabled: !!bundleId,
    select: (data): OkfBundleNavTheme[] | null => data.nav,
  });
}

/** The `log.md` reverse-chronological run history — `<BundleLog>`. */
export function useBundleLog(bundleId: string) {
  return useQuery({
    queryKey: queryKeys.okf.bundle(bundleId),
    queryFn: () => fetchOkfBundle(bundleId),
    enabled: !!bundleId,
    select: (data): OkfBundleLogEntry[] => data.log,
  });
}
