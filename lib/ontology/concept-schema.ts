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
 * required key, or (when present) a malformed `resource:` URI — throws a
 * `ZodError` rather than being coerced or silently dropped. `resource:` is
 * itself OPTIONAL (see {132.19} note below) — its absence is not a
 * violation. This mirrors the Python pipeline's `_validate_content_type`
 * field-validator (`scripts/cocoindex_pipeline/extraction.py`), which
 * raises on an out-of-taxonomy `content_type` instead of coercing.
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
 * **{132.36} G-CONCEPT-FEEDER `type` parity note.** `ConceptFrontmatterSchema
 * .type` does NOT gate against `CONCEPT_TYPE_VALUES` — it accepts any
 * non-empty string. This mirrors the Python pipeline's own evolution:
 * `producer/validator.py`'s BI-4 closed-set check now runs ONLY against a
 * per-run `EffectiveOntology` (base ∪ client `ontology-overlay.json`,
 * OV-8) that this static, run-context-free schema has no way to
 * replicate — and the OKF landing render this schema exists to serve
 * (`lib/okf/bundle-graph.ts`, `lib/okf/concept-type-tokens.ts`) already
 * treats `type` as an open string, falling back to a default badge colour
 * for anything outside `CONCEPT_TYPE_VALUES` rather than throwing. A HARD
 * ZodError on an overlay-added type here would therefore be a REGRESSION
 * relative to that already-generic render path. `CONCEPT_TYPE_VALUES`
 * stays exported as the ratified BASE-5 vocabulary for documentary/UI
 * purposes (e.g. a future type-legend); it is simply no longer the
 * `type` field's parse-time gate. Closed-set LEGALITY for a given bundle
 * remains a producer-write-time concern (BI-13), never this reader-side
 * contract's job.
 *
 * ID-132 owns the `canonical://` URI scheme and the producer call site
 * that writes concept files onto disk. This module owns only the
 * frontmatter contract — no caller is wired here.
 *
 * **{132.19} resource-optionality + BI-8 query-form fix.** `resource:` is
 * OPTIONAL (PRODUCT.md BI-12: "its primary record anchor *where one
 * exists*") — mirrors the landed Python validator
 * (`scripts/cocoindex_pipeline/producer/validator.py`
 * `check_required_keys`/`check_resource_scheme`), which deliberately
 * excludes `resource` from its hard-required key set. `resource`, when
 * present, must be either the per-row anchor form
 * (`canonical://<table>/<uuid>`) OR the BI-8 `q_a_pairs` table/query form
 * (`canonical://q_a_pairs?scope_tag=<tag>` or
 * `?domain=<domain>&subtopic=<subtopic>`) — mirrors
 * `producer/resource_uri.py`'s `build_q_a_pairs_query_uri` /
 * `producer/validator.py`'s `_QA_PAIRS_QUERY_RESOURCE_RE`. The q_a_pairs
 * table therefore NEVER appears in the per-row uuid form (BI-6/BI-7: its
 * `gen_random_uuid()` PK is opaque and re-minting, never bundle-cited).
 *
 * **OKF v0.2 (id-439 consumer alignment, S546 rulings).** The v0.2
 * producer (id-426) changes the emission contract; this reader tolerates
 * BOTH generations (v0.2 §13.1: consumers SHOULD read `sources` and MAY
 * still parse the legacy trailer for v0.1 documents):
 * - `generated: { by, at }` REPLACES `timestamp` in new bundles;
 *   `timestamp` therefore becomes OPTIONAL here (legacy v0.1 bundles
 *   still carry it and MUST keep parsing).
 * - `sources:` is the frontmatter provenance list (`{ id, resource,
 *   title? }`); `resource` per entry may be a `canonical://` pointer, an
 *   https URL, or a bundle-absolute `.md` path (a concept citation).
 * - Top-level `resource:` is never `canonical://` in new bundles —
 *   reference concepts carry a real https URL there — so the refine now
 *   also admits http(s) URLs alongside the legacy canonical:// forms.
 * - §4.1: unknown frontmatter keys MUST NOT cause rejection — the root
 *   schema is a `looseObject` (tolerates AND preserves unknown keys).
 * - §11: a bare `verified` mapping normalises to a one-element list
 *   (forward-compatible with id-428; nothing emits it yet). The
 *   `confidence` z.enum is deliberately UNCHANGED this wave — id-428
 *   owns that loosening.
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
 * {132.41} bl-477 — the ratified A19 confidence vocabulary. Mirrors
 * `producer/frontmatter.py` / `producer/validator.py`'s own
 * `_CONFIDENCE_VALUES` frozenset — by convention, not import (cross-language,
 * same S448 `CONCEPT_TYPE_VALUES` single-const-array precedent above). A
 * concept's `confidence` is OPTIONAL and, when present, computed
 * deterministically by the producer — never model-authored (see
 * FRONTMATTER-WAVE.md §"Design — A19 producer-drafted confidence-setting
 * rule").
 */
export const CONFIDENCE_VALUES = [
  'strong',
  'partial',
  'no-content',
  'needs-SME',
] as const;

/**
 * `resource:`, in its per-row anchor form, must be a
 * `canonical://<table>/<uuid>` URI (scheme owned by ID-132). `<table>` is
 * restricted to `source_documents | reference_items` — the two tables whose
 * per-row uuid is a durable, citeable anchor. `q_a_pairs` is DELIBERATELY
 * excluded from the per-row form (its `gen_random_uuid()` PK is opaque and
 * re-minting, BI-6/BI-7); it is cited only via the BI-8 query form
 * (`CANONICAL_QUERY_RESOURCE_URI_PATTERN` below). This mirrors the
 * authoritative Python allowlist in `producer/validator.py`
 * (`^canonical://(?:source_documents|reference_items)/…`) so the TS schema and
 * the pipeline validator enforce the same per-row table set. `<uuid>` is a
 * 36-character UUID-shaped string (hex digits + hyphens — matches any UUID
 * version, not v4-only).
 */
const CANONICAL_RESOURCE_URI_PATTERN =
  /^canonical:\/\/(?:source_documents|reference_items)\/[0-9a-f-]{36}$/;

/**
 * BI-8: the `q_a_pairs` table/query resource form — `producer/
 * resource_uri.py`'s `build_q_a_pairs_query_uri` emits exactly this shape.
 * Never a row uuid (that PK is opaque/re-minting — BI-6/BI-7). The
 * `?domain=&subtopic=` form retired S531 with the fallback topic grain
 * (DR-125 expiry ruled).
 */
const CANONICAL_QUERY_RESOURCE_URI_PATTERN =
  /^canonical:\/\/q_a_pairs\?scope_tag=[^&]+$/;

/**
 * v0.2 emission-contract item 4: reference concepts carry a real http(s)
 * URL as their top-level `resource:` (DB-backed concepts omit it, and new
 * bundles never write `canonical://` there). Legacy v0.1 bundles still
 * carry the canonical:// forms, so both remain admissible.
 */
const HTTP_URL_PATTERN = /^https?:\/\/\S+$/;

/** True iff `value` is a valid `resource:` URI — the per-row anchor form,
 * the BI-8 `q_a_pairs` query form, or (v0.2) an http(s) URL. */
function isValidConceptResourceUri(value: string): boolean {
  return (
    CANONICAL_RESOURCE_URI_PATTERN.test(value) ||
    CANONICAL_QUERY_RESOURCE_URI_PATTERN.test(value) ||
    HTTP_URL_PATTERN.test(value)
  );
}

/**
 * One v0.2 `sources[]` provenance entry. `resource` is deliberately an
 * open non-empty string here: the contract admits `canonical://` pointers,
 * https URLs, AND bundle-absolute `.md` paths, and §11 forbids rejecting a
 * concept over an entry shape this reader does not recognise — kind
 * discrimination is the consumer surface's job (`components/okf/
 * concept-detail.tsx`, `lib/okf/bundle-graph.ts`), not a parse-time gate.
 * `looseObject`: §4.1 unknown-key tolerance applies to nested families too.
 */
const ConceptSourceSchema = z.looseObject({
  id: z.string().min(1),
  resource: z.string().min(1),
  title: z.string().optional(),
});

/** The v0.2 `generated: { by, at }` stamp that replaces `timestamp` —
 * `by` is an actor string (e.g. `kh-concept-producer/<model>`), `at` an
 * ISO-8601 datetime (shape-checked as a non-empty string only, matching
 * `timestamp`'s existing posture). */
const ConceptGeneratedSchema = z.looseObject({
  by: z.string().min(1),
  at: z.string().min(1),
});

export const ConceptFrontmatterSchema = z.looseObject({
  // {132.36} G-CONCEPT-FEEDER: a non-empty string, NOT `z.enum(
  // CONCEPT_TYPE_VALUES)` — see the module docstring's "type parity note"
  // for the full rationale (mirrors the Python validator's own OV-8 move
  // away from a static closed-set check).
  type: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  // v0.1 legacy last-modified stamp — OPTIONAL since v0.2 replaced it with
  // `generated` (id-439; previously-published bundles still carry it).
  timestamp: z.string().min(1).optional(),
  // v0.2 `generated: { by, at }` — optional so legacy bundles keep parsing.
  generated: ConceptGeneratedSchema.optional(),
  // v0.2 frontmatter provenance list — `[^id]` body footnotes key into
  // these entries' `id`s. Optional: DB-backed legacy concepts have none.
  sources: z.array(ConceptSourceSchema).optional(),
  // §11 duty (id-439, forward-compatible with id-428 — nothing emits it
  // yet): a bare `verified` mapping normalises to a one-element list, so
  // consumers only ever see the list shape. Entry internals stay open
  // records — id-428 owns the entry contract.
  verified: z.preprocess(
    (value) =>
      value === undefined || value === null || Array.isArray(value)
        ? (value ?? undefined)
        : [value],
    z.array(z.record(z.string(), z.unknown())).optional(),
  ),
  // {132.41} bl-456 routing hints — free optional strings, no positive
  // shape check beyond being a string (mirrors `producer/frontmatter.py`:
  // hints get the BI-10 stray-pointer guard at write time, not a schema
  // shape rule at read time).
  purpose: z.string().optional(),
  task: z.string().optional(),
  audience: z.string().optional(),
  // {132.41} bl-477 — A19 confidence, OPTIONAL at read (OKF consumers must
  // tolerate absence) even though the Path-1 producer always writes it.
  confidence: z.enum(CONFIDENCE_VALUES).optional(),
  resource: z
    .string()
    .refine(isValidConceptResourceUri, {
      message:
        'resource must match canonical://<table>/<uuid>, canonical://q_a_pairs?scope_tag=<tag>, or an http(s) URL',
    })
    .optional(),
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
