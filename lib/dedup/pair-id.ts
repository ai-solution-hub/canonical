/**
 * §1.9 Near-Duplicate Merge Dashboard — pair-id encoding/decoding.
 *
 * Stable URL identifier for a near-dup pair: lexical sort of the two
 * UUIDs joined with `__`. Ordering matches the `find_duplicate_pairs`
 * RPC's `ci1.id < ci2.id` predicate so the URL is deterministic
 * regardless of which row the admin clicked first.
 *
 * Validation rules (parser):
 *   - segment must be exactly two `__`-separated halves;
 *   - both halves must be RFC-4122 UUIDs (Zod-strict — test fixtures must
 *     use v4-compliant values, not `00000000-…-0001`-style placeholders);
 *   - left half must be lexically less than right half (no equal, no
 *     reversed); equal halves are rejected as a self-pair.
 *
 * Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §3.5, §5.3.
 *
 * NOTE: A1-ui owns this file canonically per S212B Wave 1 split. A1-routes
 * also creates an identical implementation so both branches build/test in
 * isolation. The orchestrator's cherry-pick should resolve trivially.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PairIdParts {
  leftId: string;
  rightId: string;
}

/**
 * Build a pair-id segment from two UUIDs. The result is always
 * `<smallerUuid>__<largerUuid>` regardless of input order.
 *
 * @throws Error if either input is not a valid UUID, or if `a === b`.
 */
export function buildPairId(a: string, b: string): string {
  if (!UUID_RE.test(a)) {
    throw new Error(`buildPairId: '${a}' is not a valid UUID`);
  }
  if (!UUID_RE.test(b)) {
    throw new Error(`buildPairId: '${b}' is not a valid UUID`);
  }
  if (a === b) {
    throw new Error('buildPairId: ids must differ (no self-pair)');
  }
  // Lex-sort the two UUIDs (case-insensitive equality already excluded).
  // String comparison is locale-independent on RFC-4122 hex values.
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  return aLower < bLower ? `${aLower}__${bLower}` : `${bLower}__${aLower}`;
}

/**
 * Parse a pair-id segment back into its two UUIDs.
 *
 * Returns `null` if the segment is malformed (wrong shape, non-UUID half,
 * leftId >= rightId, etc.). Callers should map `null` → 400 in route
 * handlers.
 */
export function parsePairId(segment: string): PairIdParts | null {
  if (typeof segment !== 'string' || segment.length === 0) return null;

  const halves = segment.split('__');
  if (halves.length !== 2) return null;

  const [left, right] = halves;
  if (!UUID_RE.test(left)) return null;
  if (!UUID_RE.test(right)) return null;

  const leftLower = left.toLowerCase();
  const rightLower = right.toLowerCase();

  // Strict ordering: leftId < rightId. Equal is a self-pair (rejected).
  if (leftLower >= rightLower) return null;

  return { leftId: leftLower, rightId: rightLower };
}
