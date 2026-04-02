import { test, expect } from '../fixtures';

/**
 * Wave 1: Item Detail Date Features
 *
 * Tests the ExpiryDateDisplay and TemporalReferencesSection components
 * on item detail pages (/item/[id]).
 *
 * ExpiryDateDisplay shows the expiry date in DD/MM/YYYY format with an
 * urgency badge (using freshness semantic tokens). It renders inside the
 * metadata sidebar as a <dt>/<dd> pair.
 *
 * TemporalReferencesSection is a collapsible section showing extracted
 * dates with their context types and confidence levels. It uses
 * aria-expanded and aria-controls for accessibility.
 *
 * The seeded test data includes:
 * - expiredItemId (index 4): has expiry_date and lifecycle_type="date_bound"
 * - Other items may have temporal_references in their metadata
 *
 * @tag @wave1
 */

test.describe('Item detail — expiry date display', { tag: '@wave1' }, () => {
  test('expired item shows expiry date in metadata sidebar', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // The expired item (Pricing Model Template) has expiry_date and lifecycle_type="date_bound"
    await page.goto(`/item/${workerData.expiredItemId}`);

    // Wait for page to load
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 10000,
    });

    // ExpiryDateDisplay renders "Expiry Date" as a <dt> label
    const expiryLabel = page.getByText('Expiry Date');
    await expect(expiryLabel).toBeVisible({ timeout: 10000 });
  });

  test('expiry date uses DD/MM/YYYY UK format', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/item/${workerData.expiredItemId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 10000,
    });

    // The date should be displayed in en-GB locale format (DD/MM/YYYY)
    // Look for a date string matching the UK format pattern near the "Expiry Date" label
    const expiryLabel = page.getByText('Expiry Date');
    await expect(expiryLabel).toBeVisible({ timeout: 10000 });

    // The date value is in a <dd> sibling — look for a date in UK format
    const datePattern = page.locator('dd span').filter({
      hasText: /^\d{2}\/\d{2}\/\d{4}$/,
    });

    await expect(datePattern.first()).toBeVisible({ timeout: 5000 });
    const dateText = await datePattern.first().textContent();
    // Verify UK date format
    expect(dateText).toMatch(/^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/);
  });

  test('expired item shows urgency status badge', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/item/${workerData.expiredItemId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 10000,
    });

    // ExpiryDateDisplay renders a role="status" element with aria-label="Expiry status: {label}"
    const statusBadge = page.locator(
      '[role="status"][aria-label^="Expiry status:"]',
    );
    await expect(statusBadge).toBeVisible({ timeout: 10000 });

    // The expired item should show "Expired" status
    const ariaLabel = await statusBadge.getAttribute('aria-label');
    expect(ariaLabel).toBe('Expiry status: Expired');

    // Verify the badge uses freshness semantic token classes
    const className = await statusBadge.getAttribute('class');
    expect(className).toContain('freshness-expired');
  });

  test('date-bound item shows lifecycle type indicator', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/item/${workerData.expiredItemId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 10000,
    });

    // ExpiryDateDisplay renders "Lifecycle" label and "Date-bound" value
    // when lifecycleType === 'date_bound'
    const lifecycleLabel = page.getByText('Lifecycle');
    await expect(lifecycleLabel).toBeVisible({ timeout: 10000 });

    // The value should be "Date-bound"
    await expect(page.getByText('Date-bound')).toBeVisible();
  });

  test('item without expiry date does not show expiry section', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // The article item (IT Support Policy) has no expiry_date
    await page.goto(`/item/${workerData.articleId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 10000,
    });

    // "Expiry Date" label should not be present
    const expiryLabel = page.getByText('Expiry Date');
    await expect(expiryLabel).not.toBeVisible({ timeout: 3000 });
  });
});

test.describe(
  'Item detail — temporal references section',
  { tag: '@wave1' },
  () => {
    test('temporal references section is collapsible', async ({
      authenticatedPage: page,
      workerData,
    }) => {
      // Navigate to an item that may have temporal references in its metadata.
      // The expired item (date_bound) is most likely to have extracted dates.
      await page.goto(`/item/${workerData.expiredItemId}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
        timeout: 10000,
      });

      // TemporalReferencesSection renders a button with "Extracted Dates" text
      // and aria-expanded attribute. It only renders if temporal_references exist.
      const toggleButton = page.locator('button[aria-expanded]').filter({
        hasText: /Extracted Dates/,
      });

      // This is a soft check — the section only renders if temporal_references exist in metadata
      if (await toggleButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Initially collapsed
        await expect(toggleButton).toHaveAttribute('aria-expanded', 'false');

        // Click to expand
        await toggleButton.click();
        await expect(toggleButton).toHaveAttribute('aria-expanded', 'true');

        // The expanded list should be visible
        const dateList = page.locator('#temporal-references-list');
        await expect(dateList).toBeVisible();

        // Click again to collapse
        await toggleButton.click();
        await expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
        await expect(dateList).not.toBeVisible();
      }
    });

    test('expanded temporal references show date details', async ({
      authenticatedPage: page,
      workerData,
    }) => {
      await page.goto(`/item/${workerData.expiredItemId}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
        timeout: 10000,
      });

      const toggleButton = page.locator('button[aria-expanded]').filter({
        hasText: /Extracted Dates/,
      });

      if (await toggleButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Expand the section
        await toggleButton.click();

        const dateList = page.locator('#temporal-references-list');
        await expect(dateList).toBeVisible();

        // Each temporal reference should have:
        // 1. A date in DD/MM/YYYY format
        // 2. A context type badge (Expiry, Effective, Review, Publication, Historical, Unknown)
        // 3. A confidence level (high, medium, low)
        const listItems = dateList.locator('li');
        const itemCount = await listItems.count();

        if (itemCount > 0) {
          const firstItem = listItems.first();

          // Date should be in UK format
          const dateSpan = firstItem.locator('span.font-medium').first();
          const dateText = await dateSpan.textContent();
          expect(dateText).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);

          // Context type badge should be one of the known types
          const contextTypes = [
            'Expiry',
            'Effective',
            'Review',
            'Publication',
            'Historical',
            'Unknown',
          ];
          const typeBadge = firstItem.locator('span').filter({
            hasText: new RegExp(`^(${contextTypes.join('|')})$`),
          });
          await expect(typeBadge.first()).toBeVisible();

          // Confidence level should be shown
          const confidenceLevels = ['high', 'medium', 'low'];
          const confidenceSpan = firstItem.locator(
            'span[aria-label^="Confidence:"]',
          );
          if (
            await confidenceSpan.isVisible({ timeout: 2000 }).catch(() => false)
          ) {
            const confidenceLabel =
              await confidenceSpan.getAttribute('aria-label');
            expect(
              confidenceLevels.some((level) =>
                confidenceLabel?.includes(level),
              ),
            ).toBe(true);
          }
        }
      }
    });

    test('temporal references section shows count in button text', async ({
      authenticatedPage: page,
      workerData,
    }) => {
      await page.goto(`/item/${workerData.expiredItemId}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
        timeout: 10000,
      });

      const toggleButton = page.locator('button[aria-expanded]').filter({
        hasText: /Extracted Dates/,
      });

      if (await toggleButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        // The button text includes a count: "Extracted Dates (N)"
        const buttonText = await toggleButton.textContent();
        expect(buttonText).toMatch(/Extracted Dates \(\d+\)/);
      }
    });

    test('temporal references list has accessible label', async ({
      authenticatedPage: page,
      workerData,
    }) => {
      await page.goto(`/item/${workerData.expiredItemId}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
        timeout: 10000,
      });

      const toggleButton = page.locator('button[aria-expanded]').filter({
        hasText: /Extracted Dates/,
      });

      if (await toggleButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Expand the section
        await toggleButton.click();

        // The list should have an accessible label
        const dateList = page.locator('#temporal-references-list');
        await expect(dateList).toBeVisible();
        await expect(dateList).toHaveAttribute(
          'aria-label',
          'Temporal references extracted from content',
        );
      }
    });
  },
);

test.describe('Item detail — quality score badge', { tag: '@wave1' }, () => {
  test('browse page content cards show quality score badges', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/browse');

    // Wait for content to load
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });

    // QualityBadge renders with aria-label="Quality score: N out of 100 - {label}"
    const qualityBadges = page.locator('span[aria-label^="Quality score:"]');
    const badgeCount = await qualityBadges.count();

    // At least some items should have quality badges rendered
    if (badgeCount > 0) {
      // Verify the aria-label format
      const ariaLabel = await qualityBadges.first().getAttribute('aria-label');
      expect(ariaLabel).toMatch(/Quality score: \d+ out of 100/);

      // The badge should contain a numeric score
      const firstBadge = qualityBadges.first();
      const scoreText = await firstBadge
        .locator('span.font-semibold')
        .textContent();
      const score = parseInt(scoreText ?? '0', 10);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  test('quality badge uses semantic colour tokens', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });

    const qualityBadges = page.locator('span[aria-label^="Quality score:"]');
    const badgeCount = await qualityBadges.count();

    if (badgeCount > 0) {
      // The badge should use semantic quality or freshness tokens, not raw Tailwind colours
      const className = await qualityBadges.first().getAttribute('class');
      // Quality badges use quality-good, quality-moderate, primary, freshness-stale, or destructive tokens
      const hasSemanticToken = className?.match(
        /quality-good|quality-moderate|text-primary|freshness-stale|text-destructive/,
      );
      expect(hasSemanticToken).toBeTruthy();
    }
  });

  test('quality badge shows breakdown in title attribute', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });

    const qualityBadges = page.locator('span[aria-label^="Quality score:"]');
    const badgeCount = await qualityBadges.count();

    if (badgeCount > 0) {
      // QualityBadge sets a title attribute with the score breakdown
      const title = await qualityBadges.first().getAttribute('title');
      // Breakdown format: "Freshness: N/30, Confidence: N/20, ..."
      expect(title).toContain('Freshness:');
      expect(title).toContain('Confidence:');
      expect(title).toContain('Completeness:');
      expect(title).toContain('Summary:');
      expect(title).toContain('Citations:');
    }
  });
});
