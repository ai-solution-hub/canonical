/**
 * Union-graph concept-id namespacing ({132.49} G-CONCEPT-GRAPH-UNION).
 *
 * The deployment-level union graph merges every sibling bundle into one
 * node/edge set, so a bare bundle-root-relative concept id (`services/orders`)
 * is no longer unique — two bundles may each carry that path. `buildUnionBundleGraph`
 * therefore prefixes every node/edge id with its owning `bundleId`.
 *
 * This module is the SINGLE definition of that id scheme, deliberately split
 * out of `lib/okf/bundle-graph.ts` (which imports `node:fs` and so can never
 * be pulled into a `'use client'` bundle). Both halves of the round-trip need
 * it: the SERVER mints namespaced ids when building the union graph, and the
 * CLIENT must re-apply the same namespace to a link target it resolves out of
 * a concept body before matching it against those ids. Keeping the two in one
 * module is what makes them provably the same scheme — when the namespacing
 * lived only server-side, the client's resolved link targets silently failed
 * to match every union node id reached via `../` or the SPEC §5.1
 * bundle-absolute (`/foo.md`) citation-trailer form.
 *
 * Pure string utilities — no Node builtins, safe in a client component.
 */

/**
 * Separator between a `bundleId` and its bundle-root-relative concept id.
 * `::` is not a plausible path character in bundle content, and it survives
 * Streamdown's bundled `rehype-harden` URL pass byte-identical (verified
 * against the pinned dependency — see `prepare-streamdown-content.ts`, whose
 * whole reason for existing is that plugin's href rewriting).
 */
export const UNION_ID_SEPARATOR = '::';

/** Namespace a per-bundle concept/edge id for the union graph. */
export function namespaceUnionId(bundleId: string, id: string): string {
  return `${bundleId}${UNION_ID_SEPARATOR}${id}`;
}

/**
 * Inverse of `namespaceUnionId`. Returns `bundleId: null` for an
 * un-namespaced id — the per-bundle `<BundleViewer>` case, where ids are
 * bare bundle-root-relative paths — so callers can treat "namespace or not"
 * uniformly without branching on which view they are in.
 *
 * Splits on the FIRST separator: a `bundleId` is a directory basename and
 * never contains `::`, so anything after the first one belongs to the
 * concept path.
 */
export function splitUnionId(unionId: string): {
  bundleId: string | null;
  conceptId: string;
} {
  const idx = unionId.indexOf(UNION_ID_SEPARATOR);
  if (idx === -1) return { bundleId: null, conceptId: unionId };
  return {
    bundleId: unionId.slice(0, idx),
    conceptId: unionId.slice(idx + UNION_ID_SEPARATOR.length),
  };
}
