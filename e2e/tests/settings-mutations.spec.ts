import { test, expect } from '../fixtures';
import { getSettingsNav } from '../helpers/responsive';

// ---------------------------------------------------------------------------
// Deterministic reference-data fixtures (ID-128 {128.9})
// ---------------------------------------------------------------------------
//
// Liam ratified treating taxonomy + governance reference data as AMBIENT →
// SEED it deterministically so these specs can HARD-assert equality against a
// known domain name (NOT `> 0`) per test-philosophy.md §2.1. The rows are
// provisioned by `bun run seed:e2e-users`
// (scripts/seed-e2e-users.ts → seedTaxonomyGovernanceFixture). These literals
// MUST stay in lock-step with that script.
//
// Taxonomy domain: seeded slug 'e2e-seeded-domain'. The DomainCard renders
// formatDomainName(name) → kebab-case to Title Case; 'e2e' is not in the
// abbreviation list so it title-cases to 'E2e' (lib/taxonomy/taxonomy-format.ts).
const SEEDED_TAXONOMY_DOMAIN_DISPLAY = 'E2e Seeded Domain';
// Governance rule: governance_config.domain stores the taxonomy slug verbatim
// (matches the real Add-Domain flow, which submits the SelectItem value = the
// taxonomy domain slug). The config row renders config.domain unformatted.
const SEEDED_GOVERNANCE_DOMAIN = 'e2e-seeded-domain';

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
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
      timeout: 10000,
    });

    const main = page.locator('main');
    await expect(
      main.getByRole('heading', { name: /team members/i }),
    ).toBeVisible({ timeout: 15000 });

    // At least one user row should be visible
    // Look for email addresses (contain @)
    const emailElements = main.getByText(/@/);
    await expect(emailElements.first()).toBeVisible({ timeout: 10000 });

    // HARD assert the admin's own role badge. The authenticated user for this
    // spec is the seeded admin (test.user1, role 'admin' via
    // `bun run seed:e2e-users`), and the team table renders the current user's
    // own row with a static "Admin" Badge. The prior soft
    // `.catch(() => false)` loop over Admin/Editor/Viewer silently passed
    // whenever the role badges drifted (test-philosophy §2.1).
    await expect(main.getByText('Admin', { exact: true }).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('non-current-user row has role dropdown with Admin/Editor/Viewer options', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings?section=team');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
      timeout: 10000,
    });

    const main = page.locator('main');
    await expect(
      main.getByRole('heading', { name: /team members/i }),
    ).toBeVisible({ timeout: 15000 });

    // Each non-current-user row renders a role <Select> (via SelectTrigger,
    // role="combobox") with an aria-label "Role for <name>"; the current
    // user's own row shows a static Badge instead (components/settings/
    // team-section.tsx TeamMemberRow — a responsive `role="list"` Card
    // layout, NOT a <table>; the prior `main.locator('table')` scope never
    // matched any element post-restructure, timing out regardless of data).
    //
    // Staging seeds three test users (admin/editor/viewer) via `bun run seed:e2e-users`
    // and the authenticated user for this test is admin, so at least two
    // non-self rows (editor + viewer) must render a role dropdown. The previous
    // `if (dropdownCount === 0) { test.skip(...) }` conditional silently passed
    // when the user_roles fixture drifted per `feedback_e2e_conditional_false_pass`
    // (test-philosophy §2.1).
    const roleDropdowns = main.getByRole('combobox', { name: /^Role for /i });
    await expect(roleDropdowns.first()).toBeVisible({ timeout: 10000 });

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
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
      timeout: 10000,
    });

    const main = page.locator('main');
    await expect(
      main.getByRole('heading', { name: /team members/i }),
    ).toBeVisible({ timeout: 15000 });

    // Find the invite/add button. The team-section component renders the
    // InviteUserDialog trigger ("Invite User" button) unconditionally for the
    // admin user once the team list has loaded (see components/settings/team-section.tsx).
    // The previous `if (!isVisible) { test.skip(...) }` conditional silently
    // passed if the invite flow regressed or the admin role gating broke, per
    // `feedback_e2e_conditional_false_pass` (test-philosophy §2.1).
    const inviteButton = main
      .getByRole('button', { name: /invite|add/i })
      .first();
    await expect(inviteButton).toBeVisible({ timeout: 10000 });

    await inviteButton.click();

    // Dialog should appear
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Email input should be present
    const emailInput = dialog.getByLabel(/email/i);
    await expect(emailInput).toBeVisible();
    await emailInput.fill('not-an-email');

    // Role selector should be present
    const roleSelector = dialog
      .getByText(/role/i)
      .or(dialog.getByRole('combobox'));
    await expect(roleSelector.first()).toBeVisible();

    // The email input has the HTML `required` attribute and type="email",
    // so the browser validates on submit without a custom error message.
    await expect(emailInput).toHaveAttribute('required', '');
    await expect(emailInput).toHaveAttribute('type', 'email');

    // Try to submit — validation should prevent it
    const submitButton = dialog
      .getByRole('button', { name: /invite|add|send/i })
      .last();
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
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
      timeout: 10000,
    });

    const main = page.locator('main');

    // Verify the Content Organisation heading is visible
    await expect(
      main.getByRole('heading', { name: /Content Organisation/i }),
    ).toBeVisible({ timeout: 15000 });

    // Wait for the "Add Domain" button to confirm the taxonomy section loaded
    await expect(main.getByRole('button', { name: /Add Domain/i })).toBeVisible(
      { timeout: 15000 },
    );

    // The "Categories" heading should be visible (default tab)
    await expect(
      main.getByRole('heading', { name: /Categories/ }),
    ).toBeVisible();

    // HARD assert the deterministically seeded taxonomy domain card by its
    // known display name. `bun run seed:e2e-users` seeds a taxonomy_domains row
    // name='e2e-seeded-domain'; the DomainCard renders formatDomainName(name)
    // → 'E2e Seeded Domain'. This replaces the prior ambient-dependent
    // ">=1 Move domain button" check that silently passed on whatever staging
    // taxonomy happened to exist (test-philosophy §2.1).
    await expect(
      main.getByText(SEEDED_TAXONOMY_DOMAIN_DISPLAY, { exact: true }),
    ).toBeVisible({ timeout: 15000 });

    // Domain reorder controls confirm the cards are real, interactive domain
    // rows (the seeded domain guarantees at least one reorder button renders).
    await expect(
      main.getByRole('button', { name: 'Move domain up' }).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('add domain button opens dialog with required fields', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings?section=content-organisation');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
      timeout: 10000,
    });

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
    const nameInput = dialog
      .getByLabel(/name/i)
      .or(dialog.getByRole('textbox'));
    await expect(nameInput.first()).toBeVisible();

    // Dialog should contain a submit button
    const submitButton = dialog.getByRole('button', {
      name: /add|create|save/i,
    });
    await expect(submitButton.first()).toBeVisible();
  });

  test('tag morphology section loads with drift-review tabs', async ({
    authenticatedPage: page,
  }) => {
    // The old "tags" tab under content-organisation (Tag Health / Duplicates /
    // By Domain / All Tags) was retired in the ID-131-wave restructure —
    // content-organisation-section.tsx's Tabs now render only "categories"
    // and "depth-levels" (`tab=tags` is not a recognised value and falls back
    // to the default tab). General tag management was replaced by the
    // narrower admin/editor-only "Tag Morphology Drift" review console
    // (components/settings/tag-morphology-section.tsx, its own top-level
    // sidebar section — settings-sidebar.tsx `tag-morphology`), which lists
    // `tag_morphology_drift_flags` filtered by decision (Pending/Accepted/
    // Overrides/Dismissed/All).
    await page.goto('/settings?section=tag-morphology');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
      timeout: 10000,
    });

    const main = page.locator('main');
    await expect(
      main.getByRole('heading', { name: 'Tag Morphology Drift' }),
    ).toBeVisible({ timeout: 15000 });

    // The decision-filter tabs confirm the section's own internal Tabs render.
    await expect(main.getByRole('tab', { name: 'Pending' })).toBeVisible();
    await expect(main.getByRole('tab', { name: 'All' })).toBeVisible();
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
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
      timeout: 10000,
    });

    const main = page.locator('main');

    // Wait for governance content to load (Suspense boundary)
    // Look for the governance config heading which has a specific ID
    await expect(main.locator('#governance-config-heading')).toBeVisible({
      timeout: 15000,
    });

    // Verify the heading text matches "Quality Review Rules"
    await expect(main.locator('#governance-config-heading')).toHaveText(
      /Quality Review Rules/,
    );

    // Hard-expect the populated governance configuration list. Staging
    // fixtures must seed at least one governance rule for this test; missing
    // fixtures fail honestly rather than silently passing on the empty state.
    const configList = main.locator(
      '[role="list"][aria-labelledby="governance-config-heading"]',
    );
    await expect(configList).toBeVisible({ timeout: 3000 });

    // HARD assert the deterministically seeded governance rule row by its known
    // domain. `bun run seed:e2e-users` seeds a governance_config row
    // domain='e2e-seeded-domain' preset='light_touch'; the row renders
    // config.domain verbatim plus a 'Light-touch' preset badge. This replaces
    // the prior `itemCount > 0` check that silently passed on whatever ambient
    // staging governance reference data existed (test-philosophy §2.1).
    const seededConfigRow = configList
      .locator('[role="listitem"]')
      .filter({ hasText: SEEDED_GOVERNANCE_DOMAIN });
    await expect(seededConfigRow).toHaveCount(1);

    // The seeded row's domain label is rendered verbatim (hard equality).
    // Scoped to `p` — the row's "Edit" Button also carries the shared
    // `text-sm font-medium` utility classes (components/settings/
    // governance-section.tsx), so the untyped class-only locator matched
    // both the domain <p> and the Edit <button> (strict-mode violation).
    await expect(seededConfigRow.locator('p.text-sm.font-medium')).toHaveText(
      SEEDED_GOVERNANCE_DOMAIN,
    );

    // The seeded row carries its preset badge (light_touch → 'Light-touch').
    await expect(seededConfigRow.locator('[data-slot="badge"]')).toHaveText(
      'Light-touch',
    );

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
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
      timeout: 10000,
    });

    const settingsNav = await getSettingsNav(page);

    // Personal sections should be visible
    await expect(settingsNav.getByText('Profile')).toBeVisible();
    await expect(settingsNav.getByText('Connections')).toBeVisible();

    // Admin-only sections should NOT be visible
    await expect(settingsNav.getByText('Team')).not.toBeVisible();
    await expect(settingsNav.getByText('Quality Review')).not.toBeVisible();
    await expect(
      settingsNav.getByText('Content Organisation'),
    ).not.toBeVisible();
    // 'Activity' was removed from the settings sidebar (replaced by the
    // /provenance route's audit tab, commit f5a1ff05) — 'Provenance' is the
    // current admin-only system-group section this gating check exercises.
    await expect(settingsNav.getByText('Provenance')).not.toBeVisible();
  });

  test('viewer sees only personal sections in settings', async ({
    viewerPage: page,
  }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
      timeout: 10000,
    });

    const settingsNav = await getSettingsNav(page);

    // Personal sections should be visible
    await expect(settingsNav.getByText('Profile')).toBeVisible();
    await expect(settingsNav.getByText('Connections')).toBeVisible();

    // Admin-only sections should NOT be visible
    await expect(settingsNav.getByText('Team')).not.toBeVisible();
    await expect(settingsNav.getByText('Quality Review')).not.toBeVisible();
    await expect(
      settingsNav.getByText('Content Organisation'),
    ).not.toBeVisible();
    await expect(settingsNav.getByText('Provenance')).not.toBeVisible();
  });

  test('admin sees all settings sections', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
      timeout: 10000,
    });

    const settingsNav = await getSettingsNav(page);

    // Personal sections
    await expect(settingsNav.getByText('Profile')).toBeVisible();
    await expect(settingsNav.getByText('Connections')).toBeVisible();

    // Content management sections (admin only)
    await expect(settingsNav.getByText('Content Organisation')).toBeVisible();

    // System sections (admin only). 'Activity' was removed from the settings
    // sidebar (replaced by the /provenance route's audit tab, commit
    // f5a1ff05) — the stale 'Activity' assertion timed out unconditionally
    // (S457 Class 4). 'Provenance' is the current admin-only replacement.
    await expect(settingsNav.getByText('Team')).toBeVisible();
    await expect(settingsNav.getByText('Quality Review')).toBeVisible();
    await expect(settingsNav.getByText('Provenance')).toBeVisible();
  });
});
