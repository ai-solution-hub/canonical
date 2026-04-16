import { test, expect } from '../fixtures';

/**
 * Flow: Provenance Per-item tab
 *
 * Tests the Per-item tab on /provenance — UUID lookup form, not-found
 * handling, and provenance card rendering for valid items.
 *
 * The authenticated test user (user1) has admin role.
 */

test.describe('Provenance -- Per-item tab', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/provenance?tab=per-item');
    await expect(
      page.getByRole('heading', { name: 'Provenance' }),
    ).toBeVisible({ timeout: 15000 });
  });

  test('renders lookup form when no UUID is provided', async ({
    authenticatedPage: page,
  }) => {
    // The search input should be visible
    const searchInput = page.getByLabel('Content item UUID');
    await expect(searchInput).toBeVisible();

    // The "Look up" button should be visible but disabled (no input yet)
    const lookupButton = page.getByRole('button', { name: 'Look up' });
    await expect(lookupButton).toBeVisible();
    await expect(lookupButton).toBeDisabled();

    // The placeholder prompt should be visible
    await expect(
      page.getByText('Enter a content item UUID above to view its provenance data.'),
    ).toBeVisible();
  });

  test('shows error for non-existent UUID', async ({
    authenticatedPage: page,
  }) => {
    const searchInput = page.getByLabel('Content item UUID');
    await expect(searchInput).toBeVisible();

    // Use a valid-format but non-existent UUID
    const fakeUuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    await searchInput.fill(fakeUuid);

    // The "Look up" button should now be enabled
    const lookupButton = page.getByRole('button', { name: 'Look up' });
    await expect(lookupButton).toBeEnabled();
    await lookupButton.click();

    // Wait for the error state to appear (either 404 "no longer exists" or
    // generic "failed to load" depending on the API response)
    const errorAlert = page.getByRole('alert');
    await expect(errorAlert).toBeVisible({ timeout: 15000 });

    // Error text should communicate the failure
    await expect(errorAlert.locator('p')).toBeVisible();
  });

  test('shows provenance cards for a valid content item', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // workerData.articleId is the first seeded content item (IT Support Policy)
    const itemId = workerData.articleId;
    test.skip(!itemId, 'No content item ID available from worker data');

    const searchInput = page.getByLabel('Content item UUID');
    await expect(searchInput).toBeVisible();

    await searchInput.fill(itemId);

    const lookupButton = page.getByRole('button', { name: 'Look up' });
    await expect(lookupButton).toBeEnabled();
    await lookupButton.click();

    // Wait for the loading skeleton to appear then disappear
    // The provenance data should render three cards: Classification,
    // Processing, and Drafting
    const classificationCard = page.getByRole('heading', {
      name: 'Classification',
    });
    await expect(classificationCard).toBeVisible({ timeout: 15000 });

    const processingCard = page.getByRole('heading', { name: 'Processing' });
    await expect(processingCard).toBeVisible();

    const draftingCard = page.getByRole('heading', { name: 'Drafting' });
    await expect(draftingCard).toBeVisible();

    // The item ID should be displayed in the header
    await expect(page.getByText(`Item: ${itemId}`)).toBeVisible();
  });
});
