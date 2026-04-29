/**
 * Stable pair-id encoding for the §1.9 near-duplicate merge dashboard.
 *
 * A pair of `content_items.id` UUIDs is encoded as
 * `<smaller-uuid>__<larger-uuid>` so that:
 *  - The URL is deterministic regardless of which row the admin clicked
 *    first (matches the `find_duplicate_pairs` RPC's `ci1.id < ci2.id`
 *    predicate).
 *  - Round-tripping through {@link buildPairId} ↔ {@link parsePairId}
 *    yields the same `{ leftId, rightId }` with `leftId < rightId`.
 *
 * UUIDs are RFC-4122 strict (lower-case hex), matching `z.string().uuid()`
 * Zod validation per the CLAUDE.md gotcha. Test fixtures must use
 * v4-compliant UUIDs (NOT `00000000-…0001`-style placeholders).
 *
 * Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §3.5.
 */

export interface ParsedPairId {
  leftId: string;
  rightId: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse a pair-id URL segment into its two UUID halves.
 *
 * Returns `null` when:
 *  - the segment does not contain exactly one `__` separator
 *  - either half is not an RFC-4122-shaped UUID
 *  - the halves are not in lexical order (`a < b`)
 *
 * The route handler maps `null` → 400 and the UI surfaces a toast +
 * routes back to the list.
 */
export function parsePairId(segment: string): ParsedPairId | null {
  const parts = segment.split('__');
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  if (!UUID_RE.test(a) || !UUID_RE.test(b)) return null;
  if (a >= b) return null;
  return { leftId: a, rightId: b };
}

/**
 * Build a stable pair-id segment from two UUIDs.
 *
 * Throws when:
 *  - the two UUIDs are equal (a pair of one row makes no sense)
 *  - either UUID fails the RFC-4122 shape check
 *
 * The order of the inputs does not matter — the result always has the
 * lexically-smaller UUID on the left.
 */
export function buildPairId(idA: string, idB: string): string {
  if (idA === idB) {
    throw new Error('buildPairId: ids must differ');
  }
  if (!UUID_RE.test(idA) || !UUID_RE.test(idB)) {
    throw new Error('buildPairId: invalid UUID');
  }
  return idA < idB ? `${idA}__${idB}` : `${idB}__${idA}`;
}
