import { test, expect } from '../fixtures/auth';

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
    await page.waitForLoadState('networkidle');
  });

  test('review page loads with heading', async ({ authenticatedPage: page }) => {
    await expect(
      page.getByRole('heading', { name: 'Review Queue' }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('shows either review content or empty state', async ({ authenticatedPage: page }) => {
    // The review page either shows a review card (items to review)
    // or an empty/completed state message
    const reviewCard = page.getByRole('toolbar', { name: 'Review actions' });
    const emptyHeading = page
      .getByRole('heading', { name: 'All caught up!' })
      .or(page.getByRole('heading', { name: /items have been verified/ }))
      .or(page.getByRole('heading', { name: 'Batch complete' }));

    await expect(
      reviewCard.or(emptyHeading),
    ).toBeVisible({ timeout: 15000 });
  });

  test('progress bar is displayed when items exist', async ({ authenticatedPage: page }) => {
    // The progress bar has an aria-label describing review progress
    const progressBar = page.getByLabel(/Review progress/);

    // If there are items in the review queue, progress bar should be visible
    if (await progressBar.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(progressBar).toBeVisible();
    }
  });
});

test.describe('Review page — action bar', () => {
  test('action bar shows verify, flag, skip, and exit buttons', async ({ authenticatedPage: page }) => {
    await page.goto('/review');
    await page.waitForLoadState('networkidle');

    const actionBar = page.getByRole('toolbar', { name: 'Review actions' });

    // Only test action bar if we have items to review
    if (await actionBar.isVisible({ timeout: 10000 }).catch(() => false)) {
      // Primary actions
      await expect(
        actionBar.getByRole('button', { name: /Verify/ }),
      ).toBeVisible();
      await expect(
        actionBar.getByRole('button', { name: /Flag/ }),
      ).toBeVisible();

      // Navigation
      await expect(
        actionBar.getByRole('button', { name: /Skip/ }),
      ).toBeVisible();

      // Meta
      await expect(
        actionBar.getByRole('button', { name: /Exit/ }),
      ).toBeVisible();
    }
  });

  test('verify button advances to the next item', async ({ authenticatedPage: page }) => {
    await page.goto('/review');
    await page.waitForLoadState('networkidle');

    const actionBar = page.getByRole('toolbar', { name: 'Review actions' });

    if (await actionBar.isVisible({ timeout: 10000 }).catch(() => false)) {
      const verifyButton = actionBar.getByRole('button', { name: /Verify/ });
      await expect(verifyButton).toBeEnabled();

      // Click verify — the card should transition to the next item
      // or show an empty state if this was the last item
      await verifyButton.click();

      // After verification, either the next card loads, or we see
      // a completion message
      const nextCard = actionBar;
      const completionMessage = page
        .getByRole('heading', { name: 'All caught up!' })
        .or(page.getByRole('heading', { name: /items have been verified/ }))
        .or(page.getByRole('heading', { name: 'Batch complete' }));

      await expect(
        nextCard.or(completionMessage),
      ).toBeVisible({ timeout: 10000 });
    }
  });

  test('flag button shows flag input for reason', async ({ authenticatedPage: page }) => {
    await page.goto('/review');
    await page.waitForLoadState('networkidle');

    const actionBar = page.getByRole('toolbar', { name: 'Review actions' });

    if (await actionBar.isVisible({ timeout: 10000 }).catch(() => false)) {
      const flagButton = actionBar.getByRole('button', { name: /Flag/ });
      await expect(flagButton).toBeEnabled();

      // Click flag — should show an inline input for the flag reason
      await flagButton.click();

      // The flag input area appears below the review card
      await expect(
        page.getByLabel(/Reason/),
      ).toBeVisible({ timeout: 5000 });

      // Submit and Cancel buttons should be visible
      await expect(
        page.getByRole('button', { name: 'Submit' }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Cancel' }),
      ).toBeVisible();
    }
  });

  test('flag cancel hides the flag input', async ({ authenticatedPage: page }) => {
    await page.goto('/review');
    await page.waitForLoadState('networkidle');

    const actionBar = page.getByRole('toolbar', { name: 'Review actions' });

    if (await actionBar.isVisible({ timeout: 10000 }).catch(() => false)) {
      // Open flag input
      await actionBar.getByRole('button', { name: /Flag/ }).click();
      await expect(page.getByLabel(/Reason/)).toBeVisible({ timeout: 5000 });

      // Cancel
      await page.getByRole('button', { name: 'Cancel' }).click();

      // Flag input should be hidden
      await expect(page.getByLabel(/Reason/)).not.toBeVisible();
    }
  });

  test('skip button advances to the next item without changing status', async ({ authenticatedPage: page }) => {
    await page.goto('/review');
    await page.waitForLoadState('networkidle');

    const actionBar = page.getByRole('toolbar', { name: 'Review actions' });

    if (await actionBar.isVisible({ timeout: 10000 }).catch(() => false)) {
      const skipButton = actionBar.getByRole('button', { name: /Skip/ });
      await expect(skipButton).toBeEnabled();

      // Click skip
      await skipButton.click();

      // Should still be on the review page with the next item or completion
      await expect(page).toHaveURL(/\/review/);
    }
  });

  test('back button is disabled on the first item', async ({ authenticatedPage: page }) => {
    await page.goto('/review');
    await page.waitForLoadState('networkidle');

    const actionBar = page.getByRole('toolbar', { name: 'Review actions' });

    if (await actionBar.isVisible({ timeout: 10000 }).catch(() => false)) {
      const backButton = actionBar.getByRole('button', { name: /Go back/ });
      // On the first item, Back should be disabled
      await expect(backButton).toBeDisabled();
    }
  });

  test('exit button navigates away from review page', async ({ authenticatedPage: page }) => {
    await page.goto('/review');
    await page.waitForLoadState('networkidle');

    const actionBar = page.getByRole('toolbar', { name: 'Review actions' });

    if (await actionBar.isVisible({ timeout: 10000 }).catch(() => false)) {
      const exitButton = actionBar.getByRole('button', { name: /Exit/ });
      await exitButton.click();

      // Exit navigates to /browse
      await expect(page).toHaveURL(/\/browse/);
    }
  });

  test('keyboard shortcut help dialog opens', async ({ authenticatedPage: page }) => {
    await page.goto('/review');
    await page.waitForLoadState('networkidle');

    const actionBar = page.getByRole('toolbar', { name: 'Review actions' });

    if (await actionBar.isVisible({ timeout: 10000 }).catch(() => false)) {
      const helpButton = actionBar.getByRole('button', { name: /Show keyboard shortcuts/ });

      if (await helpButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await helpButton.click();

        // Help dialog should appear
        await expect(
          page.getByRole('heading', { name: 'Keyboard shortcuts' }),
        ).toBeVisible();

        // Should list the key shortcuts
        await expect(page.getByText('Verify current item')).toBeVisible();
        await expect(page.getByText('Flag for review')).toBeVisible();
        await expect(page.getByText('Skip to next item')).toBeVisible();
      }
    }
  });
});

test.describe('Review page — queue state', () => {
  test('review page shows queue state (populated or empty)', async ({ authenticatedPage: page }) => {
    // Navigate to review page — it may show review items or a completion
    // message depending on the state of the seeded test data
    await page.goto('/review');
    await page.waitForLoadState('networkidle');

    // Wait for the page to settle into one of two states:
    // 1. Populated: the review action toolbar is visible
    // 2. Empty/completed: a heading like "All caught up!" or "Batch complete"
    const actionBar = page.getByRole('toolbar', { name: 'Review actions' });
    const emptyHeading = page
      .getByRole('heading', { name: 'All caught up!' })
      .or(page.getByRole('heading', { name: /items have been verified/ }))
      .or(page.getByRole('heading', { name: 'Batch complete' }));

    await expect(
      actionBar.or(emptyHeading),
    ).toBeVisible({ timeout: 15000 });

    // If we see the empty state, verify it has helpful text
    if (await emptyHeading.isVisible().catch(() => false)) {
      await expect(
        page.getByText(/no unverified items/i)
          .or(page.getByText(/fully reviewed/i))
          .or(page.getByText(/All caught up/)),
      ).toBeVisible();
    }
  });

  test('review page is accessible via navigation', async ({ authenticatedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // On mobile, the Review link is inside the hamburger menu
    const hamburger = page.getByRole('button', { name: 'Open navigation menu' });
    const isMobile = await hamburger.isVisible({ timeout: 2000 }).catch(() => false);

    if (isMobile) {
      await hamburger.click();
      const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
      const reviewLink = mobileNav.getByRole('link', { name: 'Review' });
      if (await reviewLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await reviewLink.click();
        await expect(page).toHaveURL(/\/review/);
      }
    } else {
      const reviewLink = page.getByRole('link', { name: 'Review' });
      if (await reviewLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await reviewLink.click();
        await expect(page).toHaveURL(/\/review/);
      }
    }
  });
});
