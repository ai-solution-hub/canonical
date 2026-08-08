/**
 * THE fixture source of truth for the cocoindex integration suite (id-412 W8).
 *
 * Before this module, ~16 test files each re-declared
 *
 *   const FIXTURE_PATH = '…/csp-cloud-security-principles/Cloud Security Principles Checklist V5_3.xlsx'
 *
 * — sixteen copies of one path, and the path pointed at a **blank extraction
 * form** that each of those tests then treated as its content document. That is
 * two defects wearing one disguise: no single edit-site when a fixture moves,
 * and no way to see at a glance that a test is holding the wrong KIND of file.
 *
 * ## The split this module exists to make visible
 *
 * The pipeline has two planes and they take different fixtures:
 *
 * | Plane | Path through the code | Correct fixture |
 * |---|---|---|
 * | **1 — cocoindex walk** | `adapters.convert_binary_to_markdown` → Docling → chunks, entities, Stage-5 | `CONTENT` below |
 * | **2 — bid worker** | `form_extractors/*` → `commonforms` → form fields | `FORM_TEMPLATE` below |
 *
 * Plane 2 is reached in production by `scripts/bid_worker.py`, NOT by the walk —
 * `flow.py` does not import `form_extractors` at all. So a walk/entity/Stage-5
 * test that stages a `FORM_TEMPLATE` is asserting Plane-1 behaviour over a
 * Plane-2 input, which is how ~16 tests came to use a blank form as prose.
 *
 * **Read the import line to know whether a test is honest.** `CONTENT` in a
 * form-extraction test, or `FORM_TEMPLATE` in a chunking/entity test, is a bug
 * you can see without reading the body.
 *
 * ## No third list
 *
 * Every path here is resolved from the id-406 corpus manifest by fixture `id`
 * (DR-118, `docs/reference/testing/corpus-manifest.json`) — the register is the
 * manifest, this module is only the code-side accessor. A fixture that moves is
 * re-registered once and every consumer follows; an id that disappears throws
 * at import rather than surfacing later as a confusing ENOENT inside a
 * `beforeAll`.
 */

import {
  loadCorpusManifest,
  type CorpusManifest,
} from '@/lib/corpus/fixture-manifest';

const manifest: CorpusManifest = loadCorpusManifest();

/**
 * Resolve a fixture's repo-relative path by its manifest id.
 *
 * Throws — loudly and at import time — when the id is absent. That is the
 * point: a silent `undefined` would reach `stageFixture()` and fail much later
 * as an unhelpful staging error.
 */
function path(id: string): string {
  const entry = manifest.fixtures.find((f) => f.id === id);
  if (!entry) {
    throw new Error(
      `fixtures.ts: no fixture registered as "${id}" in the corpus manifest ` +
        `(docs/reference/testing/corpus-manifest.json). If the fixture moved, ` +
        `re-register it there — do not hardcode a path here.`,
    );
  }
  return entry.path;
}

/**
 * PLANE 1 — Platform-corpus CONTENT documents. Real prose and real tables.
 *
 * These are the walked baseline (`staging_mode: walked-baseline`). Use them for
 * anything asserting extraction, chunking, entity_mentions, MIME coverage or
 * Stage-5 behaviour — every test whose subject is "the pipeline processed a
 * document correctly".
 */
export const CONTENT = {
  /** Tabular XLSX — a synthetic sector-spend workbook. Added by id-412 (S524): the corpus had no .xlsx, which is why ~16 tests reached for a blank form instead. */
  sectorSpendXlsx: path('platform-corpus/content/synthetic-sector-spend.xlsx'),
  /** Prose DOCX — synthetic sector-intelligence briefing. */
  sectorIntelDocx: path('platform-corpus/content/synthetic-sector-intel.docx'),
  /** Prose PDF — synthetic capability statement. The PDF-ingest proof id-413 fixed the image for. */
  capabilityStatementPdf: path(
    'platform-corpus/content/synthetic-capability-statement.pdf',
  ),
  /** Markdown — company overview. Dense in org/person entities; the default for entity_mentions work. */
  companyOverviewMd: path(
    'platform-corpus/content/synthetic-company-overview.md',
  ),
  /** Markdown — named client engagements. The richest named-entity surface in the corpus. */
  namedClientEngagementsMd: path(
    'platform-corpus/content/synthetic-named-client-engagements.md',
  ),
  /** Markdown — delivery methodology. Long-form prose; the natural chunking-boundary subject. */
  methodologyMd: path('platform-corpus/content/synthetic-methodology.md'),
  /** Markdown — deliberately sparse. The edge-case seam (short document, thin extraction). */
  sparseEdgeMd: path('platform-corpus/edge/synthetic-sparse-edge.md'),
} as const;

/**
 * PLANE 2 — blank extraction FORMS. Real product inputs; no prose to speak of.
 *
 * Use these ONLY where the test genuinely exercises form-field extraction. If
 * your assertion is about content_chunks, entity_mentions or chunking, you want
 * {@link CONTENT} — a blank form has no content to extract, and a test that
 * asserts otherwise is measuring nothing.
 *
 * This header used to be false for two of its members (S538): the two British
 * Council `.doc` RFPs are prose, not forms, and now live in
 * {@link SUPPLEMENTARY}. "No prose to speak of" is a load-bearing claim — if a
 * fixture added here has prose, it belongs in one of the other two planes.
 */
export const FORM_TEMPLATE = {
  /** The CSP checklist. THE path that was hardcoded ~16 times, almost always as a stand-in for content it does not contain. */
  cspChecklistXlsx: path(
    'form-templates/csp-cloud-security-principles/Cloud Security Principles Checklist V5_3.xlsx',
  ),
  /** British Council RFP — supplier response annex (DOCX). Staged by the verify driver. */
  supplierResponseDocx: path(
    'form-templates/rfp-british-council/annex_2_supplier_response.docx',
  ),
  /** British Council RFP — pricing approach (XLSX). */
  pricingApproachXlsx: path(
    'form-templates/rfp-british-council/annex_3_pricing_approach.xlsx',
  ),
  /** EFA ITT evaluation matrix (XLSX). Staged by the verify driver. */
  evaluationMatrixXlsx: path(
    'form-templates/itt-services-efa/evaluation-matrix-itt-vol8.xlsx',
  ),
  /** Standard Selection Questionnaire (PDF, PPN 03/24). Staged by the verify driver. */
  selectionQuestionnairePdf: path(
    'form-templates/sq-standard-selection-questionnaire/standard-selection-questionnaire-ppn-03-24.pdf',
  ),
  /** Charnwood ITT services (DOCX). */
  ittServicesDocx: path(
    'form-templates/itt-services-charnwood/ITT Services.docx',
  ),
  /** Legacy binary Office — .xls. Docling supports neither .doc nor .xls; id-404 owns the conversion path. */
  legacyEvaluationMatrixXls: path(
    'form-templates/itt-services-charnwood/ITT Evaluation Matrix.xls',
  ),
} as const;

/**
 * PLANE 3 — SUPPLEMENTARY buyer narrative. Prose the bidder reads; NOT a form
 * to fill in, and NOT client corpus content.
 *
 * These two lived in {@link FORM_TEMPLATE} until S538, which is how a 95k-char
 * prose RFP came to be an `entity_mention` fixture. The const contradicted
 * itself to say so: its header reads "blank extraction FORMS… no prose to
 * speak of" while one member's own comment read "Rich named-entity surface."
 * Measured with `textutil`: 36,515 and 95,117 characters of narrative.
 *
 * In the real British Council pack these RFPs are the buyer's SUPPLEMENTARY
 * narrative and `annex_2_supplier_response.docx` / `annex_3_pricing_approach.xlsx`
 * are the forms to complete. The pack is the live example behind id-404's
 * reframe: *"how does the system decide what is a FORM to extract versus a
 * SUPPLEMENTARY document that only provides context for the human or agent
 * completing the form?"*
 *
 * This group names what these documents ARE. It asserts nothing about what the
 * platform owes them — whether supplementary material is extracted, chunked,
 * embedded or retrievable is a deferred owner ruling (S538 D5), and today the
 * answer is measurably "nothing": `record_embeddings_owner_kind_chk` has no
 * `form_attachment` member, so supplementary material cannot carry a vector.
 *
 * Use these ONLY where the test is about legacy-format containment or the
 * form-versus-supplementary distinction itself. For entity or chunking
 * assertions you want {@link CONTENT}.
 */
export const SUPPLEMENTARY = {
  /** British Council online-TDC-ops RFP (.doc, 258,560 B). Buyer narrative; the NM-3 legacy-containment subject. No Docling route — id-404 owns the conversion path. */
  legacyRfpOnlinetdcopsDoc: path(
    'form-templates/rfp-british-council/rfp_onlinetdcops.doc',
  ),
  /** British Council learning-partners RFP (.doc, 140,800 B). Buyer narrative, entity-dense. No Docling route — id-404 owns the conversion path. */
  legacyRfpLearningPartnersDoc: path(
    'form-templates/rfp-british-council/rfp_-_learning_partners_osch.doc',
  ),
} as const;

/**
 * ENTITY VARIANTS — a minimal pair for Stage-5 cross-document resolution.
 *
 * Two content docs whose ONLY certification-shaped token is one surface variant
 * of the SAME entity: `ISO 27001` and `ISO27001`. A test that asserts Stage-5
 * resolved two surface forms to one canonical needs exactly this — documents
 * that DISAGREE on surface form and AGREE on referent.
 *
 * ## Why these are not in {@link CONTENT}, and why that is load-bearing
 *
 * Every `CONTENT` member is a **walked-baseline** fixture: the nightly seeds and
 * walks the whole `platform-corpus` tree BEFORE the Vitest tier runs, so each
 * one is already an admitted `source_documents` row. `resolve_or_mint_source_identity`
 * is content-hash-first and, on a resolve, rewrites `logical_path` ONLY —
 * `filename` is never re-written (`20260703160100_id138_admission_identity_fn.sql:48-67`).
 * Re-staging a baseline doc under a test prefix therefore resolves onto the
 * BASELINE row, whose filename carries no prefix, and `pollContentItemsFor`'s
 * `filename ILIKE '<prefix>%'` can never match it.
 *
 * These fixtures are `staging_mode: per-test` and **deliberately distinct-bytes**
 * from anything in the baseline, so each staging mints its own row. That
 * property was discovered the hard way at S507 — the CSP XLSX staged here
 * before contains NEITHER surface form, which made the assertion *"structurally
 * unsatisfiable for ANY extractor"* (`cross-document-dedup.integration.test.ts:67`).
 * Do not "tidy" these into the platform corpus, and do not let the two files
 * converge on a shared surface form or on identical bytes.
 *
 * Note the entity_type subtlety: `mock_llm.py` echoes certification-shaped
 * tokens as `entity_type='standard'` DELIBERATELY, because
 * `canonicalise_entity_name`'s ISO normaliser fires only for `certification`
 * and would pre-unify the variants per-document — collapsing them before
 * Stage-5 ever sees a pair.
 */
export const ENTITY_VARIANTS = {
  /** Carries the SPACED surface form `ISO 27001` and no other cert-shaped token. */
  certificationSpacedMd: path('entity-variants/certification-variant-space.md'),
  /** Carries the COMPACT surface form `ISO27001` and no other cert-shaped token. */
  certificationCompactMd: path(
    'entity-variants/certification-variant-nospace.md',
  ),
} as const;
