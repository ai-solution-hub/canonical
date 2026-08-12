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
 * HARD-reject semantics, NARROWED to what §11 actually permits (id-439).
 * `parseConceptFrontmatter` still calls `.parse()` (not `.safeParse()`),
 * so a concept that violates the one v0.2 conformance requirement — a
 * missing or empty `type` (§11 clause 2) — throws a `ZodError` rather than
 * being coerced or silently dropped, as does a malformed `resource:` URI
 * when one is present. What it may NOT throw on is a missing OPTIONAL
 * family: §11 forbids rejecting a bundle for "missing optional frontmatter
 * fields", and §4.1 states that "a concept carrying just `type` is fully
 * conformant". This schema required `title`, `description` AND `tags`, so
 * the spec's own minimal conformant document threw — that is fixed; all
 * three are now optional, matching the defaults `lib/okf/bundle-graph.ts`
 * already applied when reading them.
 *
 * The required-key set + `resource:` URI-shape rule is borrowed from the
 * Google okf-skills concept convention — the RULE SET only, not its
 * runtime (no okf-skills dependency here).
 *
 * **`type` is an open label (ID-427 {427.6}, DR-141).**
 * `ConceptFrontmatterSchema.type` accepts any non-empty string, and there
 * is no concept-type vocabulary in this module to compare it against:
 * `CONCEPT_TYPE_VALUES` — the S448 base-5 array — is DELETED. It was
 * exported "for documentary/UI purposes (e.g. a future type-legend)", and
 * a future use is not a current source: the legend duty is discharged by
 * `lib/okf/concept-type-tokens.ts`'s `KNOWN_TYPES`, which maps a type to
 * badge tokens and falls back to a default for anything unmapped. Keeping
 * a second, narrower list here only invited it to drift back into a gate.
 *
 * The open `type` predates the deletion and is unchanged by it ({132.36}
 * G-CONCEPT-FEEDER): the producer's own check was already run-scoped in a
 * way this static, run-context-free schema cannot replicate, and the OKF
 * landing render this schema serves (`lib/okf/bundle-graph.ts`, which
 * derives its type list from the bundle itself) has always treated `type`
 * as an open string. A HARD ZodError on an unrecognised type would be a
 * REGRESSION relative to that already-generic render path — and under
 * DR-141 it would also be the inversion this task exists to remove. OKF
 * §4.1: type values are not centrally registered and consumers MUST
 * tolerate unknown ones. Write-time LEGALITY is a producer concern
 * (BI-13), never this reader-side contract's job.
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
 *   (forward-compatible with id-420, which owns emitting them; nothing
 *   emits one yet).
 * - `confidence` is no longer declared at all. It was gated by a `z.enum`
 *   deliberately left alone in the S546 wave pending id-428's ruling;
 *   id-428 retired the field from the producer (SPEC §5.1 refuses a stored
 *   credibility score), so the gate went with it. Previously-published
 *   bundles carrying `confidence` keep parsing, via the same §4.1
 *   unknown-key tolerance as any other extension key.
 */
import matter from 'gray-matter';
import { z } from 'zod';

/**
 * {132.41} bl-477's `CONFIDENCE_VALUES` — the ratified A19 vocabulary that
 * used to live here and back the `confidence` `z.enum` — is DELETED
 * (id-439, in step with id-428's producer-side retirement).
 *
 * It existed for exactly one reason, stated in its own docstring: "Unlike
 * the deleted `CONCEPT_TYPE_VALUES` this one IS a gate." id-428 removed the
 * gate (SPEC §5.1 refuses a stored credibility score, so the producer emits
 * no `confidence` at all), which leaves a vocabulary const with no
 * consumer — and the `CONCEPT_TYPE_VALUES` deletion note below is the
 * precedent for what happens next: "Keeping a second, narrower list here
 * only invited it to drift back into a gate."
 *
 * `confidence` survives on previously-published bundles and still parses,
 * as an ordinary §4.1 extension key (preserved by the root `looseObject`,
 * never validated). `lib/okf/bundle-graph.ts` keeps its own opacity LOOKUP
 * over the legacy values — a lookup with a full-opacity default, not a
 * gate, so an unknown value renders rather than throws.
 */

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
  // An open label, never a `z.enum` — see the module docstring's "`type` is
  // an open label" note. DR-141: a producer picks a descriptive value and a
  // consumer MUST tolerate one it does not know (OKF §4.1).
  type: z.string().min(1),
  // §4.1: "`type` is the only always-required key; a concept carrying just
  // `type` is fully conformant (§11)." `title`/`description`/`tags` are
  // RECOMMENDED, never required — and §11 forbids rejecting a bundle for
  // "missing optional frontmatter fields", which `.parse()` was doing on
  // the spec's own minimal conformant document (id-439). The live reader
  // already assumed this contract: `lib/okf/bundle-graph.ts`'s
  // `walkConcepts` defaults all three (title falls back to the concept id,
  // description to '', tags to []) rather than skipping such a concept.
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
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
  // `confidence` is deliberately NOT declared. id-428 retired it from the
  // emission contract; previously-published bundles still carry it, and the
  // root `looseObject` preserves it as an ordinary §4.1 extension key. A
  // `z.enum` here would reject exactly those older bundles the moment the
  // vocabulary moved — the failure mode this loosening exists to prevent.
  resource: z
    .string()
    .refine(isValidConceptResourceUri, {
      message:
        'resource must match canonical://<table>/<uuid>, canonical://q_a_pairs?scope_tag=<tag>, or an http(s) URL',
    })
    .optional(),
  tags: z.array(z.string()).optional(),
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
