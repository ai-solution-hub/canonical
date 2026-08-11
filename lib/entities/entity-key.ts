/**
 * The deterministic entity key.
 *
 * This is the TypeScript side of `canonicalise_entity_name` in
 * `scripts/cocoindex_pipeline/canonicalisation.py`. The pipeline writes
 * `entity_mentions.canonical_name` and both `entity_relationships` endpoints
 * with that function, and `get_entity_summary` matches by raw string equality —
 * so a lookup built any other way finds nothing (DR-140).
 *
 * NOT a display function. `formatEntityDisplayName` in `./entity-dedup` restores
 * casing for rendering and must never be used to build a key.
 */

/**
 * Combining marks left behind by NFKD. Python filters on non-zero canonical
 * combining class; JavaScript exposes no combining-class accessor, so this
 * matches the Unicode Mark categories instead. The two agree on the
 * Latin-script diacritics NFKD decomposition actually produces here.
 */
const COMBINING_MARKS = /\p{M}/gu;

export function entityKey(name: string): string {
  if (!name) return '';
  return name
    .trim()
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .trim();
}
