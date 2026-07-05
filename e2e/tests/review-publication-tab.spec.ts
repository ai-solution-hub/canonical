import { test, expect } from '../fixtures';
import { createServiceClient } from '../fixtures/supabase';

/**
 * E2E spec for the /review awaiting-publication tab (S31 W3 OPS-46).
 *
 * Spec: docs/specs/review-page-tabs-refactor-spec.md §10 (revised v1.2,
 * 05/05/2026). Backing unit tests already shipped:
 *   __tests__/components/review/review-tabs.test.tsx
 *   __tests__/components/review/PublicationReviewQueue.test.tsx
 *   __tests__/components/review/publication-review-card.test.tsx
 *   __tests__/components/review/publication-review-action-bar.test.tsx
 *
 * This file covers the missing E2E layer: navigates to
 * `/review?tab=publication-review`, asserts the seeded
 * [E2E-PUB-REVIEW-FIXTURE] row is rendered, clicks Approve, asserts
 * toast + row removal, then asserts the row appears in default search
 * (cross-checks §5.2 visibility gating per
 * publication-lifecycle-state-machine-spec.md §5).
 *
 * Fixture seeding is provisioned ONCE PER CI E2E job by
 * `bun run seed:e2e-users` (which now invokes
 * `seedPublicationReviewFixture()` post-user-seed per spec §10.1). The
 * test does NOT seed inline; if the row is missing, the test FAILS
 * (per `feedback_e2e_conditional_false_pass` — no graceful skips).
 *
 * Hard `expect(X).toBeVisible()` assertions throughout — NO
 * conditional `isVisible(...).catch(() => false)` fallbacks
 * (per `feedback_e2e_conditional_false_pass`).
 *
 * Cleanup contract per spec §10.2: `afterEach` resets the row's
 * `publication_status` back to `'in_review'` so subsequent runs (next
 * worker, next CI job, re-run after Approve) find the deterministic
 * starting state. The row is NEVER deleted (shared across runs).
 */

const FIXTURE_TITLE = '[E2E-PUB-REVIEW-FIXTURE] Awaiting publication test row';

test.describe('Review page — awaiting-publication tab (S31 W3)', () => {
  test.afterEach(async () => {
    // Spec §10.2 — reset the row to the deterministic starting state.
    // Update-by-title rather than reading a seeded id back into the test
    // (the seed runs once per CI job, not per test). The .select('id')
    // chain forces a 200 + row response so the COMMIT is fully visible
    // before control returns (mirrors the test-data-fixture pattern).
    // ID-131.19 M6 retirement: content_items DROPPED at M6. The fixture
    // this row is seeded from (scripts/seed-e2e-users.ts
    // seedPublicationReviewFixture(), content_type='q_a_pair') needs a
    // companion re-point onto `q_a_pairs` — flagged as an out-of-scope
    // production finding for this Subtask (the seeding script is out of
    // the tests/e2e/helpers file-ownership boundary). This reset targets
    // the honest destination that fixture will need once re-pointed.
    const supabase = createServiceClient();
    await supabase
      .from('q_a_pairs')
      .update({ publication_status: 'in_review' })
      .eq('question_text', FIXTURE_TITLE)
      .select('id')
      .throwOnError();
  });

  test('admin can approve an in-review row and it appears in published search', async ({
    authenticatedPage: page,
  }) => {
    // ── Step 1: admin login ──────────────────────────────────────────
    // `authenticatedPage` is the admin fixture (storageState
    // e2e/.auth/admin.json — see playwright.config.ts:18 +
    // e2e/auth.setup.ts:85-94). No explicit login step needed.

    // ── Step 2: navigate to /review?tab=publication-review ──────────
    await page.goto('/review?tab=publication-review');

    // The Awaiting publication tab trigger should be visible and active.
    // Radix tab triggers expose role="tab" with the label as accessible
    // name. We hard-assert visibility — no .or() fallback.
    const awaitingTab = page.getByRole('tab', {
      name: /Awaiting publication/i,
    });
    await expect(awaitingTab).toBeVisible({ timeout: 15000 });
    await expect(awaitingTab).toHaveAttribute('aria-selected', 'true');

    // ── Step 3: assert the in-review fixture row is rendered ────────
    // Hard expect — if the seed didn't run, this fails fast with a clear
    // locator-not-found error rather than skipping.
    const fixtureRow = page.getByText(FIXTURE_TITLE);
    await expect(fixtureRow).toBeVisible({ timeout: 10000 });

    // ── Step 4: click Approve on that row ───────────────────────────
    // The action bar exposes role="toolbar" name="Publication review
    // actions" per components/review/publication-review-action-bar.tsx
    // L113-119. Multiple rows may be present (other in-review items
    // from other test data); we scope to the toolbar adjacent to the
    // fixture row by using Playwright's `locator.locator()` chain.
    //
    // The card + action bar are siblings inside a single <li> per
    // PublicationReviewQueue.tsx L338-354. We anchor on the <li> that
    // contains the fixture title.
    const fixtureItem = page
      .getByRole('listitem')
      .filter({ hasText: FIXTURE_TITLE });
    await expect(fixtureItem).toBeVisible({ timeout: 10000 });

    const approveButton = fixtureItem.getByRole('button', {
      name: /Approve and publish this item/i,
    });
    await expect(approveButton).toBeVisible();
    await expect(approveButton).toBeEnabled();
    await approveButton.click();

    // ── Step 5: assert toast appears confirming the approval ────────
    // sonner renders toasts inside role="status" regions (live region
    // for screen-reader announcements). The success copy is fixed by
    // publication-review-action-bar.tsx L78-82:
    //   'Published. The item is now live in the knowledge base.'
    const toast = page.getByRole('status').filter({ hasText: /published/i });
    await expect(toast).toBeVisible({ timeout: 10000 });

    // ── Step 6: assert row disappears from in-review tab ────────────
    // After PATCH success, the action bar invalidates the
    // publicationReviewQueue + stats keys (per
    // publication-review-action-bar.tsx L70-77), the queue refetches,
    // and the row drops out of in_review.
    await expect(page.getByText(FIXTURE_TITLE)).not.toBeVisible({
      timeout: 10000,
    });

    // ── Step 7: navigate to default search and assert row is now ────
    //          visible in published results
    // Visibility-gating cross-check per spec §10 — published items
    // appear in /browse default search. We use a query that matches the
    // fixture's deterministic title prefix.
    await page.goto(
      `/browse?q=${encodeURIComponent('E2E-PUB-REVIEW-FIXTURE')}`,
    );

    // The row's title contains the prefix — assert it renders as a
    // search result. Hard expect; the published-content visibility
    // gating per publication-lifecycle-state-machine-spec.md §5 must
    // produce this row.
    await expect(page.getByText(FIXTURE_TITLE)).toBeVisible({
      timeout: 15000,
    });

    // ── Step 8 implicit: afterEach resets the row to 'in_review' ────
    // (per spec §10.2 cleanup contract, in the afterEach hook above).
  });
});
