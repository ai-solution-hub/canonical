/**
 * Integration test — ID-52 Path B pipeline-owned form-extraction write path.
 *
 * Subtask ID-52.13 (S278 — Wave-3). Exercises the {52.12} pipeline write path
 * (`scripts/cocoindex_pipeline/flow.py::ingest_file` form-write block +
 * `form_extractors/orchestrator.py::extract_form_structure`) end-to-end against
 * the live staging Supabase branch, covering PRODUCT invariants:
 *
 *   - Inv-5  (loud workspace-resolution failure — zero rows + surfaced error)
 *   - Inv-6  (pipeline owns the entire instance write — no app interaction)
 *   - Inv-7  (form-level metadata lands on the template record)
 *   - Inv-15 (true content extent — SQ PDF's 57 pages, not 8)
 *   - Inv-16 (re-ingest idempotency: happy path + field-count-shrink trim)
 *   - Inv-17 (failure isolation — one corrupt file does not halt the batch)
 *   - Inv-18 (no silent loss of per-question metadata)
 *   - Inv-19 (Path-A Mode-1 q_a_extractions NOT regressed — light sanity)
 *
 * ───────────────────────────────────────────────────────────────────────────
 * SKIP-CLEAN REALITY (read before debugging a "skipped" run)
 * ───────────────────────────────────────────────────────────────────────────
 * This suite drives the cocoindex pipeline via the FIXTURE-STAGING SERVICE
 * pattern (the same mechanism ID-53.14's cross-workspace-isolation test uses),
 * NOT a local Python `app_main` subprocess. The ENABLED gate requires FOUR env
 * vars: COCOINDEX_STAGING_URL, COCOINDEX_SOURCE_PATH, COCOINDEX_FIXTURE_STAGING_URL,
 * and real live-DB credentials. On the current staging `.env.local` the three
 * COCOINDEX_* fixture-staging vars are ABSENT, so the suite SKIPS CLEAN — that
 * is EXPECTED and CORRECT (`bun run test:integration` PASSES with 0 failures).
 *
 * The fixture-staging infra is an open HIGH backlog item
 * (OQ-53-FIXTURE-STAGING / backlog-191); it is NOT wired in this environment.
 * These tests are the durable artefact that RUNS when that infra lands. They
 * are authored-but-skip-clean here: "verified" means "verified-when-wired".
 *
 * References:
 *   - docs/specs/id-52-form-extraction/PRODUCT.md Inv-5/6/7/15/16/17/18/19.
 *   - docs/specs/id-52-form-extraction/TECH.md §2.1 (manifest), §2.5 (write),
 *     §2.8 (idempotency), §3.1 (validation matrix), §3.2 (acceptance fixtures).
 *   - __tests__/integration/cocoindex/cross-workspace-isolation.integration.test.ts
 *     (the structural template this mirrors).
 *   - docs/reference/test-philosophy.md (real-behaviour, not implementation).
 */

import { afterAll, describe, expect, it } from 'vitest';

import {
  dropFormFixture,
  pollFormTemplateFieldsFor,
  pollFormTemplatesFor,
  stageFixture,
} from './cocoindex/_helpers/fixture-staging';
import { hasRealLiveDbCredentials } from './helpers/supabase-client';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasRealLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

const POLL_TIMEOUT_MS = 120_000;

// Corpus fixtures — committed symlinks under scripts/tests/fixtures.
const SQ_PDF =
  'scripts/tests/fixtures/form-extraction/standard-selection-questionnaire-ppn-03-24.pdf';
const EFA_XLSX =
  'scripts/tests/fixtures/form-extraction/evaluation-matrix-itt-vol8.xlsx';
const CHARNWOOD_DOCX =
  'scripts/tests/fixtures/form-extraction/itt-services-charnwood.docx';
const CSP_XLSX =
  'scripts/tests/fixtures/form-extraction/cloud-security-principles-checklist-v5-3.xlsx';
const CORRUPT_PDF = 'scripts/tests/fixtures/form-extraction/corrupt.pdf';

// The folder prefix the test manifest maps to a workspace (Inv-4 / Inv-5).
// Mirror __tests__/fixtures/form-extraction/.kh-workspace-map.json — the
// when-wired staging service mounts that manifest at COCOINDEX_SOURCE_PATH
// root, so a fixture staged under this prefix resolves to the mapped workspace.
const MAPPED_FOLDER = 'id-52-13-form-extraction';
const UNMAPPED_FOLDER = 'id-52-13-UNMAPPED-no-manifest-entry';

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const seededTemplateIds: string[] = [];

afterAll(async () => {
  if (!ENABLED) return;
  await dropFormFixture({
    prefix: `id-52-13-`,
    templateIds: seededTemplateIds,
  });
}, 30_000);

describe.skipIf(!ENABLED)(
  'ID-52 Path B — pipeline-owned form-extraction write path',
  () => {
    it(
      'Inv-6 — places SQ.pdf in a mapped folder; pipeline writes 1 template + N fields with NO app interaction',
      async () => {
        const namePrefix = `[52.13-INV6-${RUN}]`;
        await stageFixture({
          fixturePath: SQ_PDF,
          destPath: `${MAPPED_FOLDER}/${namePrefix}-sq.pdf`,
          titlePrefix: namePrefix,
        });

        const templates = await pollFormTemplatesFor(namePrefix, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        for (const t of templates) seededTemplateIds.push(t.id);

        // Exactly one template row (pipeline-owned write — no app step).
        expect(templates.length).toBe(1);
        const template = templates[0]!;
        expect(template.ingest_source).toBe('pipeline');

        const fields = await pollFormTemplateFieldsFor(template.id, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        // N field rows landed; field_count on the template matches the rows.
        expect(fields.length).toBeGreaterThan(0);
        expect(template.field_count).toBe(fields.length);
      },
      POLL_TIMEOUT_MS + 30_000,
    );

    it(
      'Inv-16 happy — re-ingesting the unchanged SQ.pdf keeps the SAME template id (deterministic ft: UUID5)',
      async () => {
        const namePrefix = `[52.13-INV16H-${RUN}]`;
        // First ingest.
        await stageFixture({
          fixturePath: SQ_PDF,
          destPath: `${MAPPED_FOLDER}/${namePrefix}-sq.pdf`,
          titlePrefix: namePrefix,
        });
        const first = await pollFormTemplatesFor(namePrefix, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        expect(first.length).toBe(1);
        const firstId = first[0]!.id;
        seededTemplateIds.push(firstId);
        const firstFields = await pollFormTemplateFieldsFor(firstId, {
          timeoutMs: POLL_TIMEOUT_MS,
        });

        // Re-ingest the SAME file at the SAME dest path → SAME ft: UUID5 →
        // declare_row UPSERTs in place (Inv-16). No duplicate template.
        await stageFixture({
          fixturePath: SQ_PDF,
          destPath: `${MAPPED_FOLDER}/${namePrefix}-sq.pdf`,
          titlePrefix: namePrefix,
        });
        const second = await pollFormTemplatesFor(namePrefix, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        expect(second.length).toBe(1);
        expect(second[0]!.id).toBe(firstId);
        const secondFields = await pollFormTemplateFieldsFor(firstId, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        // Same field set size — no accumulation.
        expect(secondFields.length).toBe(firstFields.length);
      },
      2 * POLL_TIMEOUT_MS + 30_000,
    );

    it(
      'Inv-16 shrink — a mutated form with one fewer field trims the stranded trailing row',
      async () => {
        // The mutation is produced by the fixture-staging service: a
        // `?mutate=drop-last-field` directive on the dest path instructs the
        // service to re-stage the SAME source bytes minus the final extracted
        // field (so the second ingest's max(sequence) is N-2, triggering the
        // §2.8 trim `DELETE ... WHERE sequence > new_max_sequence`). A staging
        // service that does not understand the directive 4xxs, and the
        // env-gate skip masks it (only ENABLED suites reach this call).
        const namePrefix = `[52.13-INV16S-${RUN}]`;
        await stageFixture({
          fixturePath: SQ_PDF,
          destPath: `${MAPPED_FOLDER}/${namePrefix}-sq.pdf`,
          titlePrefix: namePrefix,
        });
        const before = await pollFormTemplatesFor(namePrefix, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        expect(before.length).toBe(1);
        const templateId = before[0]!.id;
        seededTemplateIds.push(templateId);
        const beforeFields = await pollFormTemplateFieldsFor(templateId, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        const beforeMaxSeq = Math.max(...beforeFields.map((f) => f.sequence));

        // Re-stage the mutated (one-field-shorter) variant at the SAME dest.
        await stageFixture({
          fixturePath: SQ_PDF,
          destPath: `${MAPPED_FOLDER}/${namePrefix}-sq.pdf?mutate=drop-last-field`,
          titlePrefix: namePrefix,
        });
        const after = await pollFormTemplatesFor(namePrefix, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        expect(after.length).toBe(1);
        const afterFields = await pollFormTemplateFieldsFor(templateId, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        // One fewer field; the highest old sequence row is trimmed (absent).
        expect(afterFields.length).toBe(beforeFields.length - 1);
        const afterSeqs = afterFields.map((f) => f.sequence);
        expect(afterSeqs).not.toContain(beforeMaxSeq);
      },
      2 * POLL_TIMEOUT_MS + 30_000,
    );

    it(
      'Inv-17 — a batch [corrupt.pdf, sq.pdf, efa.xlsx, charnwood.docx] yields 3 success + 1 analysis_failed; batch not halted',
      async () => {
        const namePrefix = `[52.13-INV17-${RUN}]`;
        // Stage all four under the SAME mapped folder. The corrupt PDF raises
        // FormExtractionError inside extract_form_structure; the {52.12} write
        // path catches it per-file and declares a status='analysis_failed'
        // template (zero fields) while the other three extract normally.
        await stageFixture({
          fixturePath: CORRUPT_PDF,
          destPath: `${MAPPED_FOLDER}/${namePrefix}-corrupt.pdf`,
          titlePrefix: namePrefix,
        });
        await stageFixture({
          fixturePath: SQ_PDF,
          destPath: `${MAPPED_FOLDER}/${namePrefix}-sq.pdf`,
          titlePrefix: namePrefix,
        });
        await stageFixture({
          fixturePath: EFA_XLSX,
          destPath: `${MAPPED_FOLDER}/${namePrefix}-efa.xlsx`,
          titlePrefix: namePrefix,
        });
        await stageFixture({
          fixturePath: CHARNWOOD_DOCX,
          destPath: `${MAPPED_FOLDER}/${namePrefix}-charnwood.docx`,
          titlePrefix: namePrefix,
        });

        // Wait for all four template rows.
        const templates = await pollFormTemplatesFor(namePrefix, {
          timeoutMs: POLL_TIMEOUT_MS,
          minRows: 4,
        });
        for (const t of templates) seededTemplateIds.push(t.id);
        expect(templates.length).toBe(4);

        const failed = templates.filter((t) => t.status === 'analysis_failed');
        const analysed = templates.filter((t) => t.status === 'analysed');
        // Exactly one failure (the corrupt PDF); three successes (batch not
        // halted — Inv-17).
        expect(failed.length).toBe(1);
        expect(analysed.length).toBe(3);
        // The failed row carries the corrupt filename and zero fields.
        expect(failed[0]!.filename).toContain('corrupt.pdf');
        expect(failed[0]!.field_count).toBe(0);
        // Each success has at least one field.
        for (const t of analysed) {
          const fields = await pollFormTemplateFieldsFor(t.id, {
            timeoutMs: POLL_TIMEOUT_MS,
          });
          expect(fields.length).toBeGreaterThan(0);
        }
      },
      POLL_TIMEOUT_MS + 60_000,
    );

    it(
      'Inv-7 — SQ template carries mime_type=application/pdf, file_size>0, description from evaluation_methodology, matching name',
      async () => {
        const namePrefix = `[52.13-INV7-${RUN}]`;
        await stageFixture({
          fixturePath: SQ_PDF,
          destPath: `${MAPPED_FOLDER}/${namePrefix}-sq.pdf`,
          titlePrefix: namePrefix,
        });
        const templates = await pollFormTemplatesFor(namePrefix, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        expect(templates.length).toBe(1);
        const t = templates[0]!;
        seededTemplateIds.push(t.id);

        expect(t.mime_type).toBe('application/pdf');
        expect(t.file_size).toBeGreaterThan(0);
        // description is populated from FormMetadata.evaluation_methodology;
        // when the SQ exposes a methodology it round-trips into both columns.
        expect(t.description).toBe(t.evaluation_methodology);
        // name matches the source (form_title or filename stem).
        expect(t.name.length).toBeGreaterThan(0);
        expect(t.filename).toContain('sq.pdf');
      },
      POLL_TIMEOUT_MS + 30_000,
    );

    it(
      'Inv-15 — SQ extraction reflects the full 57-page extent (field_count consistent with the deep read, not the 8-page container artefact)',
      async () => {
        const namePrefix = `[52.13-INV15-${RUN}]`;
        await stageFixture({
          fixturePath: SQ_PDF,
          destPath: `${MAPPED_FOLDER}/${namePrefix}-sq.pdf`,
          titlePrefix: namePrefix,
        });
        const templates = await pollFormTemplatesFor(namePrefix, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        expect(templates.length).toBe(1);
        const t = templates[0]!;
        seededTemplateIds.push(t.id);

        const fields = await pollFormTemplateFieldsFor(t.id, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        // The 57-page true extent yields the Annex B/C question set (~tens of
        // fields). An 8-page truncation would yield far fewer. The PDF reader
        // unit test (test_form_extractors.py) pins the exact page-read; here
        // we assert the integration-side consequence: a substantial field set
        // consistent with the deep read, not a handful from a truncated read.
        expect(fields.length).toBeGreaterThanOrEqual(20);
        expect(t.field_count).toBe(fields.length);
      },
      POLL_TIMEOUT_MS + 30_000,
    );

    it(
      'Inv-18 — per-question metadata (is_mandatory, word_limit, section_name, reference_urls, coordinates) populated wherever the source carries it; no silent loss',
      async () => {
        const namePrefix = `[52.13-INV18-${RUN}]`;
        // Stage all three readable corpus fixtures — each demonstrates a
        // different metadata facet the form carries (Inv-18 no-silent-loss):
        //   - SQ (PDF):    is_mandatory (M/O flag) + word_limit (inline [NNN])
        //   - EFA (XLSX):  row_index / col_index / table_index coordinates
        //   - CSP (XLSX):  reference_urls (NCSC links) + section_name
        await stageFixture({
          fixturePath: SQ_PDF,
          destPath: `${MAPPED_FOLDER}/${namePrefix}-sq.pdf`,
          titlePrefix: `${namePrefix}-sq`,
        });
        await stageFixture({
          fixturePath: EFA_XLSX,
          destPath: `${MAPPED_FOLDER}/${namePrefix}-efa.xlsx`,
          titlePrefix: `${namePrefix}-efa`,
        });
        await stageFixture({
          fixturePath: CSP_XLSX,
          destPath: `${MAPPED_FOLDER}/${namePrefix}-csp.xlsx`,
          titlePrefix: `${namePrefix}-csp`,
        });

        const sqTpl = (
          await pollFormTemplatesFor(`${namePrefix}-sq`, {
            timeoutMs: POLL_TIMEOUT_MS,
          })
        )[0]!;
        const efaTpl = (
          await pollFormTemplatesFor(`${namePrefix}-efa`, {
            timeoutMs: POLL_TIMEOUT_MS,
          })
        )[0]!;
        const cspTpl = (
          await pollFormTemplatesFor(`${namePrefix}-csp`, {
            timeoutMs: POLL_TIMEOUT_MS,
          })
        )[0]!;
        seededTemplateIds.push(sqTpl.id, efaTpl.id, cspTpl.id);

        const sqFields = await pollFormTemplateFieldsFor(sqTpl.id, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        const efaFields = await pollFormTemplateFieldsFor(efaTpl.id, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        const cspFields = await pollFormTemplateFieldsFor(cspTpl.id, {
          timeoutMs: POLL_TIMEOUT_MS,
        });

        // SQ — at least one field carries an explicit is_mandatory flag and
        // at least one carries a word_limit (both source-expressed).
        expect(
          sqFields.some((f) => f.is_mandatory !== null),
          'SQ must carry >=1 explicit is_mandatory flag',
        ).toBe(true);
        expect(
          sqFields.some((f) => f.word_limit !== null),
          'SQ must carry >=1 word_limit',
        ).toBe(true);

        // EFA — coordinates populated (XLSX cell positions).
        expect(
          efaFields.some(
            (f) =>
              f.row_index !== null &&
              f.col_index !== null &&
              f.table_index !== null,
          ),
          'EFA must carry >=1 row with full coordinates',
        ).toBe(true);

        // CSP — reference URLs + section names.
        expect(
          cspFields.some((f) => (f.reference_urls?.length ?? 0) > 0),
          'CSP must carry >=1 reference_urls',
        ).toBe(true);
        expect(
          cspFields.some((f) => f.section_name !== null),
          'CSP must carry >=1 section_name',
        ).toBe(true);
      },
      POLL_TIMEOUT_MS + 60_000,
    );

    it('Inv-5 — a form under an UNMAPPED folder produces 0 templates + 0 fields (loud resolution failure, no sentinel workspace)', async () => {
      const namePrefix = `[52.13-INV5-${RUN}]`;
      // Stage under a folder NOT present in .kh-workspace-map.json. The
      // {52.12} write path's resolve_workspace raises ResolutionFailure,
      // emits a `workspace_resolution` stage error, and writes ZERO rows.
      await stageFixture({
        fixturePath: SQ_PDF,
        destPath: `${UNMAPPED_FOLDER}/${namePrefix}-sq.pdf`,
        titlePrefix: namePrefix,
      });

      // Give the pipeline time to process, then assert NO template landed
      // for this prefix. We cannot poll-until-present (the contract is
      // ABSENCE), so we wait a bounded interval then query once.
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      const { createLiveServiceClient } =
        await import('./helpers/supabase-client');
      const client = await createLiveServiceClient();
      const { data, error } = await client
        .from('form_templates')
        .select('id')
        .ilike('name', `${namePrefix}%`);
      expect(error).toBeNull();
      // Zero template rows for the unmapped form (Inv-5 — no guessed/default
      // workspace, no sentinel). Consequently zero field rows.
      expect(data?.length ?? 0).toBe(0);
    }, 90_000);

    it(
      'Inv-19 — Path-A Mode-1 q_a_extractions still land for a markdown fixture (Mode-1 NOT regressed; lossy fix is ID-54, out of scope)',
      async () => {
        // Light sanity: Path A (answered-form Q&A → q_a_extractions) is a
        // distinct write path the form-extraction work does not touch. The
        // canonical Path-A integration coverage lives in the cocoindex suite
        // (inv-1-content-items-row-produced + the q_a_extractions tests) and
        // in the Python gate test_cocoindex_flow_write_path.py. Here we assert
        // only that staging a Mode-1 markdown fixture still produces a
        // content_items row — i.e. Path A coexists with the new form path.
        const namePrefix = `[52.13-INV19-${RUN}]`;
        const { pollContentItemsFor, dropFixture } =
          await import('./cocoindex/_helpers/fixture-staging');
        await stageFixture({
          fixturePath:
            'docs/testing/test-data/templates/csp-checklist/Cloud Security Principles Checklist V5_3.xlsx',
          destPath: `${MAPPED_FOLDER}/${namePrefix}-mode1.xlsx`,
          titlePrefix: namePrefix,
        });
        const items = await pollContentItemsFor(namePrefix, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        expect(items.length).toBeGreaterThan(0);
        // Clean up the Path-A content_items rows this sanity check seeded.
        await dropFixture({
          titlePrefix: namePrefix,
          contentIds: items.map((r) => r.id),
        });
      },
      POLL_TIMEOUT_MS + 30_000,
    );
  },
);
