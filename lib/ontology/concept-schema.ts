/**
 * Zod contract for concept `.md` frontmatter (BI-6, TECH.md §BI-6
 * enforcement-semantics invariant).
 *
 * Sibling to `lib/ontology/schemas.ts` (the ontology-CV frontmatter
 * contract) — direct import only, no barrel. Parses concept markdown via
 * `gray-matter` (KH idiom: gray-matter + Zod, mirroring the `matter(raw)`
 * call the now-retired `lib/ontology/loader.ts` made at its old line 61)
 * and validates the extracted frontmatter against
 * `ConceptFrontmatterSchema`.
 *
 * HARD-reject semantics: `parseConceptFrontmatter` calls `.parse()`
 * (not `.safeParse()`), so a malformed concept — bad `type`, a missing
 * required key, or a malformed `resource:` URI — throws a `ZodError`
 * rather than being coerced or silently dropped. This mirrors the Python
 * pipeline's `_validate_content_type` field-validator
 * (`scripts/cocoindex_pipeline/extraction.py`), which raises on an
 * out-of-taxonomy `content_type` instead of coercing.
 *
 * The required-key set + `resource:` URI-shape rule is borrowed from the
 * Google okf-skills concept convention — the RULE SET only, not its
 * runtime (no okf-skills dependency here).
 *
 * `CONCEPT_TYPE_VALUES` is the S448 default set (owner joint-ratify
 * pending) — mirrors `ontology/37-concept-type.md` (docs-site, authored in
 * parallel as {133.8}). It is encoded as a single exported const array so a
 * future ratification changes exactly one place.
 *
 * ID-132 owns the `canonical://` URI scheme and the producer call site
 * that writes concept files onto disk. This module owns only the
 * frontmatter contract — no caller is wired here.
 */
import matter from 'gray-matter';
import { z } from 'zod';

export const CONCEPT_TYPE_VALUES = [
  'topic',
  'product',
  'company',
  'certification',
  'case_study',
] as const;

/**
 * `resource:` must be a `canonical://<table>/<uuid>` URI (scheme owned by
 * ID-132). `<table>` is a lowercase snake_case table name; `<uuid>` is a
 * 36-character UUID-shaped string (hex digits + hyphens — matches any UUID
 * version, not v4-only).
 */
const CANONICAL_RESOURCE_URI_PATTERN = /^canonical:\/\/[a-z_]+\/[0-9a-f-]{36}$/;

export const ConceptFrontmatterSchema = z.object({
  type: z.enum(CONCEPT_TYPE_VALUES),
  title: z.string().min(1),
  description: z.string().min(1),
  timestamp: z.string().min(1),
  resource: z
    .string()
    .regex(
      CANONICAL_RESOURCE_URI_PATTERN,
      'resource must match canonical://<table>/<uuid>',
    ),
  tags: z.array(z.string()),
});

export type ConceptFrontmatter = z.infer<typeof ConceptFrontmatterSchema>;

/**
 * Parse a concept `.md` file's raw text: extract YAML frontmatter via
 * `gray-matter`, then validate it against `ConceptFrontmatterSchema`.
 *
 * HARD-reject semantics: throws a `ZodError` on any violation (bad `type`,
 * missing required key, malformed `resource:` URI) — there is no
 * silent-coerce or drop-and-continue path.
 */
export function parseConceptFrontmatter(raw: string): ConceptFrontmatter {
  const { data } = matter(raw);
  return ConceptFrontmatterSchema.parse(data);
}
