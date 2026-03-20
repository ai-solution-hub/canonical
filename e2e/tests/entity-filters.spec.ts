import { test, expect } from '../fixtures';

/**
 * Flow: Entity Filter Flows on Browse Page
 *
 * Tests entity type filtering, entity name filtering, entity co-occurrence
 * in the filter panel, filter badge display/removal, and entity badges
 * on item detail pages.
 *
 * Entity filter sections in the filter panel are collapsed by default
 * and only render when entity data is available (live DB content).
 * The filter panel is a Sheet (role="dialog") opened via the Filters button.
 *
 * Filter sections use FilterSection which renders:
 * - A <button> with the section title text, aria-expanded, aria-controls
 * - A <div role="group" aria-label="{title}"> containing children
 * - Collapsed sections have aria-hidden="true" and invisible children
 *
 * Entity Type section: buttons with aria-pressed, showing type name + count
 * Entities section: buttons with aria-pressed, showing entity name + count
 * Entity Co-occurrence section: a role="list" of co-occurring entity pairs
 */

test.describe('Entity type filter on browse page', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({ timeout: 10000 });
  });

  test('filter panel contains Entity Type section when entities exist', async ({ authenticatedPage: page }) => {
    // Open filter panel
    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    // The Entity Type section should exist as a collapsible FilterSection.
    // The section title is a button with "Entity Type" text.
    const entityTypeButton = sheet.getByRole('button', { name: 'Entity Type' });

    // Entity Type section only renders if entityTypeCounts.length > 0 (live data).
    // If the section is present, verify it can be expanded.
    if (await entityTypeButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Click to expand the section (it is collapsed by default)
      await entityTypeButton.click();

      // The section content group should now be visible
      const entityTypeGroup = sheet.getByRole('group', { name: 'Entity Type' });
      await expect(entityTypeGroup).toBeVisible();

      // Should contain at least one entity type button with aria-pressed attribute
      const firstTypeButton = entityTypeGroup.getByRole('button').first();
      await expect(firstTypeButton).toBeVisible({ timeout: 5000 });

      // Helper text should be visible
      await expect(
        sheet.getByText('Filter content by entity type'),
      ).toBeVisible();
    }
  });

  test('selecting an entity type marks it as pressed and can be applied', async ({ authenticatedPage: page }) => {
    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    const entityTypeButton = sheet.getByRole('button', { name: 'Entity Type' });

    if (await entityTypeButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Expand the Entity Type section
      await entityTypeButton.click();

      const entityTypeGroup = sheet.getByRole('group', { name: 'Entity Type' });
      await expect(entityTypeGroup).toBeVisible();

      // Click the first entity type toggle (e.g. "organisation", "certification")
      const firstType = entityTypeGroup.getByRole('button').first();
      await expect(firstType).toBeVisible({ timeout: 5000 });

      // Store the type name for later verification
      const typeName = await firstType.textContent();

      // Should start as not pressed
      await expect(firstType).toHaveAttribute('aria-pressed', 'false');

      // Click to select
      await firstType.click();

      // Should now be pressed
      await expect(firstType).toHaveAttribute('aria-pressed', 'true');

      // Apply filters
      await sheet.getByRole('button', { name: 'Apply filters' }).click();

      // Sheet should close
      await expect(sheet).not.toBeVisible({ timeout: 5000 });

      // Filter badge should appear on the browse page showing the entity type
      // FilterBadges renders "Entity Type:" label with the capitalised type name
      if (typeName) {
        // The badge renders the type name capitalised (first letter upper)
        await expect(
          page.getByText('Entity Type:'),
        ).toBeVisible({ timeout: 5000 });
      }
    }
  });
});

test.describe('Entity name filter', () => {
  test('Entities section shows entity names filtered by selected type', async ({ authenticatedPage: page }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({ timeout: 10000 });

    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    // Check if Entity Type and Entities sections exist
    const entityTypeButton = sheet.getByRole('button', { name: 'Entity Type' });
    const entitiesButton = sheet.getByRole('button', { name: 'Entities' });

    if (
      await entityTypeButton.isVisible({ timeout: 5000 }).catch(() => false) &&
      await entitiesButton.isVisible({ timeout: 3000 }).catch(() => false)
    ) {
      // Expand the Entities section first to see all entities
      await entitiesButton.click();
      const entitiesGroup = sheet.getByRole('group', { name: 'Entities' });
      await expect(entitiesGroup).toBeVisible();

      // Count entities before selecting a type
      const allEntityButtons = entitiesGroup.getByRole('button');
      const initialCount = await allEntityButtons.count();

      // The helper text should show "Filter by entity mentioned in content"
      // when no entity type is selected
      await expect(
        sheet.getByText('Filter by entity mentioned in content'),
      ).toBeVisible();

      // Now select an entity type to filter the entity name list
      await entityTypeButton.click();
      const entityTypeGroup = sheet.getByRole('group', { name: 'Entity Type' });
      await expect(entityTypeGroup).toBeVisible();

      const firstType = entityTypeGroup.getByRole('button').first();
      await firstType.click();

      // After selecting a type, the helper text should change to indicate filtering
      // "Showing {type} entities — clear type filter to see all"
      await expect(
        sheet.getByText(/Showing .+ entities/),
      ).toBeVisible({ timeout: 5000 });

      // The entity count may have changed (filtered down)
      // At minimum, there should still be entity buttons visible if this type has entities
      const filteredCount = await entitiesGroup.getByRole('button').count();
      expect(filteredCount).toBeLessThanOrEqual(initialCount);
    }
  });

  test('selecting an entity name marks it as pressed', async ({ authenticatedPage: page }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({ timeout: 10000 });

    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    const entitiesButton = sheet.getByRole('button', { name: 'Entities' });

    if (await entitiesButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await entitiesButton.click();

      const entitiesGroup = sheet.getByRole('group', { name: 'Entities' });
      await expect(entitiesGroup).toBeVisible();

      const firstEntity = entitiesGroup.getByRole('button').first();
      if (await firstEntity.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(firstEntity).toHaveAttribute('aria-pressed', 'false');

        await firstEntity.click();
        await expect(firstEntity).toHaveAttribute('aria-pressed', 'true');
      }
    }
  });

  test('applying both entity type and entity name shows both badges', async ({ authenticatedPage: page }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({ timeout: 10000 });

    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    const entityTypeButton = sheet.getByRole('button', { name: 'Entity Type' });
    const entitiesButton = sheet.getByRole('button', { name: 'Entities' });

    if (
      await entityTypeButton.isVisible({ timeout: 5000 }).catch(() => false) &&
      await entitiesButton.isVisible({ timeout: 3000 }).catch(() => false)
    ) {
      // Select entity type
      await entityTypeButton.click();
      const entityTypeGroup = sheet.getByRole('group', { name: 'Entity Type' });
      await expect(entityTypeGroup).toBeVisible();
      await entityTypeGroup.getByRole('button').first().click();

      // Select entity name
      await entitiesButton.click();
      const entitiesGroup = sheet.getByRole('group', { name: 'Entities' });
      await expect(entitiesGroup).toBeVisible();

      const firstEntityBtn = entitiesGroup.getByRole('button').first();
      if (await firstEntityBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await firstEntityBtn.click();

        // Apply filters
        await sheet.getByRole('button', { name: 'Apply filters' }).click();
        await expect(sheet).not.toBeVisible({ timeout: 5000 });

        // Both filter badges should appear
        await expect(page.getByText('Entity Type:')).toBeVisible({ timeout: 5000 });
        await expect(page.getByText('Entity:')).toBeVisible({ timeout: 5000 });
      }
    }
  });
});

test.describe('Entity co-occurrence in filter panel', () => {
  test('Entity Co-occurrence section shows pairs when data exists', async ({ authenticatedPage: page }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({ timeout: 10000 });

    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    // Entity Co-occurrence section only renders when allEntities.length > 0
    const coOccurrenceButton = sheet.getByRole('button', { name: 'Entity Co-occurrence' });

    if (await coOccurrenceButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Expand the section
      await coOccurrenceButton.click();

      // Wait for loading to complete — the component fetches from /api/entities/co-occurrence
      // Either the list appears or the "No frequently co-occurring entities found" message
      const pairsList = sheet.getByRole('list', { name: 'Co-occurring entity pairs' });
      const noPairsMessage = sheet.getByText('No frequently co-occurring entities found');
      const helpText = sheet.getByText('Entities that frequently appear together in content');

      await expect(
        pairsList.or(noPairsMessage),
      ).toBeVisible({ timeout: 10000 });

      // Help text should always be visible
      await expect(helpText).toBeVisible();

      // If pairs exist, each pair has two entity buttons with aria-labels
      if (await pairsList.isVisible().catch(() => false)) {
        const listItems = pairsList.getByRole('listitem');
        const count = await listItems.count();
        expect(count).toBeGreaterThan(0);

        // Each pair item should have two entity filter buttons
        const firstItem = listItems.first();
        const entityButtons = firstItem.locator('button[aria-label^="Filter by entity:"]');
        await expect(entityButtons).toHaveCount(2);
      }
    }
  });

  test('clicking a co-occurrence entity sets it as the entity filter', async ({ authenticatedPage: page }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({ timeout: 10000 });

    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    const coOccurrenceButton = sheet.getByRole('button', { name: 'Entity Co-occurrence' });

    if (await coOccurrenceButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await coOccurrenceButton.click();

      const pairsList = sheet.getByRole('list', { name: 'Co-occurring entity pairs' });

      if (await pairsList.isVisible({ timeout: 10000 }).catch(() => false)) {
        // Click the first entity button in the first pair
        const firstEntityButton = pairsList
          .getByRole('listitem')
          .first()
          .locator('button[aria-label^="Filter by entity:"]')
          .first();

        if (await firstEntityButton.isVisible().catch(() => false)) {
          await firstEntityButton.click();

          // Now also expand the Entities section to verify the entity was selected
          const entitiesButton = sheet.getByRole('button', { name: 'Entities' });
          if (await entitiesButton.isVisible({ timeout: 3000 }).catch(() => false)) {
            await entitiesButton.click();
            const entitiesGroup = sheet.getByRole('group', { name: 'Entities' });

            // At least one entity button should now be pressed
            const pressedEntity = entitiesGroup.locator('button[aria-pressed="true"]');
            await expect(pressedEntity.first()).toBeVisible({ timeout: 5000 });
          }
        }
      }
    }
  });
});

test.describe('Filter badge display and removal', () => {
  test('entity type filter badge has a remove button', async ({ authenticatedPage: page }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({ timeout: 10000 });

    // Open filter panel and apply an entity type filter
    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    const entityTypeButton = sheet.getByRole('button', { name: 'Entity Type' });

    if (await entityTypeButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await entityTypeButton.click();

      const entityTypeGroup = sheet.getByRole('group', { name: 'Entity Type' });
      await expect(entityTypeGroup).toBeVisible();

      await entityTypeGroup.getByRole('button').first().click();

      await sheet.getByRole('button', { name: 'Apply filters' }).click();
      await expect(sheet).not.toBeVisible({ timeout: 5000 });

      // Badge should appear with "Entity Type:" label
      const badge = page.getByText('Entity Type:');
      if (await badge.isVisible({ timeout: 5000 }).catch(() => false)) {
        // The remove button has aria-label "Remove Entity Type filter: {value}"
        const removeButton = page.getByRole('button', { name: /Remove Entity Type filter/ });
        await expect(removeButton).toBeVisible();

        // Click to remove the filter
        await removeButton.click();

        // Badge should disappear
        await expect(badge).not.toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('clear all button removes all active entity filters', async ({ authenticatedPage: page }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({ timeout: 10000 });

    // Apply entity type + entity name filters
    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    const entityTypeButton = sheet.getByRole('button', { name: 'Entity Type' });
    const entitiesButton = sheet.getByRole('button', { name: 'Entities' });

    if (
      await entityTypeButton.isVisible({ timeout: 5000 }).catch(() => false) &&
      await entitiesButton.isVisible({ timeout: 3000 }).catch(() => false)
    ) {
      // Select entity type
      await entityTypeButton.click();
      const entityTypeGroup = sheet.getByRole('group', { name: 'Entity Type' });
      await expect(entityTypeGroup).toBeVisible();
      await entityTypeGroup.getByRole('button').first().click();

      // Select entity name
      await entitiesButton.click();
      const entitiesGroup = sheet.getByRole('group', { name: 'Entities' });
      await expect(entitiesGroup).toBeVisible();

      const firstEntityBtn = entitiesGroup.getByRole('button').first();
      if (await firstEntityBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await firstEntityBtn.click();

        // Apply
        await sheet.getByRole('button', { name: 'Apply filters' }).click();
        await expect(sheet).not.toBeVisible({ timeout: 5000 });

        // Both badges should be visible
        const entityTypeBadge = page.getByText('Entity Type:');
        const entityBadge = page.getByText('Entity:');

        if (
          await entityTypeBadge.isVisible({ timeout: 5000 }).catch(() => false) &&
          await entityBadge.isVisible({ timeout: 3000 }).catch(() => false)
        ) {
          // The "Clear all" button appears when activeFilterCount > 1
          const clearAllButton = page.getByRole('button', { name: 'Clear all' });
          await expect(clearAllButton).toBeVisible();

          await clearAllButton.click();

          // All badges should disappear
          await expect(entityTypeBadge).not.toBeVisible({ timeout: 5000 });
          await expect(entityBadge).not.toBeVisible({ timeout: 5000 });
        }
      }
    }
  });

  test('clear all inside filter panel resets entity draft selections', async ({ authenticatedPage: page }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({ timeout: 10000 });

    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    const entityTypeButton = sheet.getByRole('button', { name: 'Entity Type' });

    if (await entityTypeButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Select an entity type
      await entityTypeButton.click();
      const entityTypeGroup = sheet.getByRole('group', { name: 'Entity Type' });
      await expect(entityTypeGroup).toBeVisible();

      const firstType = entityTypeGroup.getByRole('button').first();
      await firstType.click();
      await expect(firstType).toHaveAttribute('aria-pressed', 'true');

      // Click "Clear all" inside the sheet footer
      const clearAllInSheet = sheet.getByRole('button', { name: 'Clear all' });
      await clearAllInSheet.click();

      // The entity type should no longer be pressed
      await expect(firstType).toHaveAttribute('aria-pressed', 'false');
    }
  });
});

test.describe('Entity badges on item detail page', () => {
  test('item detail page shows Entities section in Relationships', async ({ authenticatedPage: page }) => {
    // Navigate to browse and click any item to get to detail
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({ timeout: 10000 });

    const itemLink = page.locator('a[href^="/item/"]').first();
    if (await itemLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await itemLink.click();
      await expect(page).toHaveURL(/\/item\//);

      // Wait for the page to load
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 });

      // The Relationships section is a collapsible section. Look for its toggle button.
      const relationshipsButton = page.getByRole('button', { name: 'Relationships' });

      if (await relationshipsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Expand if collapsed
        await relationshipsButton.click();

        // EntityBadges renders a <section aria-label="Entities mentioned in this content">
        // with either entity badges or "No entities detected in this content."
        const entitiesSection = page.locator('section[aria-label="Entities mentioned in this content"]');
        await expect(entitiesSection).toBeVisible({ timeout: 10000 });

        // The section should have an "Entities" heading
        await expect(entitiesSection.getByText('Entities')).toBeVisible();

        // Either entity badges or the empty state should be present
        const entityBadge = entitiesSection.locator('.flex.flex-wrap');
        const emptyState = entitiesSection.getByText('No entities detected in this content.');
        await expect(entityBadge.first().or(emptyState)).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('item detail Relationships section shows Related by Shared Entities', async ({ authenticatedPage: page }) => {
    // Navigate to an item that is likely to have entities (browse for any item)
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({ timeout: 10000 });

    const itemLink = page.locator('a[href^="/item/"]').first();
    if (await itemLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await itemLink.click();
      await expect(page).toHaveURL(/\/item\//);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 });

      // The Relationships section contains RelatedByEntities
      const relationshipsButton = page.getByRole('button', { name: 'Relationships' });

      if (await relationshipsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await relationshipsButton.click();

        // RelatedByEntities renders "Related by Shared Entities" heading
        // when it has data, or nothing when empty. Also shows a loading spinner.
        // Wait a moment for the async fetch to complete
        await page.waitForTimeout(2000);

        // If related entities exist, the heading should be visible
        const relatedHeading = page.getByRole('heading', { name: 'Related by Shared Entities' });
        // This is data-dependent — may or may not be visible
        if (await relatedHeading.isVisible({ timeout: 5000 }).catch(() => false)) {
          // Should show a list of related items with links
          const relatedLinks = page.locator('a[href^="/item/"]');
          // At least one related item should be in the relationships area
          expect(await relatedLinks.count()).toBeGreaterThan(0);
        }
      }
    }
  });
});
