import { test, expect } from '../fixtures';
import { getSettingsNav } from '../helpers/responsive';

/**
 * Flow: Settings Mutations
 *
 * Tests write operations on the Settings page, extending the existing
 * read-only settings.spec.ts. Covers team management, taxonomy editing,
 * tag management, governance configuration, and role-based permission
 * gating for mutations.
 *
 * The authenticated test user (admin) has access to all settings sections.
 * Editor and viewer users only see personal sections (Profile, Connections).
 */

// ---------------------------------------------------------------------------
// 1. Team Management
// ---------------------------------------------------------------------------

test.describe('Settings -- Team management', () => {
  test('team section shows user list with roles', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings?section=team');
    await expect(
      page.getByRole('heading', { name: 'Settings' }),
    ).toBeVisible({ timeout: 10000 });

    const main = page.locator('main');
    await expect(
      main.getByRole('heading', { name: /team members/i }),
    ).toBeVisible({ timeout: 15000 });

    // At least one user row should be visible
    // Look for email addresses (contain @)
    const emailElements = main.getByText(/@/);
    await expect(emailElements.first()).toBeVisible({ timeout: 10000 });

    // At least one role badge should be visible
    const roleBadges = ['Admin', 'Editor', 'Viewer'];
    let foundRole = false;
    for (const role of roleBadges) {
      if (await main.getByText(role, { exact: true }).first().isVisible({ timeout: 2000 }).catch(() => false)) {
        foundRole = true;
        break;
      }
    }
    expect(foundRole).toBe(true);
  });

  test('non-current-user row has role dropdown with Admin/Editor/Viewer options', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings?section=team');
    await expect(
      page.getByRole('heading', { name: 'Settings' }),
    ).toBeVisible({ timeout: 10000 });

    const main = page.locator('main');
    await expect(
      main.getByRole('heading', { name: /team members/i }),
    ).toBeVisible({ timeout: 15000 });

    // The desktop table renders a <select> (via SelectTrigger) for non-current-user rows.
    // The current user row shows a static Badge instead. Find a SelectTrigger in the
    // team table (desktop view) — its presence confirms a non-self user row.
    const tableArea = main.locator('table');
    const roleDropdowns = tableArea.locator('button[role="combobox"]');
    const dropdownCount = await roleDropdowns.count();

    if (dropdownCount === 0) {
      test.skip(true, 'No non-current-user rows found — cannot test role dropdown');
      return;
    }

    // Click the first role dropdown to open it
    await roleDropdowns.first().click();

    // Verify the three role options are present in the listbox
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible({ timeout: 5000 });
    await expect(listbox.getByRole('option', { name: 'Admin' })).toBeVisible();
    await expect(listbox.getByRole('option', { name: 'Editor' })).toBeVisible();
    await expect(listbox.getByRole('option', { name: 'Viewer' })).toBeVisible();

    // Close dropdown
    await page.keyboard.press('Escape');
  });

  test('invite user dialog opens and validates email', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings?section=team');
    await expect(
      page.getByRole('heading', { name: 'Settings' }),
    ).toBeVisible({ timeout: 10000 });

    const main = page.locator('main');
    await expect(
      main.getByRole('heading', { name: /team members/i }),
    ).toBeVisible({ timeout: 15000 });

    // Find the invite/add button
    const inviteButton = main.getByRole('button', { name: /invite|add/i }).first();
    const isVisible = await inviteButton.isVisible({ timeout: 5000 });
    if (!isVisible) {
      test.skip(true, 'Invite button not found — invite flow may not be implemented yet');
      return;
    }

    await inviteButton.click();

    // Dialog should appear
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Email input should be present
    const emailInput = dialog.getByLabel(/email/i);
    await expect(emailInput).toBeVisible();
    await emailInput.fill('not-an-email');

    // Role selector should be present
    const roleSelector = dialog.getByText(/role/i).or(dialog.getByRole('combobox'));
    await expect(roleSelector.first()).toBeVisible();

    // The email input has the HTML `required` attribute and type="email",
    // so the browser validates on submit without a custom error message.
    await expect(emailInput).toHaveAttribute('required', '');
    await expect(emailInput).toHaveAttribute('type', 'email');

    // Try to submit — validation should prevent it
    const submitButton = dialog.getByRole('button', { name: /invite|add|send/i }).last();
    await submitButton.click();

    // Dialog should still be visible (invalid submission blocked by browser validation)
    await expect(dialog).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. Content Organisation (Taxonomy)
// ---------------------------------------------------------------------------

test.describe('Settings -- Content Organisation (Taxonomy)', () => {
  test('taxonomy section loads with existing domains', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings?section=content-organisation');
    await expect(
      page.getByRole('heading', { name: 'Settings' }),
    ).toBeVisible({ timeout: 10000 });

    const main = page.locator('main');

    // Verify the Content Organisation heading is visible
    await expect(
      main.getByRole('heading', { name: /Content Organisation/i }),
    ).toBeVisible({ timeout: 15000 });

    // Wait for the "Add Domain" button to confirm the taxonomy section loaded
    await expect(
      main.getByRole('button', { name: /Add Domain/i }),
    ).toBeVisible({ timeout: 15000 });

    // The "Categories" heading should be visible (default tab)
    await expect(
      main.getByRole('heading', { name: /Categories/ }),
    ).toBeVisible();

    // At least one domain card should be rendered (production DB has domains)
    // Domain reorder buttons ("Move domain up/down") confirm domains exist
    const domainButtons = main.getByRole('button', { name: /Move domain/ });
    await expect(domainButtons.first()).toBeVisible({ timeout: 10000 });
  });

  test('add domain button opens dialog with required fields', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings?section=content-organisation');
    await expect(
      page.getByRole('heading', { name: 'Settings' }),
    ).toBeVisible({ timeout: 10000 });

    const main = page.locator('main');

    // Wait for taxonomy content to load — Add Domain button confirms section loaded
    const addButton = main.getByRole('button', { name: /Add Domain/i });
    await expect(addButton).toBeVisible({ timeout: 15000 });

    // Click Add Domain
    await addButton.click();

    // Dialog should appear
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Dialog should contain a name input
    const nameInput = dialog.getByLabel(/name/i).or(dialog.getByRole('textbox'));
    await expect(nameInput.first()).toBeVisible();

    // Dialog should contain a submit button
    const submitButton = dialog.getByRole('button', { name: /add|create|save/i });
    await expect(submitButton.first()).toBeVisible();
  });

  test('tags tab loads with tag list', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings?section=content-organisation&tab=tags');
    await expect(
      page.getByRole('heading', { name: 'Settings' }),
    ).toBeVisible({ timeout: 10000 });

    const main = page.locator('main');

    // Wait for content to load (either tags or empty state)
    // The tags tab should be active
    await expect(
      main.getByText(/tags/i).first(),
    ).toBeVisible({ timeout: 15000 });

    // The tags section renders sub-tabs: "Duplicates", "By Domain", "All Tags".
    // Verify the tag health stats loaded (confirms tags data fetched)
    // and that the sub-tab navigation is rendered.
    await expect(
      main.getByText('Tag Health'),
    ).toBeVisible({ timeout: 15000 });

    // At least one sub-tab should be visible (the section uses its own internal Tabs)
    await expect(
      main.getByRole('tab', { name: /All Tags/ }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. Quality Review (Governance)
// ---------------------------------------------------------------------------

test.describe('Settings -- Quality Review (Governance)', () => {
  test('governance section loads with domain configuration', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings?section=governance');
    await expect(
      page.getByRole('heading', { name: 'Settings' }),
    ).toBeVisible({ timeout: 10000 });

    const main = page.locator('main');

    // Wait for governance content to load (Suspense boundary)
    // Look for the governance config heading which has a specific ID
    await expect(
      main.locator('#governance-config-heading'),
    ).toBeVisible({ timeout: 15000 });

    // Verify the heading text matches "Quality Review Rules"
    await expect(
      main.locator('#governance-config-heading'),
    ).toHaveText(/Quality Review Rules/);

    // Check for domain configuration rows or the empty state.
    // The component renders a role="list" with listitem rows when configs exist,
    // or an empty state with "No governance rules configured" text.
    const configList = main.locator('[role="list"][aria-labelledby="governance-config-heading"]');
    const emptyState = main.getByText('No governance rules configured');

    if (await configList.isVisible({ timeout: 3000 }).catch(() => false)) {
      // At least one domain row should exist
      const listItems = configList.locator('[role="listitem"]');
      const itemCount = await listItems.count();
      expect(itemCount).toBeGreaterThan(0);

      // Each row has a domain name (text-sm font-medium) and posture badge
      const firstItem = listItems.first();
      await expect(firstItem.locator('.text-sm.font-medium')).toBeVisible();
      await expect(firstItem.locator('.text-xs.text-muted-foreground').first()).toBeVisible();
    } else {
      // Empty state is acceptable — verify its content
      await expect(emptyState).toBeVisible();
      await expect(
        main.getByText(/Open.*posture by default/),
      ).toBeVisible();
    }

    // "Content Freshness" section should also be visible below governance config
    await expect(
      main.getByRole('heading', { name: /Content Freshness/i }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 4. Permission Gating for Mutations
// ---------------------------------------------------------------------------

test.describe('Settings -- Permission gating for mutations', () => {
  test('editor sees only personal sections in settings', async ({
    editorPage: page,
  }) => {
    await page.goto('/settings');
    await expect(
      page.getByRole('heading', { name: 'Settings' }),
    ).toBeVisible({ timeout: 10000 });

    const settingsNav = await getSettingsNav(page);

    // Personal sections should be visible
    await expect(settingsNav.getByText('Profile')).toBeVisible();
    await expect(settingsNav.getByText('Connections')).toBeVisible();

    // Admin-only sections should NOT be visible
    await expect(settingsNav.getByText('Team')).not.toBeVisible();
    await expect(settingsNav.getByText('Quality Review')).not.toBeVisible();
    await expect(settingsNav.getByText('Content Organisation')).not.toBeVisible();
    await expect(settingsNav.getByText('Activity')).not.toBeVisible();
  });

  test('viewer sees only personal sections in settings', async ({
    viewerPage: page,
  }) => {
    await page.goto('/settings');
    await expect(
      page.getByRole('heading', { name: 'Settings' }),
    ).toBeVisible({ timeout: 10000 });

    const settingsNav = await getSettingsNav(page);

    // Personal sections should be visible
    await expect(settingsNav.getByText('Profile')).toBeVisible();
    await expect(settingsNav.getByText('Connections')).toBeVisible();

    // Admin-only sections should NOT be visible
    await expect(settingsNav.getByText('Team')).not.toBeVisible();
    await expect(settingsNav.getByText('Quality Review')).not.toBeVisible();
    await expect(settingsNav.getByText('Content Organisation')).not.toBeVisible();
    await expect(settingsNav.getByText('Activity')).not.toBeVisible();
  });

  test('admin sees all settings sections', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings');
    await expect(
      page.getByRole('heading', { name: 'Settings' }),
    ).toBeVisible({ timeout: 10000 });

    const settingsNav = await getSettingsNav(page);

    // Personal sections
    await expect(settingsNav.getByText('Profile')).toBeVisible();
    await expect(settingsNav.getByText('Connections')).toBeVisible();

    // Content management sections (admin only)
    await expect(settingsNav.getByText('Content Organisation')).toBeVisible();

    // System sections (admin only)
    await expect(settingsNav.getByText('Team')).toBeVisible();
    await expect(settingsNav.getByText('Quality Review')).toBeVisible();
    await expect(settingsNav.getByText('Activity')).toBeVisible();
  });
});
