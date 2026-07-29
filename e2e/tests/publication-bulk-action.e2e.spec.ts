/**
 * §5.3 publication approval gate Wave 2 — UI multi-select + bulk action bar.
 *
 * Spec: docs/specs/publication-approval-gate-spec.md v1 §3 (UI surface) +
 *       §8.4 AC-bulk-4.x (UI acceptance criteria).
 *
 * Surface under test (post-merge): the "Awaiting publication" tab (tab 6)
 * on /review renders per-row checkboxes; selecting ≥1 row mounts a sticky
 * bulk action bar at the top of the queue with "Approve selected" and
 * "Return selected to draft" affordances. Both fire a POST to
 * `/api/review/publication-bulk-action` after a confirmation dialog. On
 * success a sonner toast appears, the queue refetches, and selection
 * clears.
 *
 * Coverage map:
 *   Test 1 — Admin happy path multi-select + approve         (AC-bulk-4.2/4.6/4.7)
 *   Test 2 — Editor happy path bulk-approve (PR-1 RBAC)      (AC-bulk-4.6 + spec §5.1)
 *   Test 3 — Return-to-draft flow                            (AC-bulk-4.6/4.7)
 *   Test 4 — Cancel confirmation                             (AC-bulk-4.6 cancel branch)
 *   Test 5 — Cap-exceeded UX (>50 selection)                 (spec §4.2 D-3) — SKIPPED
 *
 * IMPORTANT — runs against post-W4 merged main; will FAIL in W1 worktree
 * before IMPL-A1 + IMPL-A2 merge (the bulk action bar UI is not yet in
 * main when this spec lands). The W4 verifier runs the spec after both
 * implementation agents merge.
 *
 * Fixture seeding strategy:
 *   `test.beforeAll` inserts N publication_status='in_review' items with
 *   the admin user as `created_by`. Cleanup happens in `test.afterAll`
 *   (delete by title prefix). Mirrors the seeding pattern in
 *   `content-ingestion-markdown-batch.spec.ts`.
 *
 *   ID-131.19 M6 retirement (S450 GO tail): `content_items` (+
 *   `content_history`) DROPPED at M6; `app/api/review/publication-bulk-action/route.ts`
 *   was ALREADY re-pointed onto `source_documents` and no longer writes a
 *   content_history audit row at all (Wave 1 Fix 4) — the fixture below
 *   seeds `source_documents` directly and the cleanup no longer needs a
 *   history-row pass.
 *
 *   `feedback_supabase_branch_data_empty`: persistent staging branches
 *   start data-empty for application rows; we explicitly seed and never
 *   assume pre-existing in_review rows.
 *
 * Memory references:
 *   - `feedback_e2e_no_workarounds`: real seed + hard expects only.
 *   - `feedback_e2e_conditional_false_pass`: NO `if (await X.isVisible()...)`.
 *     Every assertion is a hard `expect(...).toBeVisible()`.
 *   - `feedback_content_text_hash_generated_always`: seed payload OMITS
 *     `content_text_hash` (GENERATED ALWAYS column).
 *   - `feedback_eval_scripts_assume_populated_db`: this spec OWNS its
 *     fixtures via beforeAll; it does not assume a populated DB.
 */

import { test, expect } from '../fixtures';
import { createServiceClient } from '../fixtures/supabase';
import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Title prefix for all rows seeded by this spec — used for delete cleanup. */
const SEED_PREFIX = '[E2E-S220-PUB-BULK]';

/** Bulk-action endpoint path — verbatim per spec §4.1 + route file. */
const BULK_ENDPOINT_PATH = '/api/review/publication-bulk-action';

/** Default seed size for happy-path tests (Tests 1, 2, 3). */
const DEFAULT_SEED_COUNT = 4;

/** Smaller seed for the cancel test (Test 4). */
const CANCEL_SEED_COUNT = 2;

/**
 * Accessible name of the return-to-draft action in the bulk bar.
 *
 * This now equals the VISIBLE text, and that is the point. The button
 * previously carried `aria-label="Return selected items to draft"` over visible
 * text reading "Return selected to draft" — the aria-label won for
 * `getByRole(...{ name })`, and because "items" was inserted mid-string the
 * visible text was not a substring of the accessible name. That is a WCAG 2.5.3
 * (Label in Name) failure: a voice-control user saying the words they can see
 * would not activate the control.
 *
 * Owner-ratified fix (S494): the redundant aria-label was dropped rather than
 * the visible text changed, so the accessible name is now derived from the
 * visible text. The Approve button keeps its aria-label because that one
 * *appends* ("Approve selected" -> "Approve selected items"), which satisfies
 * 2.5.3.
 *
 * The visible-text assertion at the site below is kept deliberately, so the two
 * are pinned independently and a future re-divergence fails loudly.
 */
const RETURN_TO_DRAFT_ACCESSIBLE_NAME = /^Return selected to draft$/;

/**
 * Confirmation-dialog action labels, verbatim from
 * `publication-bulk-action-bar.tsx` (`<AlertDialogAction>` children at :215
 * and :235). The dialog *title* carries the count ("Approve 3 items?"); the
 * action button does not, and there is no "Confirm" button on either dialog.
 */
const CONFIRM_APPROVE_NAME = /^Approve$/;
const CONFIRM_RETURN_NAME = /^Return to draft$/;

interface SeedResult {
  /** IDs of rows inserted by `seedInReviewItems`. */
  ids: string[];
  /** Title used for each row (with index suffix). */
  titles: string[];
}

/**
 * Seed N `publication_status='in_review'` `source_documents` rows owned by the
 * admin user. Returns ids + titles for assertion + cleanup.
 *
 * ID-131.19 M6 retirement: `content_items` DROPPED at M6; the production
 * route (app/api/review/publication-bulk-action/route.ts) reads/writes
 * `source_documents` — this fixture matches. `title` has no
 * source_documents equivalent (used only for locator-matching in this
 * spec's UI assertions) — `filename` carries the same seed-prefixed value
 * so the queue UI (which reads `suggested_title ?? filename`) renders it
 * identically to how `title` used to render.
 *
 * Ownership columns (S461 {128.23} reconciliation — both columns this seed
 * used to write are gone from `source_documents`):
 *   - `created_by` never existed on `source_documents`; the equivalent
 *     provenance column is `uploaded_by`.
 *   - `content_owner_id` was relocated onto the polymorphic
 *     `record_lifecycle` facet by ID-131 {131.6} M1a
 *     (`20260628190000_id131_record_lifecycle_facet.sql`).
 * Both writes are repointed below.
 */
async function seedInReviewItems(
  count: number,
  testTag: string,
): Promise<SeedResult> {
  const svc = createServiceClient();

  // Resolve admin user_id (matches authenticatedPage's session) — same
  // pattern as e2e/fixtures/test-data-fixture.ts:312-319 +
  // content-ingestion-markdown-batch.spec.ts:94-105.
  const { data: adminRole, error: roleErr } = await svc
    .from('user_roles')
    .select('user_id')
    .eq('role', 'admin')
    .limit(1)
    .single();
  if (roleErr || !adminRole?.user_id) {
    throw new Error(
      `Cannot resolve admin user_id for in_review seed: ${
        roleErr?.message ?? 'no admin row'
      }`,
    );
  }
  const adminUserId = adminRole.user_id as string;

  // Best-effort clear of any leftover seed rows from a previous failed run
  // (idempotent — title-prefix + tag namespace keeps cleanup scoped).
  await svc
    .from('source_documents')
    .delete()
    .like('filename', `${SEED_PREFIX} ${testTag}%`);

  // id-392 M6 retarget: `source_documents.extracted_text` is legacy
  // (permanently NULL on the pipeline path) and reader surfaces compose the
  // document body from `content_chunks.content` via
  // lib/source-documents/body.ts — the seed body is therefore written as a
  // position-0 content_chunks row per doc (below), not as extracted_text.
  // Dropping the extracted_text write is safe here: row identity is the
  // filename prefix and `content_hash` is a literal tag, neither derived
  // from the body text.
  const titles: string[] = [];
  const inserts: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    const title = `${SEED_PREFIX} ${testTag} item ${i + 1}`;
    titles.push(title);
    inserts.push({
      filename: title,
      summary: `E2E summary for ${title}`,
      content_type: 'article',
      primary_domain: 'Service Delivery',
      publication_status: 'in_review',
      uploaded_by: adminUserId,
      mime_type: 'text/plain',
      file_size: 1,
      content_hash: `${SEED_PREFIX}-${testTag}-${i}`,
      storage_path: `test-fixtures/${SEED_PREFIX}/${testTag}-${i}.txt`,
    });
  }

  const { data, error } = await svc
    .from('source_documents')
    .insert(inserts)
    .select('id, filename')
    .throwOnError();

  if (error || !data) {
    throw new Error(
      `In_review seed insert failed for ${testTag}: ${
        (error as Error | null)?.message ?? 'no rows'
      }`,
    );
  }

  // Re-order ids by title so the assertion order matches the insert order
  // (Postgres does not guarantee `RETURNING` ordering, and the test does
  // not depend on order, but a stable mapping aids debugging).
  const idsByTitle = new Map<string, string>();
  for (const row of data as { id: string; filename: string }[]) {
    idsByTitle.set(row.filename, row.id);
  }
  const ids = titles.map((t) => idsByTitle.get(t) ?? '').filter(Boolean);
  if (ids.length !== count) {
    throw new Error(
      `In_review seed insert returned ${ids.length} rows, expected ${count}`,
    );
  }

  // Reader-visible body per doc (id-392 — see the comment above the insert
  // loop): one position-0 content_chunks row carrying the same body text
  // the extracted_text column used to hold. No separate cleanup needed:
  // `content_chunks_source_document_id_fkey` is ON DELETE CASCADE
  // (20260628200000_id131_extract_reparent.sql), so both `cleanupSeed` and
  // the best-effort pre-clear above take the chunks with the parent rows.
  await svc
    .from('content_chunks')
    .insert(
      titles.map((title, i) => ({
        source_document_id: ids[i]!,
        content: `E2E publication-bulk-action seed body for ${title}.`,
        position: 0,
      })),
    )
    .throwOnError();

  // Content ownership lives on the `record_lifecycle` facet post ID-131
  // {131.6} M1a. We UPDATE rather than INSERT: the {131.38} FACET-MINT
  // AFTER INSERT trigger on `source_documents`
  // (20260706100000_id131_facet_mint.sql) already minted exactly one
  // `owner_kind='source_document'` facet row per row inserted above, and
  // `record_lifecycle_owner_kind_owner_id_key` (UNIQUE on the generated
  // `owner_id`) would reject a second insert with 23505. The row count check
  // keeps the mint assumption honest — a silent 0-row update would leave the
  // seed unowned without anyone noticing.
  const { data: facetRows } = await svc
    .from('record_lifecycle')
    .update({ content_owner_id: adminUserId })
    .eq('owner_kind', 'source_document')
    .in('source_document_id', ids)
    .select('id')
    .throwOnError();

  const facetCount = (facetRows ?? []).length;
  if (facetCount !== count) {
    throw new Error(
      `Expected ${count} record_lifecycle facet rows for the ${testTag} seed, got ` +
        `${facetCount} — the {131.38} forward-mint trigger on source_documents ` +
        `did not fire for every seeded row.`,
    );
  }

  return { ids, titles };
}

/**
 * Cleanup seeded rows. Idempotent — safe to call from `afterEach`/`afterAll`
 * without tracking state per test.
 *
 * ID-131.19 M6 retirement: content_history DROPPED at M6 and the bulk-action
 * route no longer writes an audit trail at all (Wave 1 Fix 4) — no history
 * cleanup pass needed anymore.
 *
 * The `record_lifecycle` facet rows the seed owns need no separate delete:
 * `record_lifecycle_source_document_id_fkey` is `ON DELETE CASCADE`
 * (20260628190000_id131_record_lifecycle_facet.sql), so dropping the
 * source_documents rows takes the facet rows with them. Likewise the
 * seeded body chunks: `content_chunks_source_document_id_fkey` is
 * `ON DELETE CASCADE` (20260628200000_id131_extract_reparent.sql).
 */
async function cleanupSeed(testTag: string): Promise<void> {
  const svc = createServiceClient();
  await svc
    .from('source_documents')
    .delete()
    .like('filename', `${SEED_PREFIX} ${testTag}%`);
}

/**
 * Navigate to /review with the publication-review tab pre-selected via
 * the deep-link URL param (spec §5 third bullet). Asserts the queue
 * heading + the seeded rows render.
 */
async function gotoPublicationReviewTab(page: Page): Promise<void> {
  await page.goto('/review?tab=publication-review');

  // Page-load gate. NOT the "Review Queue" h1: that heading lives in
  // review-content.tsx, which review-tabs.tsx mounts only for tabs 1-5
  // (review-tabs.tsx:305-307 swaps in PublicationReviewQueue for tab 6
  // instead), so it never renders on this tab. Gate on the tablist itself,
  // which is the shell common to every tab.
  await expect(
    page.getByRole('tab', { name: /Awaiting publication/ }),
  ).toBeVisible({ timeout: 15000 });

  // Wait for the awaiting-publication queue section to mount — its
  // aria-label includes the item count, so we match by prefix only.
  await expect(
    page.getByRole('region', { name: /^Awaiting publication —/ }),
  ).toBeVisible({ timeout: 15000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('§5.3 publication-bulk-action — admin happy path', () => {
  const TAG = 'admin-approve';
  let seed: SeedResult;

  test.beforeAll(async () => {
    seed = await seedInReviewItems(DEFAULT_SEED_COUNT, TAG);
  });

  test.afterAll(async () => {
    await cleanupSeed(TAG);
  });

  test('admin selects 3 items and bulk-approves them', async ({
    authenticatedPage: page,
  }) => {
    await gotoPublicationReviewTab(page);

    // Find checkboxes for the first 3 seeded titles. The aria-label is
    // VERBATIM per spec §3.2 line 314: `Select <title> for bulk action`.
    const targetTitles = seed.titles.slice(0, 3);
    const checkboxes = targetTitles.map((title) =>
      page.getByRole('checkbox', {
        name: `Select ${title} for bulk action`,
      }),
    );

    // Initial state — bulk action bar NOT mounted (zero selection)
    // — AC-bulk-4.1.
    await expect(
      page.getByRole('toolbar', { name: 'Bulk publication actions' }),
    ).not.toBeVisible();

    // Per-row checkboxes are visible and unchecked.
    for (const cb of checkboxes) {
      await expect(cb).toBeVisible();
      await expect(cb).not.toBeChecked();
    }

    // Click each checkbox sequentially. The bar should mount on the first
    // click (AC-bulk-4.2) and the counter should update on each subsequent
    // click (AC-bulk-4.3).
    for (const cb of checkboxes) {
      await cb.click();
    }

    const bulkBar = page.getByRole('toolbar', {
      name: 'Bulk publication actions',
    });
    await expect(bulkBar).toBeVisible();

    // Counter live region — aria-live="polite", text "3 of N selected".
    // Spec §3.3 line 337 ("N of M selected"). Match by text-fragment so
    // the test does not depend on whether N includes only the selected
    // items in the visible queue or all paginated items.
    await expect(bulkBar.getByText(/3 of \d+ selected/)).toBeVisible();

    // Action buttons must be enabled.
    const approveSelected = bulkBar.getByRole('button', {
      name: /Approve selected/,
    });
    await expect(approveSelected).toBeEnabled();

    const returnToDraft = bulkBar.getByRole('button', {
      name: RETURN_TO_DRAFT_ACCESSIBLE_NAME,
    });
    await expect(returnToDraft).toBeEnabled();
    // The label a sighted user reads. Asserted separately from the accessible
    // name above precisely because the two currently disagree — pinning both
    // is what makes the WCAG 2.5.3 divergence visible to the next reader
    // instead of silently encoded in one locator.
    await expect(returnToDraft).toHaveText('Return selected to draft');
    await expect(
      bulkBar.getByRole('button', { name: /Clear selection/ }),
    ).toBeEnabled();

    // Click "Approve selected" → AlertDialog opens with verbatim text per
    // spec §3.3 line 349: "Approve N items? This publishes them to the
    // knowledge base immediately." (Radix AlertDialog renders
    // role="alertdialog".)
    await approveSelected.click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    // Title and body are two elements (AlertDialogTitle + AlertDialogDescription),
    // so they must be asserted separately — `getByText` matches within a single
    // element, and the concatenated sentence this spec used to look for exists
    // in no element at all, making that assertion unsatisfiable rather than
    // merely stale.
    await expect(dialog.getByText('Approve 3 items?')).toBeVisible();
    await expect(
      dialog.getByText(
        'This publishes them to the knowledge base immediately.',
      ),
    ).toBeVisible();

    // Click Confirm — AC-bulk-4.6 asserts the POST fires with explicit
    // `method: 'POST'` (NOT PATCH). We verify by intercepting the network
    // request via `waitForResponse`.
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(BULK_ENDPOINT_PATH) &&
        resp.request().method() === 'POST',
      { timeout: 30_000 },
    );

    const confirmButton = dialog.getByRole('button', {
      name: CONFIRM_APPROVE_NAME,
    });
    await confirmButton.click();

    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const responseBody = await response.json();
    expect(responseBody.action).toBe('approve');
    expect(responseBody.totalRequested).toBe(3);
    expect(responseBody.successCount).toBe(3);
    expect(responseBody.failureCount).toBe(0);

    // Assert success toast — sonner renders `[data-sonner-toast]` with
    // text per spec §3.4 line 375: `toast.success("N items published.")`.
    await expect(
      page
        .locator('[data-sonner-toast]')
        .filter({ hasText: /3 items published/ }),
    ).toBeVisible({ timeout: 10_000 });

    // Selection clears + bulk bar unmounts (AC-bulk-4.7).
    await expect(bulkBar).not.toBeVisible({ timeout: 10_000 });

    // Queue refetches — the 3 approved rows transition out of in_review
    // and disappear from tab 6. Wait for at least one of the targets to
    // be gone before asserting all three; the queue rerenders on the
    // invalidate.
    for (const title of targetTitles) {
      await expect(
        page.getByRole('article', { name: `Awaiting publication: ${title}` }),
      ).not.toBeVisible({ timeout: 10_000 });
    }
  });
});

test.describe('§5.3 publication-bulk-action — editor happy path (PR-1 RBAC)', () => {
  const TAG = 'editor-approve';
  let seed: SeedResult;

  test.beforeAll(async () => {
    seed = await seedInReviewItems(DEFAULT_SEED_COUNT, TAG);
  });

  test.afterAll(async () => {
    await cleanupSeed(TAG);
  });

  test('editor can bulk-approve 3 items (RBAC matrix preserved)', async ({
    editorPage: page,
  }) => {
    // Spec §5.1 PR-1 — editor + admin can bulk-approve out of in_review.
    // Mirrors `e2e/tests/role-gating.spec.ts:62` confirming editor sees
    // the review page.
    await gotoPublicationReviewTab(page);

    const targetTitles = seed.titles.slice(0, 3);
    for (const title of targetTitles) {
      await page
        .getByRole('checkbox', { name: `Select ${title} for bulk action` })
        .click();
    }

    const bulkBar = page.getByRole('toolbar', {
      name: 'Bulk publication actions',
    });
    await expect(bulkBar).toBeVisible();

    await bulkBar.getByRole('button', { name: /Approve selected/ }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Approve 3 items\?/)).toBeVisible();

    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(BULK_ENDPOINT_PATH) &&
        resp.request().method() === 'POST',
      { timeout: 30_000 },
    );

    await dialog.getByRole('button', { name: CONFIRM_APPROVE_NAME }).click();

    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.successCount).toBe(3);
    expect(body.failureCount).toBe(0);

    // Editor success path: same toast surface as admin.
    await expect(
      page
        .locator('[data-sonner-toast]')
        .filter({ hasText: /3 items published/ }),
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('§5.3 publication-bulk-action — return to draft', () => {
  const TAG = 'admin-return';
  let seed: SeedResult;

  test.beforeAll(async () => {
    seed = await seedInReviewItems(2, TAG);
  });

  test.afterAll(async () => {
    await cleanupSeed(TAG);
  });

  test('admin selects 2 items and bulk-returns them to draft', async ({
    authenticatedPage: page,
  }) => {
    await gotoPublicationReviewTab(page);

    const targetTitles = seed.titles;
    for (const title of targetTitles) {
      await page
        .getByRole('checkbox', { name: `Select ${title} for bulk action` })
        .click();
    }

    const bulkBar = page.getByRole('toolbar', {
      name: 'Bulk publication actions',
    });
    await expect(bulkBar).toBeVisible();
    await expect(bulkBar.getByText(/2 of \d+ selected/)).toBeVisible();

    await bulkBar
      .getByRole('button', { name: RETURN_TO_DRAFT_ACCESSIBLE_NAME })
      .click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    // Verbatim per spec §3.3 line 354: "Return N items to draft?"
    await expect(dialog.getByText(/Return 2 items to draft\?/)).toBeVisible();

    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(BULK_ENDPOINT_PATH) &&
        resp.request().method() === 'POST',
      { timeout: 30_000 },
    );

    await dialog.getByRole('button', { name: CONFIRM_RETURN_NAME }).click();

    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.action).toBe('return_to_draft');
    expect(body.successCount).toBe(2);
    expect(body.failureCount).toBe(0);

    // Toast: per per-row action bar pattern at
    // publication-review-action-bar.tsx:81 the return-to-draft phrasing
    // is "Returned to draft. ..."; match by text-fragment.
    await expect(
      page
        .locator('[data-sonner-toast]')
        .filter({ hasText: /(returned to draft|2 items? returned)/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Items disappear from tab 6 (now publication_status='draft').
    for (const title of targetTitles) {
      await expect(
        page.getByRole('article', { name: `Awaiting publication: ${title}` }),
      ).not.toBeVisible({ timeout: 10_000 });
    }
  });
});

test.describe('§5.3 publication-bulk-action — cancel confirmation', () => {
  const TAG = 'admin-cancel';
  let seed: SeedResult;

  test.beforeAll(async () => {
    seed = await seedInReviewItems(CANCEL_SEED_COUNT, TAG);
  });

  test.afterAll(async () => {
    await cleanupSeed(TAG);
  });

  test('clicking Cancel on the confirmation dialog does not fire the POST', async ({
    authenticatedPage: page,
  }) => {
    await gotoPublicationReviewTab(page);

    const targetTitle = seed.titles[0];
    const checkbox = page.getByRole('checkbox', {
      name: `Select ${targetTitle} for bulk action`,
    });
    await checkbox.click();
    await expect(checkbox).toBeChecked();

    const bulkBar = page.getByRole('toolbar', {
      name: 'Bulk publication actions',
    });
    await expect(bulkBar).toBeVisible();

    await bulkBar.getByRole('button', { name: /Approve selected/ }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();

    // Spec up an absolute-fail expectation: NO POST should fire after
    // clicking Cancel. We use a short-timeout `waitForResponse` and assert
    // it REJECTS (timeout). Per `feedback_e2e_no_workarounds`: the
    // assertion must be hard — we wrap waitForResponse in expect().rejects
    // so a fired POST surfaces as a clean test failure (not a silent pass).
    let postFired = false;
    const noPostPromise = page
      .waitForResponse(
        (resp) =>
          resp.url().includes(BULK_ENDPOINT_PATH) &&
          resp.request().method() === 'POST',
        { timeout: 3000 },
      )
      .then(() => {
        postFired = true;
      })
      .catch(() => {
        // Expected — the timeout is what we want.
      });

    // Match Cancel button. Radix AlertDialog renders Cancel via
    // AlertDialogCancel (button); spec §3.3 confirms "Confirm | Cancel".
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // Dialog dismisses.
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });

    await noPostPromise;
    expect(postFired).toBe(false);

    // Selection state retained — the checkbox remains checked and the
    // bar is still mounted (AC-bulk-4.6 cancel branch: "no fetch fires").
    await expect(checkbox).toBeChecked();
    await expect(bulkBar).toBeVisible();
  });
});

test.describe('§5.3 publication-bulk-action — cap exceeded (>50)', () => {
  // SKIPPED: seeding 51 in_review rows in a beforeAll inflates the suite
  // budget meaningfully (each insert is a network round-trip to staging
  // Supabase) and the cap-exceeded UX has comprehensive component-level
  // coverage at __tests__/components/review/publication-bulk-action-bar.test.tsx
  // per AC-bulk-4.4 (cap message + aria-disabled action buttons when
  // selectedIds.size > 50).
  //
  // E2E confirmation of cap-disabled buttons is a low-marginal-value
  // duplicate of the component test. Skipping per
  // `feedback_supabase_branch_data_empty` + `feedback_eval_scripts_assume_populated_db`
  // — the spec author MAY revisit this if the component test is later
  // identified as insufficient (e.g. if the cap message is rendered by a
  // server-only path).
  test.skip(
    true,
    '>50 selection cap-exceeded UX is covered by the component test ' +
      '`publication-bulk-action-bar.test.tsx` (AC-bulk-4.4). Seeding 51 rows ' +
      'in beforeAll is excluded from the E2E budget; revisit if a server-' +
      'rendered cap message lands.',
  );

  test('selecting >50 items disables action buttons + surfaces cap message', async () => {
    // No-op — see test.skip rationale above.
  });
});
