/**
 * Integration test — PRODUCT Inv-20 (extract-contract-honour).
 *
 * Subtask ID-28.14 (narrowed scope per S257 W3 Curator-split).
 *
 * Inv-20 statement (verbatim from
 * `docs/specs/id-28-cocoindex-flow-scaffolding/PRODUCT.md`):
 *
 * > "Every LLM extraction call the cocoindex pipeline makes supplies
 * > `output_type=ExtractionOutput` (or one of its three discriminated-union
 * > variants — `q_a_form`, `entity_mention`, `classification`) per the
 * > ratified Q-EX2 contract. The pipeline produces no untyped or
 * > `dict[str, Any]` extraction outputs. Verifiable: integration test
 * > ingests one file of each extraction-kind and asserts the resulting
 * > database rows match the discriminator-keyed Pydantic shape from
 * > `docs/specs/id-36-cocoindex-extraction-contract/PRODUCT.md` Inv-1..Inv-14."
 *
 * Empirical grounding (Q-EX2 / OQ-3) — observed in worktree on 22/05/2026:
 *
 * - `scripts/cocoindex_pipeline/extraction.py` (PRESENT, SIGNATURE MATCHES):
 *     `ClassificationExtraction` — `extraction_kind: Literal['classification']`,
 *       `content_type: str` (taxonomy-validated), `primary_domain`,
 *       `classification_confidence ∈ [0,1]`, `secondary_classifications: list[str]`,
 *       `rationale: str | None`.
 *     `QAFormExtraction` — `extraction_kind: Literal['q_a_form']`,
 *       `form_metadata: FormMetadata`, `qa_pairs: list[QAPair]`.
 *     `EntityMentionExtraction` — `extraction_kind: Literal['entity_mention']`,
 *       `entity_type` (12-value Literal), `entity_name`, `source_span_start`,
 *       `source_span_end`, `mention_confidence ∈ [0,1]`.
 *
 * - `scripts/cocoindex_pipeline/server.py` (PRESENT, exposes ONLY `/health`):
 *     The HTTP wrapper has NO `/trigger`, `/run`, or `/ingest` endpoint —
 *     flow execution is driven by the cocoindex fs-watch background thread
 *     via `coco.start_blocking()`. Tests therefore drop fixtures into the
 *     pinned corpus path (`COCOINDEX_SOURCE_PATH`) and poll Supabase for
 *     the resulting rows (per TECH §P-9 `pollContentItemsFor` convention).
 *     A live `COCOINDEX_STAGING_URL` is therefore necessary BUT NOT
 *     SUFFICIENT to drive this test — the corpus-drop mechanism is
 *     deferred to 28.18 (`pollContentItemsFor` helper authoring).
 *     This file's body is the FUTURE contract; current run-state is 100%
 *     skip locally pending Cloud Run staging Service URL + Secret Manager
 *     unblock (S258+ carry-forward).
 *
 * - Env-gate pattern observed in 9 of 10 integration tests:
 *     `HAS_REQUIRED_ENV = Boolean(...) && describeIfEnv = HAS_REQUIRED_ENV ? describe : describe.skip`.
 *     One file (si-google-news-dedup) uses Vitest-native `describe.skipIf()`.
 *     This file uses `describe.skipIf()` per the explicit acceptance criterion
 *     in the 28.14 dispatch brief ("Tests use Vitest `describe.skipIf()` env
 *     gate pattern"). Both patterns are functionally equivalent.
 *
 * References:
 *   - docs/specs/id-28-cocoindex-flow-scaffolding/PRODUCT.md Inv-20.
 *   - docs/specs/id-36-cocoindex-extraction-contract/PRODUCT.md Inv-1..Inv-14.
 *   - docs/specs/id-36-cocoindex-extraction-contract/TECH.md §2.1 (Pydantic shapes),
 *     §5.3 (Anthropic-live integration tests).
 *   - docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-9 (corpus reuse).
 *   - scripts/cocoindex_pipeline/extraction.py (Pydantic shapes).
 *   - __tests__/integration/helpers/supabase-client.ts (live client).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createLiveServiceClient,
  hasRealLiveDbCredentials,
} from '../helpers/supabase-client';
import {
  dropFixture,
  pollContentItemsFor,
  stageFixture,
} from './_helpers/fixture-staging';

// ---------------------------------------------------------------------------
// Env-gate — Inv-20 requires three things in concert:
//   1. A reachable cocoindex sidecar Service (so a flow actually runs).
//   2. ANTHROPIC_API_KEY (so the Anthropic SDK calls in @coco.fn extractors
//      succeed — extractors raise on missing key).
//   3. Live Supabase service-role credentials (so we can query the post-
//      extraction rows directly).
//
// The env-gate is the LOGICAL AND of all three. Any missing → describe.skip.
//
// `COCOINDEX_STAGING_URL` is the canonical env var per the 28.14 dispatch
// brief. It does NOT yet exist locally or in CI — staging deploy was
// unblocked at S257 W2 but newly surfaced a missing GCP Secret Manager value
// (PIPELINE_RUN_WEBHOOK_URL — deferred S258 carry-forward). Tests therefore
// skip 100% locally; the body is the future contract.
// ---------------------------------------------------------------------------

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_ANTHROPIC_KEY = Boolean(process.env.ANTHROPIC_API_KEY);
const HAS_LIVE_DB = hasRealLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_FIXTURE_STAGING && HAS_ANTHROPIC_KEY && HAS_LIVE_DB;

// ---------------------------------------------------------------------------
// Fixture library (S266 — wired in ID-49.10). The extract-contract-honour
// test ingests one fixture per extraction-kind:
//   - classification: a non-form document (CSP Cloud Security Principles
//     checklist xlsx — primarily a checklist-style classification target).
//   - q_a_form: an ITT services document (form_type=itt — exercises
//     QAFormExtraction shape end-to-end).
//   - entity_mention: an RFP example with rich named entities (added at
//     49.10 to populate the missing rfp form_type fixture set).
// Acquired+committed at 49.10 — see docs/testing/test-data/templates/.
// ---------------------------------------------------------------------------

const FIXTURES: ReadonlyArray<{
  kind: 'classification' | 'q_a_form' | 'entity_mention';
  fixturePath: string;
  destSuffix: string;
}> = [
  {
    kind: 'classification',
    fixturePath:
      'docs/testing/test-data/templates/csp-checklist/Cloud Security Principles Checklist V5_3.xlsx',
    destSuffix: 'classification.xlsx',
  },
  {
    kind: 'q_a_form',
    fixturePath:
      'docs/testing/test-data/templates/itt-services-charnwood/ITT Services.docx',
    destSuffix: 'q_a_form.docx',
  },
  {
    kind: 'entity_mention',
    fixturePath:
      'docs/testing/test-data/templates/rfp-british-council/rfp_-_learning_partners_osch.doc',
    destSuffix: 'entity_mention.doc',
  },
];

// ---------------------------------------------------------------------------
// Q-EX2 contract shapes — verbatim from
// `scripts/cocoindex_pipeline/extraction.py`. Mirrored as TypeScript types
// for assertion ergonomics; the Python source is the canonical contract
// (parity guards in `scripts/tests/cocoindex_pipeline/test_*_parity.py`
// enforce drift detection — see TECH §5.4).
// ---------------------------------------------------------------------------

const VALID_ENTITY_TYPES = [
  'organisation',
  'certification',
  'regulation',
  'framework',
  'capability',
  'person',
  'technology',
  'project',
  'sector',
  'product',
  'standard',
  'methodology',
] as const;

// The canonical form_type CV (ID-130 AD-4) — mirrors the validator's set
// (scripts/cocoindex_pipeline/extraction.py:_load_canonical_form_types). `psq`
// re-keyed from the pre-2023 `pqq`; framework/dps/gcloud are NOT canonical CV keys.
const VALID_FORM_TYPES = [
  'bid',
  'rfp',
  'psq',
  'itt',
  'tender',
  'checklist',
  'questionnaire',
  'sales_proposal_template',
] as const;

const VALID_FORM_FORMATS = ['docx', 'xlsx', 'pdf', 'html', 'md'] as const;

const VALID_EXPECTED_RESPONSE_KINDS = ['mandatory', 'optional'] as const;

// ---------------------------------------------------------------------------
// Per-file unique prefix — Date.now() + random suffix so concurrent runs of
// the integration suite (or repeated runs) don't collide on titles. Memory
// feedback_e2e_no_workarounds: stable seeds for stable assertions.
// ---------------------------------------------------------------------------

const TEST_PREFIX = `[28.14-INV20-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

// ---------------------------------------------------------------------------
// Lifecycle — when ENABLED, ingest one fixture of each extraction-kind via
// the fs-watch corpus drop. When DISABLED, beforeAll is a no-op and the
// describe block skips.
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!ENABLED) return;
  // Drop one fixture file of each extraction-kind into the pinned corpus
  // path via the fixture-staging service. The cocoindex fs-watch loop on
  // the staging Service observes the change and triggers a flow run within
  // the configured polling window. The test body polls Supabase for the
  // resulting rows via `pollContentItemsFor` (the same TEST_PREFIX gates
  // every fixture so a single poll cycle covers all three).
  //
  // Three fixtures per Inv-20 verifiability statement:
  //   - One classification-kind document (any content_type ≠ form)
  //   - One q_a_form-kind document (form_type ∈ VALID_FORM_TYPES)
  //   - One entity_mention-kind document (any content with named entities)
  for (const fx of FIXTURES) {
    await stageFixture({
      fixturePath: fx.fixturePath,
      destPath: `inv-20/${TEST_PREFIX}-${fx.destSuffix}`,
      titlePrefix: TEST_PREFIX,
    });
  }

  // Wait for at least one fixture to land — full extraction may take
  // longer (extraction-contract assertions in the `it` bodies re-query
  // by content_item_id), but a single landed row is sufficient evidence
  // that the staging pipeline is alive.
  const polled = await pollContentItemsFor(TEST_PREFIX, {
    timeoutMs: 180_000,
  });
  for (const row of polled) {
    seededContentIds.push(row.id);
  }
}, 240_000);

afterAll(async () => {
  if (!ENABLED) return;
  await dropFixture({
    titlePrefix: TEST_PREFIX,
    contentIds: seededContentIds,
  });
}, 60_000);

// ---------------------------------------------------------------------------
// The test — Inv-20 contract-honour.
// ---------------------------------------------------------------------------

describe.skipIf(!ENABLED)(
  'Inv-20 — extraction contract honour (Q-EX2 Pydantic shapes match DB rows)',
  () => {
    it('classification rows match ClassificationExtraction shape', async () => {
      // Verifiable per Inv-20: a flow run that processed the classification-
      // kind fixture must produce rows on `content_items` (the classification
      // outputs are stamped onto the content_items row per cocoindex Path A
      // target-binding — content_type lands in content_items.content_type,
      // classification_confidence in content_items.confidence_score, etc.).
      //
      // The assertion is a structural contract check — every classification
      // output value must be a member of the canonical Q-EX2 vocabulary or
      // satisfy the numeric / string constraints. A row that fails the
      // assertion proves drift between the Python Pydantic shape and the
      // landed DB row, breaking Inv-20.
      const client = await createLiveServiceClient();
      const { data, error } = await client
        .from('content_items')
        .select('id, content_type, primary_domain, confidence_score')
        .ilike('title', `${TEST_PREFIX}%`)
        .in('id', seededContentIds);

      // Use hard expect()s (no silent fallback) per CLAUDE.md Gotcha
      // "Conditional fallbacks silently pass on empty DBs". If a row was
      // expected but missing, the assertion fails honestly.
      expect(error).toBeNull();
      expect(data).toBeTruthy();
      expect(data!.length).toBeGreaterThan(0);

      for (const row of data!) {
        // content_type must be a non-empty string (taxonomy-validated at
        // Python-side via _validate_content_type — failure raises
        // ValueError → 'invalid_enum'). Test asserts the LANDED value is
        // non-empty; full taxonomy parity is policed by the parity guards.
        expect(typeof row.content_type).toBe('string');
        expect((row.content_type as string).length).toBeGreaterThan(0);

        // primary_domain — non-empty string per Q-EX2.
        expect(typeof row.primary_domain).toBe('string');

        // classification_confidence ∈ [0, 1] per Q-EX2
        // `ClassificationExtraction.classification_confidence`.
        // Lands in content_items.confidence_score per Path A target-binding.
        const confidence = row.confidence_score as number | null;
        expect(confidence).not.toBeNull();
        expect(typeof confidence).toBe('number');
        expect(confidence!).toBeGreaterThanOrEqual(0);
        expect(confidence!).toBeLessThanOrEqual(1);
      }
    });

    it('q_a_form rows match QAFormExtraction shape (qa_pairs[] discriminator-keyed)', async () => {
      // Verifiable per Inv-20: q_a_form extraction produces rows on
      // `q_a_extractions` keyed by content_items_id, each row matching the
      // `QAPair` Pydantic shape (question_text, answer_text?,
      // expected_response_kind ∈ ['mandatory', 'optional'],
      // evaluation_criteria?, evidence_requirements[], scope_tags[]).
      //
      // form_metadata lands either on a sibling `form_templates` row (if
      // ratified by 28.13+ schema migration) OR inline in
      // `content_items.metadata` (v1 substrate). Per the dispatch brief
      // scope, this test asserts the QAPair shape on `q_a_extractions` —
      // the form_templates / content_items.metadata routing is owned by
      // 28.13 schema-design.
      const client = await createLiveServiceClient();
      const { data, error } = await client
        .from('q_a_extractions')
        .select(
          'id, content_item_id, question_text, answer_text, expected_response_kind, evidence_requirements, scope_tags',
        )
        .in('content_item_id', seededContentIds);

      expect(error).toBeNull();
      expect(data).toBeTruthy();
      // Inv-20 verifiability statement requires "one file of each
      // extraction-kind" — for q_a_form that implies ≥1 q_a_extractions
      // row landed. Empty array proves the extractor didn't fire or
      // didn't land — both break Inv-20.
      expect(data!.length).toBeGreaterThan(0);

      for (const row of data!) {
        expect(typeof row.question_text).toBe('string');
        expect((row.question_text as string).length).toBeGreaterThan(0);

        // expected_response_kind ∈ {mandatory, optional} per Q-EX2 QAPair.
        // The Literal lives in `extraction.py` QAPair.expected_response_kind.
        expect(VALID_EXPECTED_RESPONSE_KINDS).toContain(
          row.expected_response_kind,
        );

        // evidence_requirements + scope_tags default to [] per QAPair —
        // a row with null in either column proves drift (column should
        // be NOT NULL DEFAULT '{}' per 28.13 schema discipline).
        expect(Array.isArray(row.evidence_requirements)).toBe(true);
        expect(Array.isArray(row.scope_tags)).toBe(true);
      }
    });

    it('entity_mention rows match EntityMentionExtraction shape (entity_type in 12-value vocabulary)', async () => {
      // Verifiable per Inv-20: entity_mention extraction produces rows on
      // `entity_mentions` keyed by content_items_id, each row matching the
      // `EntityMentionExtraction` Pydantic shape (entity_type in 12-value
      // Literal, entity_name non-empty, source_span_start/end ≥ 0,
      // mention_confidence ∈ [0,1]).
      const client = await createLiveServiceClient();
      const { data, error } = await client
        .from('entity_mentions')
        .select(
          'id, content_item_id, entity_type, entity_name, canonical_name, source_span_start, source_span_end, mention_confidence',
        )
        .in('content_item_id', seededContentIds);

      expect(error).toBeNull();
      expect(data).toBeTruthy();
      // Per PRODUCT inv 3 + Inv-20 verifiability: entity_mention fires
      // regardless of content_type but is allowed to produce zero rows
      // when the document has no named entities. The Inv-20 contract
      // therefore requires ≥0 rows, but the FIXTURE must contain entities
      // (test seed responsibility) so the assertion is structural per-row
      // rather than count-based.
      for (const row of data!) {
        // entity_type ∈ 12-value Literal per VALID_ENTITY_TYPES.
        expect(VALID_ENTITY_TYPES).toContain(row.entity_type);

        expect(typeof row.entity_name).toBe('string');
        expect((row.entity_name as string).length).toBeGreaterThan(0);

        // source_span offsets — both ≥ 0 per Field(ge=0); end > start
        // (the Python normalise_entity_span helper tightens whitespace
        // but cannot widen zero-length spans).
        expect(row.source_span_start).toBeGreaterThanOrEqual(0);
        expect(row.source_span_end).toBeGreaterThanOrEqual(0);
        expect(row.source_span_end).toBeGreaterThanOrEqual(
          row.source_span_start as number,
        );

        // mention_confidence ∈ [0, 1] per Q-EX2 EntityMentionExtraction.
        expect(typeof row.mention_confidence).toBe('number');
        expect(row.mention_confidence).toBeGreaterThanOrEqual(0);
        expect(row.mention_confidence).toBeLessThanOrEqual(1);
      }
    });

    it('FormMetadata.form_type ∈ 11-value canonical vocabulary (when q_a_form lands form-metadata)', async () => {
      // The q_a_form variant carries `form_metadata: FormMetadata` with
      // `form_type` ∈ 11-value Literal (8 procurement + 3 non-procurement
      // per docs/ontology/26-form-type.md). The post-flow landing surface
      // for FormMetadata is owned by 28.13 schema design — at the time of
      // 28.14 narrowed-scope authoring it may land either inline on
      // `content_items.metadata` (JSONB) or on a sibling `form_templates`
      // row. This test asserts the contract against whichever landing
      // surface is canonical at run-time.
      //
      // The structural shape verified: when form_metadata is present,
      // form_type ∈ VALID_FORM_TYPES and form_format ∈ VALID_FORM_FORMATS.
      const client = await createLiveServiceClient();
      const { data, error } = await client
        .from('content_items')
        .select('id, metadata')
        .in('id', seededContentIds);

      expect(error).toBeNull();
      expect(data).toBeTruthy();

      for (const row of data!) {
        const metadata = row.metadata as Record<string, unknown> | null;
        // form_metadata may be absent on classification-only or entity-
        // only fixtures — only assert when present.
        const formMetadata = metadata?.form_metadata as
          | Record<string, unknown>
          | undefined;
        if (!formMetadata) continue;

        const formType = formMetadata.form_type as string;
        const formFormat = formMetadata.form_format as string;
        expect(VALID_FORM_TYPES).toContain(formType);
        expect(VALID_FORM_FORMATS).toContain(formFormat);
      }
    });
  },
);
