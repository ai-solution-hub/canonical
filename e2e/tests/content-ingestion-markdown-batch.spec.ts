/**
 * EP2 §1.11 markdown-batch UI ingest — E2E spec §10.6.
 *
 * Plan: docs/plans/§1.11-ep2-build-plan.md row EP2-T8 acceptance criterion (a).
 * Spec: docs/specs/ep2-markdown-ui-ingest-spec.md §10.6.
 *
 * Flow:
 *   1. Admin (authenticatedPage) → /item/new → "Upload file" tab.
 *   2. Drag-and-drop 3 fixture .md files: foo-final.md (unique),
 *      bar-draft.md (duplicate seeded via DB-direct beforeAll),
 *      baz-conflict.md (unresolved git conflict markers).
 *   3. Click "Analyse files" → wait /api/ingest/markdown analyse response.
 *   4. Assert analysis table renders with correct flags per row.
 *   5. Override draft/final per row (baz-conflict.md → 'final' overriding the
 *      filename heuristic 'unknown' → 'draft' default).
 *   6. Click Import → wait /api/ingest/markdown import response.
 *   7. Pattern E (S212 W2): poll pipeline_runs.status='completed' (max 30s).
 *      Note: per spec §7.2, the orchestrator finalises the row INSIDE the
 *      same request, so by the time the response arrives status is already
 *      terminal — the poll is defensive.
 *   8. Assert post-flight summary card shows correct tile counts and per-file
 *      rows (1 unique stored, 1 dedup-flagged, 1 stored-with-warning).
 *   9. DB assertions:
 *      - 3 new content_items rows (orchestrator inserts ALL 3 — dedup is a
 *        soft-block stamp, NOT a hard skip — see lib/ingest/markdown-
 *        orchestrator.ts:553-561 + memory feedback `dedup_status`).
 *      - bar-draft row has dedup_status='suspected_duplicate' AND
 *        metadata.suspected_duplicate_of equals the seeded id.
 *      - foo-final.md → publication_status='in_review' (D-A: 'final' →
 *        'in_review', NOT 'published').
 *      - bar-draft.md → publication_status='draft' (filename heuristic).
 *      - baz-conflict.md → publication_status='in_review' (per-file
 *        override of 'final' wins over filename heuristic 'unknown' →
 *        'draft' default; see draft-final-to-publication-status.ts).
 *
 * Memory references:
 *   - feedback_e2e_no_workarounds: real fixtures + hard expects only.
 *   - feedback_e2e_conditional_false_pass: NO `if (await X.isVisible()...)`
 *     fallbacks — every assertion is a hard expect.
 *   - feedback_content_text_hash_generated_always: seed payload OMITS
 *     content_text_hash (GENERATED ALWAYS column).
 *   - feedback_radix_select_jsdom_shims: not needed — Playwright drives a
 *     real Chromium, not jsdom.
 */

import { test, expect } from '../fixtures';
import { createServiceClient } from '../fixtures/supabase';
import path from 'node:path';
import fs from 'node:fs';

const FIXTURE_DIR = path.resolve(
  process.cwd(),
  'e2e/fixtures/files/markdown-batch',
);
const FIXTURES = {
  final: path.join(FIXTURE_DIR, 'foo-final.md'),
  draft: path.join(FIXTURE_DIR, 'bar-draft.md'),
  conflict: path.join(FIXTURE_DIR, 'baz-conflict.md'),
};
const SENTINELS = {
  final: 'E2E-MD-BATCH-FINAL-SENTINEL-knowledge-hub',
  draft: 'E2E-MD-BATCH-DRAFT-SENTINEL-knowledge-hub',
  conflict: 'E2E-MD-BATCH-CONFLICT-SENTINEL-knowledge-hub',
};
const DEDUP_SEED_TITLE = 'E2E dedup seed for markdown-batch';

interface CreatedItem {
  itemId: string;
  pipelineRunId?: string | null;
}

test.describe('Content ingestion -- markdown batch (EP2 §1.11 §10.6)', () => {
  const created: CreatedItem[] = [];
  let dedupSeedId: string | null = null;
  let pipelineRunIdsToCleanup: string[] = [];

  // ────────────────────────────────────────────────────────────────────
  // beforeAll — seed an existing content_items row whose normalised
  // content (and therefore generated content_text_hash) matches what
  // the orchestrator computes from bar-draft.md. The orchestrator runs
  //   cleanedBody = cleanMdxTags(parseMarkdownFrontMatter(file).body)
  // bar-draft.md has no front-matter and no MDX (PascalCase) tags, so
  // cleanedBody == file content trimmed. Seeding the row's `content`
  // with the same string makes the DB-side md5(normalise(content))
  // equal — checkExactDuplicate then matches it via the
  // find_exact_duplicates RPC. content_text_hash is GENERATED ALWAYS
  // (memory feedback) — DO NOT include it in the insert payload.
  // ────────────────────────────────────────────────────────────────────
  test.beforeAll(async () => {
    const svc = createServiceClient();

    // Resolve admin user_id (matches authenticatedPage's session) — same
    // pattern as e2e/fixtures/test-data-fixture.ts:312-319.
    const { data: adminRole, error: roleErr } = await svc
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin')
      .limit(1)
      .single();
    if (roleErr || !adminRole?.user_id) {
      throw new Error(
        `Cannot resolve admin user_id for dedup seed: ${roleErr?.message ?? 'no admin row'}`,
      );
    }
    const adminUserId = adminRole.user_id;

    // Read bar-draft.md and trim — mirrors orchestrator's cleanedBody.
    // (No front-matter, no MDX tags ⇒ cleanedBody = content.trim().)
    const fileContent = fs.readFileSync(FIXTURES.draft, 'utf-8').trim();

    // Best-effort: clear any leftover seed from a previous failed run.
    await svc.from('content_items').delete().eq('title', DEDUP_SEED_TITLE);

    const { data, error } = await svc
      .from('content_items')
      .insert({
        title: DEDUP_SEED_TITLE,
        content: fileContent,
        content_type: 'article',
        platform: 'manual',
        ingest_source: 'manual',
        publication_status: 'published',
        created_by: adminUserId,
        content_owner_id: adminUserId,
        // content_text_hash OMITTED — GENERATED ALWAYS column.
      })
      .select('id')
      .single();
    if (error || !data) {
      throw new Error(
        `Dedup seed insert failed: ${error?.message ?? 'no row'}`,
      );
    }
    dedupSeedId = data.id;
  });

  test.afterAll(async () => {
    const svc = createServiceClient();

    // Clean any pipeline_runs we tracked across the suite.
    for (const runId of pipelineRunIdsToCleanup) {
      try {
        await svc.from('pipeline_runs').delete().eq('id', runId);
      } catch (err) {
        console.error('cleanup pipeline_run failed for', runId, err);
      }
    }
    pipelineRunIdsToCleanup = [];

    // Drop the dedup seed last (its v1 history row + the row itself).
    if (dedupSeedId) {
      try {
        await svc
          .from('content_history')
          .delete()
          .eq('content_item_id', dedupSeedId);
        await svc.from('content_items').delete().eq('id', dedupSeedId);
      } catch (err) {
        console.error('cleanup dedup seed failed for', dedupSeedId, err);
      }
      dedupSeedId = null;
    }
  });

  test.afterEach(async () => {
    const svc = createServiceClient();
    while (created.length > 0) {
      const item = created.pop();
      if (!item) continue;
      try {
        // FK order: content_history (FK to content_items) → pipeline_runs
        // (items_created array contains the id) → content_items.
        await svc
          .from('content_history')
          .delete()
          .eq('content_item_id', item.itemId);
        if (item.pipelineRunId) {
          await svc.from('pipeline_runs').delete().eq('id', item.pipelineRunId);
        } else {
          await svc
            .from('pipeline_runs')
            .delete()
            .contains('items_created', [item.itemId]);
        }
        await svc.from('content_items').delete().eq('id', item.itemId);
      } catch (err) {
        console.error('cleanup failed for', item.itemId, err);
      }
    }
  });

  test('drag-drop 3 .md files -> analyse -> import -> assert per-row outcomes', async ({
    authenticatedPage: page,
  }) => {
    // 60s analyse + ~80-100s import + 30s polling buffer + UI navigation.
    test.setTimeout(240_000);

    // Sanity-check fixtures exist and have content.
    expect(fs.statSync(FIXTURES.final).size).toBeGreaterThan(0);
    expect(fs.statSync(FIXTURES.draft).size).toBeGreaterThan(0);
    expect(fs.statSync(FIXTURES.conflict).size).toBeGreaterThan(0);
    expect(dedupSeedId).toBeTruthy();

    // ────────────────────────────────────────────────────────────────
    // 1. Navigate to /item/new and switch to the Upload file tab.
    // ────────────────────────────────────────────────────────────────
    await page.goto('/item/new');
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('tab', { name: /Upload file/i }).click();
    await expect(
      page.locator('section[aria-label="Upload documents"]'),
    ).toBeVisible({ timeout: 10_000 });

    // ────────────────────────────────────────────────────────────────
    // 2. Attach all 3 .md files via the dropzone hidden input.
    //    Three .md files trigger the markdown-batch detection (every
    //    file ends in .md AND files.length > 1) — see upload-tab-
    //    content.tsx:131-136 (`isMarkdownBatch`).
    // ────────────────────────────────────────────────────────────────
    const fileInput = page
      .locator('section[aria-label="Upload documents"] input[type="file"]')
      .first();
    await fileInput.setInputFiles([
      FIXTURES.final,
      FIXTURES.draft,
      FIXTURES.conflict,
    ]);

    // The idle markdown-batch banner appears with 3-files copy.
    await expect(page.getByTestId('markdown-batch-idle-banner')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('markdown-batch-idle-banner')).toContainText(
      '3 files',
    );

    // ────────────────────────────────────────────────────────────────
    // 3. Trigger analyse — click the "Analyse files" button.
    //    Wait for the analyse-phase POST response.
    // ────────────────────────────────────────────────────────────────
    const analysePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/ingest/markdown') &&
        resp.request().method() === 'POST',
      { timeout: 60_000 },
    );
    await page.getByTestId('markdown-batch-analyse-button').click();

    const analyseResp = await analysePromise;
    expect(analyseResp.status()).toBe(200);
    const analyseBody = (await analyseResp.json()) as {
      analysis: Array<{
        filename: string;
        encodingOk: boolean;
        empty: boolean;
        hasConflictMarkers: boolean;
        diffMarkers: { gitConflictCount: number; warning: boolean };
        draftOrFinalHeuristic: 'draft' | 'final' | 'unknown';
        dedupVerdict: { isDuplicate: boolean; existingId?: string };
        contentHash: string;
      }>;
    };
    expect(Array.isArray(analyseBody.analysis)).toBe(true);
    expect(analyseBody.analysis.length).toBe(3);

    const finalAnalysis = analyseBody.analysis.find(
      (a) => a.filename === 'foo-final.md',
    );
    const draftAnalysis = analyseBody.analysis.find(
      (a) => a.filename === 'bar-draft.md',
    );
    const conflictAnalysis = analyseBody.analysis.find(
      (a) => a.filename === 'baz-conflict.md',
    );
    expect(finalAnalysis).toBeTruthy();
    expect(draftAnalysis).toBeTruthy();
    expect(conflictAnalysis).toBeTruthy();

    // foo-final: clean unique row.
    expect(finalAnalysis!.encodingOk).toBe(true);
    expect(finalAnalysis!.empty).toBe(false);
    expect(finalAnalysis!.hasConflictMarkers).toBe(false);
    expect(finalAnalysis!.draftOrFinalHeuristic).toBe('final');
    expect(finalAnalysis!.dedupVerdict.isDuplicate).toBe(false);

    // bar-draft: dedup match against the seeded row (same normalised hash).
    expect(draftAnalysis!.encodingOk).toBe(true);
    expect(draftAnalysis!.draftOrFinalHeuristic).toBe('draft');
    expect(draftAnalysis!.dedupVerdict.isDuplicate).toBe(true);
    expect(draftAnalysis!.dedupVerdict.existingId).toBe(dedupSeedId!);

    // baz-conflict: detector flags git conflict markers; filename heuristic
    // returns 'unknown' (no 'draft' or 'final' substring).
    expect(conflictAnalysis!.hasConflictMarkers).toBe(true);
    expect(
      conflictAnalysis!.diffMarkers.gitConflictCount,
    ).toBeGreaterThanOrEqual(1);
    expect(conflictAnalysis!.diffMarkers.warning).toBe(true);
    expect(conflictAnalysis!.draftOrFinalHeuristic).toBe('unknown');
    expect(conflictAnalysis!.dedupVerdict.isDuplicate).toBe(false);

    // ────────────────────────────────────────────────────────────────
    // 4. Assert the analysis table rendered with one row per file +
    //    visible flags (Diff markers warn on baz-conflict, Hash match
    //    on bar-draft).
    // ────────────────────────────────────────────────────────────────
    await expect(page.getByTestId('markdown-analysis-table')).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByTestId('markdown-analysis-row-foo-final.md'),
    ).toBeVisible();
    await expect(
      page.getByTestId('markdown-analysis-row-bar-draft.md'),
    ).toBeVisible();
    await expect(
      page.getByTestId('markdown-analysis-row-baz-conflict.md'),
    ).toBeVisible();

    // Conflict-marker row surfaces the warn copy.
    await expect(
      page
        .getByTestId('markdown-analysis-row-baz-conflict.md')
        .getByText(/Diff markers detected/i),
    ).toBeVisible();

    // Dedup row surfaces the hash-match badge. Use the link role rather than
    // text — the badge's accessible link wraps both an aria-hidden visible
    // span and a sr-only span, so getByText() trips strict-mode (matches both).
    // The link role disambiguates to the single accessible element.
    await expect(
      page
        .getByTestId('markdown-analysis-row-bar-draft.md')
        .getByRole('link', { name: /Hash match/i }),
    ).toBeVisible();

    // ────────────────────────────────────────────────────────────────
    // 5. Per-row override: change baz-conflict.md from default 'draft'
    //    (heuristic 'unknown' → effective 'draft' per
    //    effectiveDraftFinal in markdown-analysis-table.tsx) to 'final'.
    //    This should map to publication_status='in_review' (D-A).
    // ────────────────────────────────────────────────────────────────
    const conflictDraftFinalSelect = page.getByLabel(
      /Draft or final for baz-conflict\.md/i,
    );
    await conflictDraftFinalSelect.click();
    // Radix renders the popover at the document root; pick the option.
    await page
      .getByRole('option', { name: /^final$/i })
      .first()
      .click();
    // Confirm the trigger now displays "final".
    await expect(conflictDraftFinalSelect).toContainText(/final/i, {
      timeout: 5_000,
    });

    // ────────────────────────────────────────────────────────────────
    // 6. Click Import → wait for the import-phase response.
    // ────────────────────────────────────────────────────────────────
    const importPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/ingest/markdown') &&
        resp.request().method() === 'POST' &&
        resp.status() !== 304,
      { timeout: 180_000 },
    );
    await page.getByTestId('markdown-batch-import').click();

    // While the import runs we expect the importing-phase card to show.
    await expect(page.getByTestId('markdown-batch-importing')).toBeVisible({
      timeout: 10_000,
    });

    const importResp = await importPromise;
    expect(importResp.status()).toBe(200);
    const importBody = (await importResp.json()) as {
      pipeline_run_id: string;
      results_summary: {
        files_processed: number;
        stored: Array<{ id: string; title: string; filename: string }>;
        dedup_flagged: Array<{
          id: string;
          title: string;
          filename: string;
          suspected_duplicate_of: string;
        }>;
        superseded: Array<{
          new_id: string;
          old_id: string;
          filename: string;
        }>;
        skipped_excluded: string[];
        errored: Array<{ filename: string; error: string }>;
      };
    };
    expect(importBody.pipeline_run_id).toBeTruthy();
    expect(importBody.results_summary).toBeTruthy();
    pipelineRunIdsToCleanup.push(importBody.pipeline_run_id);

    // ALL 3 files insert successfully (dedup is a soft-block stamp, NOT a
    // hard skip — see markdown-orchestrator.ts:426-439).
    expect(importBody.results_summary.files_processed).toBe(3);
    expect(importBody.results_summary.stored).toHaveLength(3);
    expect(importBody.results_summary.dedup_flagged).toHaveLength(1);
    expect(importBody.results_summary.dedup_flagged[0].filename).toBe(
      'bar-draft.md',
    );
    expect(
      importBody.results_summary.dedup_flagged[0].suspected_duplicate_of,
    ).toBe(dedupSeedId!);
    expect(importBody.results_summary.errored).toHaveLength(0);
    expect(importBody.results_summary.skipped_excluded).toHaveLength(0);
    expect(importBody.results_summary.superseded).toHaveLength(0);

    // Track all 3 inserted ids for cleanup.
    for (const stored of importBody.results_summary.stored) {
      created.push({
        itemId: stored.id,
        pipelineRunId: importBody.pipeline_run_id,
      });
    }

    // ────────────────────────────────────────────────────────────────
    // 7. Pattern E: poll pipeline_runs.status until 'completed' (≤30s).
    //    The route's terminal UPDATE happens INSIDE the POST handler,
    //    so by the time the response landed status is already terminal.
    //    The poll is defensive (spec §10.6 mandate) — covers a race
    //    where the read replica hasn't caught up yet.
    // ────────────────────────────────────────────────────────────────
    const svc = createServiceClient();
    let runStatus: string | null = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const { data: runRow, error: runErr } = await svc
        .from('pipeline_runs')
        .select('status, items_created')
        .eq('id', importBody.pipeline_run_id)
        .single();
      if (runErr) {
        throw new Error(`pipeline_runs read failed: ${runErr.message}`);
      }
      runStatus = runRow?.status ?? null;
      if (runStatus === 'completed') break;
      if (runStatus === 'failed') {
        throw new Error(`pipeline_runs.status='failed' — orchestrator aborted`);
      }
      // 'running' or 'completed_with_errors' are not expected here (no
      // file errors injected) but tolerate the transient running state.
      await new Promise((r) => setTimeout(r, 1_000));
    }
    expect(runStatus).toBe('completed');

    // Verify items_created carries all 3 inserted ids.
    const { data: runRow } = await svc
      .from('pipeline_runs')
      .select('items_created')
      .eq('id', importBody.pipeline_run_id)
      .single();
    const itemsCreated = (runRow?.items_created as string[] | null) ?? [];
    expect(itemsCreated).toHaveLength(3);
    for (const stored of importBody.results_summary.stored) {
      expect(itemsCreated).toContain(stored.id);
    }

    // ────────────────────────────────────────────────────────────────
    // 8. Post-flight: summary card visible with correct tile counts.
    //    Component testid is `import-summary-card` (NOT `markdown-
    //    import-summary-card`); parent wraps in `markdown-batch-done`.
    // ────────────────────────────────────────────────────────────────
    await expect(page.getByTestId('markdown-batch-done')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('import-summary-card')).toBeVisible();

    await expect(
      page.getByTestId('summary-tile-files-processed'),
    ).toContainText('3');
    await expect(page.getByTestId('summary-tile-stored')).toContainText('3');
    await expect(page.getByTestId('summary-tile-dedup')).toContainText('1');
    await expect(page.getByTestId('summary-tile-errors')).toContainText('0');
    await expect(page.getByTestId('summary-tile-skipped')).toContainText('0');
    await expect(page.getByTestId('summary-tile-superseded')).toContainText(
      '0',
    );

    // Per-file rows visible.
    await expect(
      page.getByTestId('summary-row-stored-foo-final.md'),
    ).toBeVisible();
    // bar-draft.md is flagged in the dedup list (it does NOT also appear in
    // the stored list — the component renders dedup_flagged separately
    // from stored even though the orchestrator inserts it as a row).
    // Looking at import-summary-card.tsx:177-206, `stored.map(...)` iterates
    // stored[] (which contains all 3), so bar-draft DOES render twice:
    // once in stored and once in dedup_flagged. Both rows are present.
    await expect(
      page.getByTestId('summary-row-stored-bar-draft.md'),
    ).toBeVisible();
    await expect(
      page.getByTestId('summary-row-dedup-bar-draft.md'),
    ).toBeVisible();
    await expect(
      page.getByTestId('summary-row-stored-baz-conflict.md'),
    ).toBeVisible();

    // ────────────────────────────────────────────────────────────────
    // 9. DB-side per-row assertions.
    // ────────────────────────────────────────────────────────────────
    const finalStored = importBody.results_summary.stored.find(
      (s) => s.filename === 'foo-final.md',
    )!;
    const draftStored = importBody.results_summary.stored.find(
      (s) => s.filename === 'bar-draft.md',
    )!;
    const conflictStored = importBody.results_summary.stored.find(
      (s) => s.filename === 'baz-conflict.md',
    )!;

    // foo-final.md row: clean dedup, in_review (D-A 'final' → 'in_review').
    const { data: finalRow, error: finalErr } = await svc
      .from('content_items')
      .select(
        'id, content, publication_status, dedup_status, source_file, ingest_source, metadata',
      )
      .eq('id', finalStored.id)
      .single();
    expect(finalErr).toBeNull();
    expect(finalRow!.publication_status).toBe('in_review');
    expect(finalRow!.dedup_status).toBe('clean');
    expect(finalRow!.source_file).toBe('foo-final.md');
    expect(finalRow!.ingest_source).toBe('upload');
    expect(finalRow!.content as string).toContain(SENTINELS.final);

    // bar-draft.md row: dedup-flagged + draft, suspected_duplicate_of seeded id.
    const { data: draftRow, error: draftErr } = await svc
      .from('content_items')
      .select(
        'id, content, publication_status, dedup_status, source_file, metadata',
      )
      .eq('id', draftStored.id)
      .single();
    expect(draftErr).toBeNull();
    expect(draftRow!.publication_status).toBe('draft');
    expect(draftRow!.dedup_status).toBe('suspected_duplicate');
    expect(draftRow!.source_file).toBe('bar-draft.md');
    expect(draftRow!.content as string).toContain(SENTINELS.draft);
    const draftMeta = (draftRow!.metadata ?? {}) as Record<string, unknown>;
    expect(draftMeta.suspected_duplicate_of).toBe(dedupSeedId!);

    // baz-conflict.md row: per-file override of 'final' → in_review (D-A).
    // The override beats the 'unknown' filename heuristic which would
    // default to 'draft'. Conflict markers are warn-only — the row is
    // inserted as content (not auto-excluded).
    const { data: conflictRow, error: conflictErr } = await svc
      .from('content_items')
      .select('id, content, publication_status, dedup_status, source_file')
      .eq('id', conflictStored.id)
      .single();
    expect(conflictErr).toBeNull();
    expect(conflictRow!.publication_status).toBe('in_review');
    expect(conflictRow!.dedup_status).toBe('clean');
    expect(conflictRow!.source_file).toBe('baz-conflict.md');
    expect(conflictRow!.content as string).toContain(SENTINELS.conflict);
  });
});
