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
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('filter panel contains Entity Type section when entities exist', async ({
    authenticatedPage: page,
  }) => {
    // Open filter panel
    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    // Worker fixture seeds entity_mentions across multiple types
    // (certification, framework, organisation), so Entity Type must render.
    const entityTypeButton = sheet.getByRole('button', { name: 'Entity Type' });
    await expect(entityTypeButton).toBeVisible({ timeout: 10000 });

    // Click to expand the section (it is collapsed by default)
    await entityTypeButton.click();

    const entityTypeGroup = sheet.getByRole('group', { name: 'Entity Type' });
    await expect(entityTypeGroup).toBeVisible();

    const firstTypeButton = entityTypeGroup.getByRole('button').first();
    await expect(firstTypeButton).toBeVisible({ timeout: 5000 });

    await expect(
      sheet.getByText('Filter content by entity type'),
    ).toBeVisible();
  });

  test('selecting an entity type marks it as pressed and can be applied', async ({
    authenticatedPage: page,
  }) => {
    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    const entityTypeButton = sheet.getByRole('button', { name: 'Entity Type' });
    await expect(entityTypeButton).toBeVisible({ timeout: 10000 });

    // Expand the Entity Type section
    await entityTypeButton.click();

    const entityTypeGroup = sheet.getByRole('group', { name: 'Entity Type' });
    await expect(entityTypeGroup).toBeVisible();

    // Click the first entity type toggle (e.g. "organisation", "certification")
    const firstType = entityTypeGroup.getByRole('button').first();
    await expect(firstType).toBeVisible({ timeout: 5000 });

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
    await expect(page.getByText('Entity Type:')).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe('Entity name filter', () => {
  test('Entities section shows entity names filtered by selected type', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });

    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    // Worker fixture seeds entities so both sections must render.
    const entityTypeButton = sheet.getByRole('button', { name: 'Entity Type' });
    const entitiesButton = sheet.getByRole('button', { name: 'Entities' });
    await expect(entityTypeButton).toBeVisible({ timeout: 10000 });
    await expect(entitiesButton).toBeVisible({ timeout: 5000 });

    // Expand the Entities section first to see all entities
    await entitiesButton.click();
    const entitiesGroup = sheet.getByRole('group', { name: 'Entities' });
    await expect(entitiesGroup).toBeVisible();

    // Count entities before selecting a type
    const allEntityButtons = entitiesGroup.getByRole('button');
    const initialCount = await allEntityButtons.count();
    expect(initialCount).toBeGreaterThan(0);

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
    await expect(sheet.getByText(/Showing .+ entities/)).toBeVisible({
      timeout: 5000,
    });

    // The entity count may have changed (filtered down)
    const filteredCount = await entitiesGroup.getByRole('button').count();
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
  });

  test('selecting an entity name marks it as pressed', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });

    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    const entitiesButton = sheet.getByRole('button', { name: 'Entities' });
    await expect(entitiesButton).toBeVisible({ timeout: 10000 });
    await entitiesButton.click();

    const entitiesGroup = sheet.getByRole('group', { name: 'Entities' });
    await expect(entitiesGroup).toBeVisible();

    const firstEntity = entitiesGroup.getByRole('button').first();
    await expect(firstEntity).toBeVisible({ timeout: 5000 });
    await expect(firstEntity).toHaveAttribute('aria-pressed', 'false');

    await firstEntity.click();
    await expect(firstEntity).toHaveAttribute('aria-pressed', 'true');
  });

  test('applying both entity type and entity name shows both badges', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });

    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    const entityTypeButton = sheet.getByRole('button', { name: 'Entity Type' });
    const entitiesButton = sheet.getByRole('button', { name: 'Entities' });
    await expect(entityTypeButton).toBeVisible({ timeout: 10000 });
    await expect(entitiesButton).toBeVisible({ timeout: 5000 });

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
    await expect(firstEntityBtn).toBeVisible({ timeout: 5000 });
    await firstEntityBtn.click();

    // Apply filters
    await sheet.getByRole('button', { name: 'Apply filters' }).click();
    await expect(sheet).not.toBeVisible({ timeout: 5000 });

    // Both filter badges should appear
    await expect(page.getByText('Entity Type:')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText('Entity:')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Entity co-occurrence in filter panel', () => {
  test('Entity Co-occurrence section shows pairs when data exists', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });

    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    // Worker fixture seeds NHS Digital + AWS together on 2 items, so the
    // co-occurrence section and at least one pair must render.
    const coOccurrenceButton = sheet.getByRole('button', {
      name: 'Entity Co-occurrence',
    });
    await expect(coOccurrenceButton).toBeVisible({ timeout: 10000 });
    await coOccurrenceButton.click();

    const pairsList = sheet.getByRole('list', {
      name: 'Co-occurring entity pairs',
    });
    const helpText = sheet.getByText(
      'Entities that frequently appear together in content',
    );

    await expect(pairsList).toBeVisible({ timeout: 10000 });
    await expect(helpText).toBeVisible();

    const listItems = pairsList.getByRole('listitem');
    const count = await listItems.count();
    expect(count).toBeGreaterThan(0);

    // Each pair item should have two entity filter buttons
    const firstItem = listItems.first();
    const entityButtons = firstItem.locator(
      'button[aria-label^="Filter by entity:"]',
    );
    await expect(entityButtons).toHaveCount(2);
  });

  test('clicking a co-occurrence entity sets it as the entity filter', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });

    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    const coOccurrenceButton = sheet.getByRole('button', {
      name: 'Entity Co-occurrence',
    });
    await expect(coOccurrenceButton).toBeVisible({ timeout: 10000 });
    await coOccurrenceButton.click();

    const pairsList = sheet.getByRole('list', {
      name: 'Co-occurring entity pairs',
    });
    await expect(pairsList).toBeVisible({ timeout: 10000 });

    // Click the first entity button in the first pair
    const firstEntityButton = pairsList
      .getByRole('listitem')
      .first()
      .locator('button[aria-label^="Filter by entity:"]')
      .first();
    await expect(firstEntityButton).toBeVisible({ timeout: 5000 });
    await firstEntityButton.click();

    // Expand the Entities section to verify the entity was selected
    const entitiesButton = sheet.getByRole('button', { name: 'Entities' });
    await expect(entitiesButton).toBeVisible({ timeout: 5000 });
    await entitiesButton.click();
    const entitiesGroup = sheet.getByRole('group', { name: 'Entities' });

    // At least one entity button should now be pressed
    const pressedEntity = entitiesGroup.locator(
      'button[aria-pressed="true"]',
    );
    await expect(pressedEntity.first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Filter badge display and removal', () => {
  test('entity type filter badge has a remove button', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });

    // Open filter panel and apply an entity type filter
    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    const entityTypeButton = sheet.getByRole('button', { name: 'Entity Type' });
    await expect(entityTypeButton).toBeVisible({ timeout: 10000 });
    await entityTypeButton.click();

    const entityTypeGroup = sheet.getByRole('group', { name: 'Entity Type' });
    await expect(entityTypeGroup).toBeVisible();

    await entityTypeGroup.getByRole('button').first().click();

    await sheet.getByRole('button', { name: 'Apply filters' }).click();
    await expect(sheet).not.toBeVisible({ timeout: 5000 });

    // Badge should appear with "Entity Type:" label
    const badge = page.getByText('Entity Type:');
    await expect(badge).toBeVisible({ timeout: 5000 });

    // The remove button has aria-label "Remove Entity Type filter: {value}"
    const removeButton = page.getByRole('button', {
      name: /Remove Entity Type filter/,
    });
    await expect(removeButton).toBeVisible();

    // Click to remove the filter
    await removeButton.click();

    // Badge should disappear
    await expect(badge).not.toBeVisible({ timeout: 5000 });
  });

  test('clear all button removes all active entity filters', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });

    // Apply entity type + entity name filters
    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    const entityTypeButton = sheet.getByRole('button', { name: 'Entity Type' });
    const entitiesButton = sheet.getByRole('button', { name: 'Entities' });
    await expect(entityTypeButton).toBeVisible({ timeout: 10000 });
    await expect(entitiesButton).toBeVisible({ timeout: 5000 });

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
    await expect(firstEntityBtn).toBeVisible({ timeout: 5000 });
    await firstEntityBtn.click();

    // Apply
    await sheet.getByRole('button', { name: 'Apply filters' }).click();
    await expect(sheet).not.toBeVisible({ timeout: 5000 });

    // Both badges should be visible
    const entityTypeBadge = page.getByText('Entity Type:');
    const entityBadge = page.getByText('Entity:');
    await expect(entityTypeBadge).toBeVisible({ timeout: 5000 });
    await expect(entityBadge).toBeVisible({ timeout: 5000 });

    // The "Clear all" button appears when activeFilterCount > 1
    const clearAllButton = page.getByRole('button', { name: 'Clear all' });
    await expect(clearAllButton).toBeVisible();

    await clearAllButton.click();

    // All badges should disappear
    await expect(entityTypeBadge).not.toBeVisible({ timeout: 5000 });
    await expect(entityBadge).not.toBeVisible({ timeout: 5000 });
  });

  test('clear all inside filter panel resets entity draft selections', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });

    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    const entityTypeButton = sheet.getByRole('button', { name: 'Entity Type' });
    await expect(entityTypeButton).toBeVisible({ timeout: 10000 });

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
  });
});

test.describe('Entity badges on item detail page', () => {
  test('item detail page shows Entities section in Relationships', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // Navigate directly to the seeded certification item which has multiple
    // entity_mentions (ISO 27001, Cyber Essentials Plus, BSI).
    await page.goto(`/item/${workerData.certificationId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 10000,
    });

    // The Relationships section is a collapsible section. The seeded data
    // guarantees the section renders with entity badges.
    const relationshipsButton = page.getByRole('button', {
      name: 'Relationships',
    });
    await expect(relationshipsButton).toBeVisible({ timeout: 10000 });
    await relationshipsButton.click();

    // EntityBadges renders a <section aria-label="Entities mentioned in this content">
    const entitiesSection = page.locator(
      'section[aria-label="Entities mentioned in this content"]',
    );
    await expect(entitiesSection).toBeVisible({ timeout: 10000 });
    await expect(entitiesSection.getByText('Entities')).toBeVisible();

    // The seeded certification item has 3 entity mentions, so badges (not
    // the empty state) must be present.
    const entityBadge = entitiesSection.locator('.flex.flex-wrap');
    await expect(entityBadge.first()).toBeVisible({ timeout: 5000 });
  });

  test('item detail Relationships section shows Related by Shared Entities', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // Item 6 (case study) and item 7 (methodology) both reference "AWS"
    // and "NHS Digital", so the case study item must surface a "Related by
    // Shared Entities" link to the methodology item.
    await page.goto(`/item/${workerData.caseStudyId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 10000,
    });

    const relationshipsButton = page.getByRole('button', {
      name: 'Relationships',
    });
    await expect(relationshipsButton).toBeVisible({ timeout: 10000 });
    await relationshipsButton.click();

    // RelatedByEntities renders "Related by Shared Entities" heading once
    // its async fetch resolves.
    const relatedHeading = page.getByRole('heading', {
      name: 'Related by Shared Entities',
    });
    await expect(relatedHeading).toBeVisible({ timeout: 15000 });

    // At least one related item link should be present in the relationships area
    const relatedLinks = page.locator('a[href^="/item/"]');
    expect(await relatedLinks.count()).toBeGreaterThan(0);
  });
});
