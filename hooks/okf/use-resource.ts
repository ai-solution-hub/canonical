'use client';

/**
 * `useResource` — the secondary resource-resolution lane hook for
 * `<ConceptDetail>`'s `resource:` frontmatter pointer chip (ID-132 {132.14}
 * G-VIEWER, TECH-ADDENDUM-reference-agents.md Part 2 §Reframe B).
 *
 * Lazy by construction: pass `enabled: false` (the default) until the user
 * clicks the resource chip, then flip it — this is the "gated behind a
 * click" enhancement lane, never a graph-load-time fetch.
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchOkfResource } from '@/lib/query/okf';

export function useResource(
  uri: string | null,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: queryKeys.okf.resource(uri ?? ''),
    queryFn: () => fetchOkfResource(uri as string),
    enabled: !!uri && (options.enabled ?? true),
  });
}
