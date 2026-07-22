/**
 * Integration test — Path-A Mode-1 sanity check for form extraction.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ID-145 {145.40} — Path-B pipeline-write cases RETIRED (Curator S477 ruling)
 * ───────────────────────────────────────────────────────────────────────────
 * This file used to cover the {52.12} Path-B pipeline-owned form-extraction
 * write path end-to-end (Inv-5/6/7/15/16/17/18). ID-136 "Retire corpus
 * forms-route — forms = manual-upload" (DONE) permanently removed the
 * `ft_target` / `ftf_target` Path-B form-write block from
 * `scripts/cocoindex_pipeline/flow.py::ingest_file` — this is a ratified
 * design decision, not a temporary gap, so those assertions were deleted
 * rather than rewritten: they exercised a write path that no longer exists
 * in production, and the surviving app-side upload route
 * (`app/api/procurement/[id]/forms/route.ts`, `ingest_source='app_upload'`)
 * already has separate coverage in
 * `__tests__/api/procurement-forms.test.ts`.
 *
 * Only Inv-19 (Path-A Mode-1 sanity — still valid, untouched by the Path-B
 * retirement) survives, kept in place here rather than relocated: the only
 * plausible relocation target (`__tests__/integration/cocoindex/`) is a
 * different subdirectory, and the brief prefers keeping it in place over
 * crossing that boundary for a single test.
 *
 * References:
 *   - docs/specs/id-52-form-extraction/PRODUCT.md Inv-19.
 *   - docs/reference/testing/test-philosophy.md (real-behaviour, not implementation).
 */

import { describe, expect, it } from 'vitest';

import { stageFixture } from './cocoindex/_helpers/fixture-staging';
import { hasRealLiveDbCredentials } from './helpers/supabase-client';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasRealLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

const POLL_TIMEOUT_MS = 120_000;

// Corpus fixture — committed symlink under scripts/tests/fixtures.
const EFA_XLSX =
  'scripts/tests/fixtures/form-extraction/evaluation-matrix-itt-vol8.xlsx';

// An arbitrary staging subfolder for this fixture. ID-127.37 (DR-038/056/061)
// retired the folder→workspace manifest premise entirely — this prefix no
// longer resolves through any manifest mapping (workspace is not a scoping
// concept the pipeline consumes any more); it is kept only as a stable,
// namespaced staging path so concurrent integration runs do not collide.
const MAPPED_FOLDER = 'id-52-13-form-extraction';

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!ENABLED)('ID-52 Path A — Mode-1 sanity check', () => {
  it(
    'Inv-19 — Path-A Mode-1 q_a_extractions still land for an xlsx fixture (Mode-1 NOT regressed; lossy fix is ID-54, out of scope)',
    async () => {
      // Light sanity: Path A (answered-form Q&A → q_a_extractions) is a
      // distinct write path the form-extraction work does not touch. The
      // canonical Path-A integration coverage lives in the cocoindex suite
      // (the q_a_extractions tests) and in the Python gate
      // test_cocoindex_flow_write_path.py — the sibling
      // inv-1-content-items-row-produced.integration.test.ts was RETIRED
      // under ID-131.19 (M6 dropped content_items outright; see that
      // Subtask's journal). Here we assert only that staging a Mode-1 xlsx
      // fixture still produces a `source_documents` row (ID-131.19 M6
      // retarget: `pollContentItemsFor` now polls `source_documents`, not
      // the dropped `content_items`) — i.e. Path A coexists with the (now
      // retired) form path. The assertion is corpus-agnostic (a document row
      // is produced), so the EFA fixture stands in for the prior CSP fixture
      // removed by ID-68.5.
      const namePrefix = `[52.13-INV19-${RUN}]`;
      const { pollContentItemsFor, dropFixture } =
        await import('./cocoindex/_helpers/fixture-staging');
      await stageFixture({
        fixturePath: EFA_XLSX,
        destPath: `${MAPPED_FOLDER}/${namePrefix}-mode1.xlsx`,
        titlePrefix: namePrefix,
      });
      const items = await pollContentItemsFor(namePrefix, {
        timeoutMs: POLL_TIMEOUT_MS,
      });
      expect(items.length).toBeGreaterThan(0);
      // Clean up the Path-A source_documents rows this sanity check seeded
      // (ID-131.19 M6 retirement: content_items DROPPED at M6).
      await dropFixture({
        titlePrefix: namePrefix,
        contentIds: items.map((r) => r.id),
      });
    },
    POLL_TIMEOUT_MS + 30_000,
  );
});
