/**
 * `canonical://` resource-URI parser — the viewer-side inverse of the
 * producer's `resource_uri.py` builder (ID-132 {132.6} G-PASS1a, commit
 * `609462e4`, `scripts/cocoindex_pipeline/producer/resource_uri.py`).
 *
 * Used by `<ConceptDetail>`'s `resource:` frontmatter chip (secondary
 * resource-resolution lane, TECH-ADDENDUM-reference-agents.md Part 2
 * Reframe B) to decide which `api.*` table + filter to resolve a pointer
 * against. Mirrors the producer's BI-6/BI-7/BI-8 shapes exactly:
 * - `canonical://source_documents/<uuid>` / `canonical://reference_items/<uuid>`
 *   — a per-row anchor (BI-6; `q_a_pairs` is deliberately absent from this
 *   form — its `gen_random_uuid()` PK is never bundle-cited, BI-7).
 * - `canonical://q_a_pairs?scope_tag=<tag>` or
 *   `canonical://q_a_pairs?domain=<domain>&subtopic=<subtopic>` — a filtered
 *   query, never a row (BI-8).
 *
 * Pure parser — no DB dependency, mirroring the producer module's own
 * "pure builder" posture.
 */

const SCHEME = 'canonical://';

export type CanonicalResourceRef =
  | { table: 'source_documents'; id: string }
  | { table: 'reference_items'; id: string }
  | { table: 'q_a_pairs'; scopeTag: string }
  | { table: 'q_a_pairs'; domain: string; subtopic: string };

const PER_ROW_TABLES = new Set(['source_documents', 'reference_items']);

/**
 * Parse a `canonical://` resource URI into a table + filter reference, or
 * `null` when the value is not a recognised `canonical://` pointer (e.g. a
 * plain external `resource:` URL, which the caller should render as a
 * regular link instead of resolving via `api.*`).
 */
export function parseCanonicalResourceUri(
  uri: string,
): CanonicalResourceRef | null {
  if (typeof uri !== 'string' || !uri.startsWith(SCHEME)) return null;

  const rest = uri.slice(SCHEME.length);
  const queryIdx = rest.indexOf('?');
  const tablePath = queryIdx === -1 ? rest : rest.slice(0, queryIdx);
  const query = queryIdx === -1 ? '' : rest.slice(queryIdx + 1);

  if (tablePath === 'q_a_pairs') {
    const params = new URLSearchParams(query);
    const scopeTag = params.get('scope_tag');
    if (scopeTag) return { table: 'q_a_pairs', scopeTag };
    const domain = params.get('domain');
    const subtopic = params.get('subtopic');
    if (domain && subtopic) return { table: 'q_a_pairs', domain, subtopic };
    return null;
  }

  const [table, id] = tablePath.split('/');
  if (PER_ROW_TABLES.has(table) && id) {
    return { table: table as 'source_documents' | 'reference_items', id };
  }
  return null;
}
