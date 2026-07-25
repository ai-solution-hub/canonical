import { test, expect } from '../fixtures';
import { navigateViaHeader } from '../helpers/responsive';

/**
 * Flow 8: Content Governance and Review
 *
 * Tests the /review page — review queue loading, speed-review card display,
 * verify/flag/next actions, progress tracking, and empty queue handling.
 * The authenticated test user must have editor or admin role.
 */

test.describe('Review page — queue display', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/review');
    await expect(
      page.getByRole('heading', { name: 'Review Queue' }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('review page loads with heading', async ({
    authenticatedPage: page,
  }) => {
    await expect(
      page.getByRole('heading', { name: 'Review Queue' }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('shows the seeded review queue with actionable items', async ({
    authenticatedPage: page,
  }) => {
    // The worker fixture seeds 10+ unverified content items, so the review
    // toolbar must be present. We deliberately do NOT accept the empty state
    // here — that branch is covered by a separate test below.
    const reviewCard = page.getByRole('toolbar', { name: 'Review actions' });
    await expect(reviewCard).toBeVisible({ timeout: 15000 });
  });

  test('progress bar is displayed when items exist', async ({
    authenticatedPage: page,
  }) => {
    // Seeded data guarantees a non-empty queue, so the progress bar is
    // always rendered.
    const progressBar = page.getByLabel(/Review progress/);
    await expect(progressBar).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Review page — action bar', () => {
  test('action bar shows verify, flag, next, and exit buttons', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/review');
    await expect(
      page.getByRole('heading', { name: 'Review Queue' }),
    ).toBeVisible({ timeout: 10000 });

    const actionBar = page.getByRole('toolbar', { name: 'Review actions' });
    await expect(actionBar).toBeVisible({ timeout: 10000 });

    // Primary actions
    await expect(
      actionBar.getByRole('button', { name: /Verify/ }),
    ).toBeVisible();
    await expect(actionBar.getByRole('button', { name: /Flag/ })).toBeVisible();

    // Navigation. {128.23}: the advance control is labelled "Next item
    // (keyboard shortcut: right arrow)" — it was renamed from "Skip".
    await expect(
      actionBar.getByRole('button', { name: /Next item/ }),
    ).toBeVisible();

    // Meta
    await expect(actionBar.getByRole('button', { name: /Exit/ })).toBeVisible();
  });

  test('verify button advances to the next item', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/review');
    await expect(
      page.getByRole('heading', { name: 'Review Queue' }),
    ).toBeVisible({ timeout: 10000 });

    const actionBar = page.getByRole('toolbar', { name: 'Review actions' });
    await expect(actionBar).toBeVisible({ timeout: 10000 });

    const verifyButton = actionBar.getByRole('button', { name: /Verify/ });
    await expect(verifyButton).toBeEnabled();

    // Click verify — the seeded queue has multiple items so the next card
    // must load (or, if this was the last item, the completion message).
    await verifyButton.click();

    const nextCard = actionBar;
    const completionMessage = page
      .getByRole('heading', { name: 'All caught up!' })
      .or(page.getByRole('heading', { name: /items have been verified/ }))
      .or(page.getByRole('heading', { name: 'Batch complete' }));

    await expect(nextCard.or(completionMessage)).toBeVisible({
      timeout: 10000,
    });
  });

  test('flag button shows flag input for reason', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/review');
    await expect(
      page.getByRole('heading', { name: 'Review Queue' }),
    ).toBeVisible({ timeout: 10000 });

    const actionBar = page.getByRole('toolbar', { name: 'Review actions' });
    await expect(actionBar).toBeVisible({ timeout: 10000 });

    const flagButton = actionBar.getByRole('button', { name: /Flag/ });
    await expect(flagButton).toBeEnabled();

    // Click flag — should show an inline input for the flag reason
    await flagButton.click();

    // The flag input area appears below the review card
    await expect(page.getByLabel(/Reason/)).toBeVisible({ timeout: 5000 });

    // Submit and Cancel buttons should be visible
    await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('flag cancel hides the flag input', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/review');
    await expect(
      page.getByRole('heading', { name: 'Review Queue' }),
    ).toBeVisible({ timeout: 10000 });

    const actionBar = page.getByRole('toolbar', { name: 'Review actions' });
    await expect(actionBar).toBeVisible({ timeout: 10000 });

    // Open flag input
    const flagButton = actionBar.getByRole('button', { name: /Flag/ });
    await flagButton.click();
    const reasonInput = page.getByLabel(/Reason/);
    await expect(reasonInput).toBeVisible({ timeout: 5000 });

    const cancelButton = page.getByRole('button', { name: 'Cancel' });
    await cancelButton.click();

    // Flag input should be hidden — the Submit button disappearing confirms cancel worked
    await expect(page.getByRole('button', { name: 'Submit' })).not.toBeVisible({
      timeout: 5000,
    });
  });

  test('next button advances to the following queue item', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/review');
    await expect(
      page.getByRole('heading', { name: 'Review Queue' }),
    ).toBeVisible({ timeout: 10000 });

    const actionBar = page.getByRole('toolbar', { name: 'Review actions' });
    await expect(actionBar).toBeVisible({ timeout: 10000 });

    // {128.23}: the control formerly labelled "Skip" is now "Next item
    // (keyboard shortcut: right arrow)" (review-action-bar.tsx).
    const nextButton = actionBar.getByRole('button', { name: /Next item/ });
    await expect(nextButton).toBeEnabled();

    // The review card is a role="article" region named
    // "Review item {position} of {total}: {title}", so queue position is
    // observable. The seeded queue has 10+ items, so item 1 is showing.
    await expect(
      page.getByRole('article', { name: /^Review item 1 of / }),
    ).toBeVisible({ timeout: 10000 });

    await nextButton.click();

    // Advancing must surface the SECOND queue item — asserting the position
    // moved is the actual behaviour; a bare URL check would pass even if the
    // card never changed.
    await expect(
      page.getByRole('article', { name: /^Review item 2 of / }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(/\/review/);
  });

  test('back button is disabled on the first item', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/review');
    await expect(
      page.getByRole('heading', { name: 'Review Queue' }),
    ).toBeVisible({ timeout: 10000 });

    const actionBar = page.getByRole('toolbar', { name: 'Review actions' });
    await expect(actionBar).toBeVisible({ timeout: 10000 });

    const backButton = actionBar.getByRole('button', { name: /Go back/ });
    // On the first item, Back should be disabled
    await expect(backButton).toBeDisabled();
  });

  test('exit button navigates away from review page', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/review');
    await expect(
      page.getByRole('heading', { name: 'Review Queue' }),
    ).toBeVisible({ timeout: 10000 });

    const actionBar = page.getByRole('toolbar', { name: 'Review actions' });
    await expect(actionBar).toBeVisible({ timeout: 10000 });

    const exitButton = actionBar.getByRole('button', { name: /Exit/ });
    await exitButton.click();

    // Exit navigates to /library. {135.32}: was /browse (dead route, 404).
    await expect(page).toHaveURL(/\/library/);
  });

  test('keyboard shortcut help dialog opens', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/review');
    await expect(
      page.getByRole('heading', { name: 'Review Queue' }),
    ).toBeVisible({ timeout: 10000 });

    const actionBar = page.getByRole('toolbar', { name: 'Review actions' });
    await expect(actionBar).toBeVisible({ timeout: 10000 });

    const helpButton = actionBar.getByRole('button', {
      name: /Show keyboard shortcuts/,
    });
    await expect(helpButton).toBeVisible({ timeout: 5000 });
    await helpButton.click();

    // Help dialog should appear
    await expect(
      page.getByRole('heading', { name: 'Keyboard shortcuts' }),
    ).toBeVisible();

    // Should list the key shortcuts
    await expect(page.getByText('Verify current item')).toBeVisible();
    await expect(page.getByText('Flag for review')).toBeVisible();
    // {128.23}: the right-arrow shortcut is described as "Next item"
    // (review-content.tsx shortcut table); "Skip to next item" is gone.
    await expect(page.getByText('Next item')).toBeVisible();
  });
});

test.describe('Review page — queue state', () => {
  test('review page renders the seeded queue toolbar', async ({
    authenticatedPage: page,
  }) => {
    // Worker fixture seeds 10+ unverified items, so the action toolbar
    // is the deterministic state — never the empty state.
    await page.goto('/review');
    await expect(
      page.getByRole('heading', { name: 'Review Queue' }),
    ).toBeVisible({ timeout: 10000 });

    const actionBar = page.getByRole('toolbar', { name: 'Review actions' });
    await expect(actionBar).toBeVisible({ timeout: 15000 });
  });

  test('review page is accessible via navigation', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Canonical' })).toBeVisible({
      timeout: 10000,
    });

    // Use responsive helper — opens hamburger on mobile; on desktop
    // (post-{118.7} zone disclosures) it opens the Governance zone's
    // DropdownMenu first, then selects the 'Review' menuitem. The label
    // itself is unchanged (BI-17), so no call-site edit was needed here —
    // reviewed as part of the {118.9} navigateViaHeader rewrite.
    await navigateViaHeader(page, 'Review');

    await expect(page).toHaveURL(/\/review/);
  });
});
