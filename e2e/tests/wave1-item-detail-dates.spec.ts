import { test, expect } from '../fixtures';
import { searchBrowseByPrefix } from '../helpers/browse-prefix-search';

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

      // Worker fixture seeds 3 temporal_references on the expired item, so
      // the toggle button must be present.
      await expect(toggleButton).toBeVisible({ timeout: 10000 });

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

      // Worker fixture seeds 3 temporal_references on the expired item.
      await expect(toggleButton).toBeVisible({ timeout: 10000 });

      // Expand the section
      await toggleButton.click();

      const dateList = page.locator('#temporal-references-list');
      await expect(dateList).toBeVisible();

      const listItems = dateList.locator('li');
      const itemCount = await listItems.count();
      expect(itemCount).toBeGreaterThan(0);

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

      // Confidence level should be shown — the seed sets confidence on every reference.
      const confidenceLevels = ['high', 'medium', 'low'];
      const confidenceSpan = firstItem.locator(
        'span[aria-label^="Confidence:"]',
      );
      await expect(confidenceSpan).toBeVisible({ timeout: 5000 });
      const confidenceLabel = await confidenceSpan.getAttribute('aria-label');
      expect(
        confidenceLevels.some((level) => confidenceLabel?.includes(level)),
      ).toBe(true);
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

      await expect(toggleButton).toBeVisible({ timeout: 10000 });
      // The button text includes a count: "Extracted Dates (N)"
      const buttonText = await toggleButton.textContent();
      expect(buttonText).toMatch(/Extracted Dates \(\d+\)/);
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

      await expect(toggleButton).toBeVisible({ timeout: 10000 });
      // Expand the section
      await toggleButton.click();

      // The list should have an accessible label
      const dateList = page.locator('#temporal-references-list');
      await expect(dateList).toBeVisible();
      await expect(dateList).toHaveAttribute(
        'aria-label',
        'Temporal references extracted from content',
      );
    });
  },
);

test.describe('Item detail — quality score badge', { tag: '@wave1' }, () => {
  test('worker-seeded browse card shows a quality score badge', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // test-philosophy.md §2.1: read the QualityBadge off THIS worker's
    // prefix-scoped card, not `.first()` (which could be an ambient staging
    // item). QualityBadge renders only inside ContentCard (browse grid /
    // search-result cards) — never on /item/[id] — so we scope the
    // search-result card returned by the prefix helper. The previous
    // `.first()` read silently passed on ambient data.
    const workerCard = await searchBrowseByPrefix(page, workerData.prefix);
    const badge = workerCard
      .locator('span[aria-label^="Quality score:"]')
      .first();
    await badge.scrollIntoViewIfNeeded();
    await expect(badge).toBeVisible({ timeout: 10000 });

    // Verify the aria-label format
    const ariaLabel = await badge.getAttribute('aria-label');
    expect(ariaLabel).toMatch(/Quality score: \d+ out of 100/);

    // The badge should contain a numeric score
    const scoreText = await badge.locator('span.font-semibold').textContent();
    const score = parseInt(scoreText ?? '0', 10);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  test('quality badge uses semantic colour tokens', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // test-philosophy.md §2.1: read the badge off THIS worker's prefix-scoped
    // card, not `.first()` (ambient).
    const workerCard = await searchBrowseByPrefix(page, workerData.prefix);
    const badge = workerCard
      .locator('span[aria-label^="Quality score:"]')
      .first();
    await badge.scrollIntoViewIfNeeded();
    await expect(badge).toBeVisible({ timeout: 10000 });

    // The badge should use semantic quality or freshness tokens, not raw Tailwind colours
    const className = await badge.getAttribute('class');
    // Quality badges use quality-good, quality-moderate, primary, freshness-stale, or destructive tokens
    const hasSemanticToken = className?.match(
      /quality-good|quality-moderate|text-primary|freshness-stale|text-destructive/,
    );
    expect(hasSemanticToken).toBeTruthy();
  });

  test('quality badge shows breakdown in title attribute', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // test-philosophy.md §2.1: read the badge off THIS worker's prefix-scoped
    // card, not `.first()` (ambient). Admin/canEdit context, so the badge
    // renders the full (non-simplified) breakdown title.
    const workerCard = await searchBrowseByPrefix(page, workerData.prefix);
    const badge = workerCard
      .locator('span[aria-label^="Quality score:"]')
      .first();
    await badge.scrollIntoViewIfNeeded();
    await expect(badge).toBeVisible({ timeout: 10000 });

    // QualityBadge sets a title attribute with the score breakdown
    const title = await badge.getAttribute('title');
    // Breakdown format: "Freshness: N/30, Confidence: N/20, ..."
    expect(title).toContain('Freshness:');
    expect(title).toContain('Confidence:');
    expect(title).toContain('Completeness:');
    expect(title).toContain('Summary:');
    expect(title).toContain('Citations:');
  });
});
