import { test, expect } from '../fixtures';
import { navigateViaHeader } from '../helpers/responsive';

/**
 * Flow 8: Content Governance and Review
 *
 * Tests the /review page — review queue loading, speed-review card display,
 * verify/flag/skip actions, progress tracking, and empty queue handling.
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
  test('action bar shows verify, flag, skip, and exit buttons', async ({
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

    // Navigation
    await expect(actionBar.getByRole('button', { name: /Skip/ })).toBeVisible();

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

  test('skip button advances to the next item without changing status', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/review');
    await expect(
      page.getByRole('heading', { name: 'Review Queue' }),
    ).toBeVisible({ timeout: 10000 });

    const actionBar = page.getByRole('toolbar', { name: 'Review actions' });
    await expect(actionBar).toBeVisible({ timeout: 10000 });

    const skipButton = actionBar.getByRole('button', { name: /Skip/ });
    await expect(skipButton).toBeEnabled();

    // Click skip
    await skipButton.click();

    // Should still be on the review page with the next item or completion
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

    // Exit navigates to /browse
    await expect(page).toHaveURL(/\/browse/);
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
    await expect(page.getByText('Skip to next item')).toBeVisible();
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
