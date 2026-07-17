/**
 * WP2 Phase 1 spec — 8.0.3 bid create happy path submit
 *
 * USER FLOW:
 *   1. As admin (authenticatedPage), navigate to `/procurement`.
 *   2. Click the "New Procurement" / "Create Procurement" trigger to open the create
 *      dialog (the dialog is already covered by existing tests; we add
 *      the SUBMIT path here).
 *   3. Fill the Name field with `[E2E-WP2-8.0.3] Submit Path Procurement <ts>`
 *      and the Buyer field with `E2E Submit Buyer`.
 *   4. Click the "Create Procurement" submit button inside the dialog.
 *   5. Wait for navigation to `/procurement/<uuid>` (use `page.waitForURL` with a
 *      regex on the UUID segment, NOT a fixed timeout).
 *   6. Reload the page and assert the bid name still renders (proves the
 *      DB write persisted, not just an optimistic UI update).
 *
 * ASSERTIONS (each must be verifiable from browser state OR DB state — no
 * trivial "element exists" checks; every assertion must map to a failure mode):
 *   - URL after submit matches `/procurement/[0-9a-f-]{36}` exactly.
 *   - A `form_instances` row (ID-145 {145.6}/{145.18} form-first
 *     re-architecture — NOT a `workspaces` row post-W1) with the typed
 *     Name and the typed Buyer (on `issuing_organisation`, a top-level
 *     column, NOT a `domain_metadata` JSONB key) exists in DB. Verified via
 *     service-key query against the captured form_instances id from the URL.
 *   - On reload, the bid name is visible in the page heading (proves the
 *     row is fetched back, not a transient client cache).
 *   - The `form_instances.created_by` matches the admin user id (proves the
 *     POST handler is reading auth, not inserting NULL).
 *
 * FIXTURE DATA (pre-seeded before test runs):
 *   - None — this test creates its own bid row via the UI submit. Worker
 *     prefix is used in the typed Name for cleanup matching.
 *   - Admin user from `authenticatedPage` fixture (TEST_USER_1).
 *
 * EXPECTED FAILURE MODES (production-code breakages this test must catch —
 * each must map to >= 1 assertion above):
 *   - `POST /api/procurement` returns 200 without inserting into
 *     `form_instances` → caught by DB row existence assertion.
 *   - Submit handler navigates to `/procurement` (list) instead of `/procurement/<id>` →
 *     caught by URL regex assertion.
 *   - `created_by` left NULL because auth context not threaded through →
 *     caught by created_by match assertion.
 *   - Buyer field stored under the wrong column → caught by buyer DB
 *     assertion.
 *   - Procurement persists only in client memory, not DB → caught by post-reload
 *     name visibility assertion.
 *
 * ROLE SCOPING:
 *   Uses `authenticatedPage` (admin) fixture. Reason: admin can create
 *   bids; editor can also create — but admin is the canonical happy path
 *   and editor create is covered indirectly by existing role-gating
 *   tests. Viewer create is forbidden and tested in 8.0.6.
 *
 * CLEANUP:
 *   afterEach: service-key delete of any `form_instances` row whose name
 *   starts with `[E2E-WP2-8.0.3]` (idempotent — also handles partial
 *   failures). The Phase 3 implementer must use the worker prefix
 *   pattern from `data-factory.createTestBid` for safe parallel runs.
 *
 * VERIFIED AGAINST PRODUCTION (Phase 2 adversarial review; re-verified
 * ID-145 {145.23} post-W1):
 *   - `app/api/procurement/route.ts` POST handler inserts into the
 *     `form_instances` table and stores buyer in `issuing_organisation`
 *     (a top-level column, not a `domain_metadata` JSONB key).
 *   - `created_by` is set to `user.id` from `getAuthorisedClient`
 *     (admin/editor), so the assertion on `created_by` is meaningful.
 *   - The handler returns the inserted row; the front-end
 *     (`components/procurement/procurement-creation-wizard.tsx`) then
 *     navigates to `/procurement/<id>` (`app/procurement/page.tsx`
 *     `handleProcurementCreated`). If the navigation step is intercepted by
 *     an intermediate page, the URL regex assertion still passes as long as
 *     the final URL matches.
 *
 * EXPLICIT FORBIDDEN PATTERNS (Phase 3 implementer must NOT do these):
 *   - DO NOT mock `/api/procurement` POST or stub the supabase client. The test
 *     must run against the real route handler with a real DB write.
 *   - DO NOT pre-seed a row with the same name in `beforeEach` — that
 *     would make the post-reload "name visible" assertion pass even if
 *     the create flow did nothing (Attack 2 — trivial fixture).
 *   - DO NOT wrap the DB assertion in `if (formInstanceId) { ... }` — if
 *     the URL capture fails, the test must FAIL loudly, not silently
 *     skip the DB check.
 *   - DO NOT replace the `created_by === admin.id` assertion with
 *     `created_by !== null` — null-checks are too weak; the canonical
 *     "auth not threaded through" failure mode inserts NULL OR an
 *     incorrect uuid (e.g. service-role uuid).
 */

import { test, expect } from '../fixtures';
import { isMobileViewport } from '../helpers/responsive';
import { createTestBid } from '../helpers/data-factory';
import { createServiceClient } from '../fixtures/supabase';

/**
 * Flow: Procurement Pipeline
 *
 * Tests for the Procurement Pipeline pages covering the bid list
 * (/procurement), bid detail (/procurement/[id]), status filters,
 * role-based behaviour, bid creation form, and mobile responsiveness.
 *
 * Worker-scoped data provides one bid in "drafting" state with
 * 4 questions and 2 responses (see test-data-fixture.ts).
 */

// ---------------------------------------------------------------------------
// 1. Procurement List Page (/bid)
// ---------------------------------------------------------------------------

test.describe('Procurement list page', () => {
  test('bid list page loads with heading', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/procurement');

    await expect(
      page.getByRole('heading', { name: 'Procurement' }),
    ).toBeVisible({
      timeout: 10000,
    });

    await expect(
      page.getByText(
        'Manage your procurement engagements and the forms within them',
      ),
    ).toBeVisible();
  });

  test('bid cards display key information', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto('/procurement');

    // Wait for bid cards to load. Scope to the card root (data-testid)
    // because the ProcurementWorkflowBadge is a sibling of the <Link>, not inside it.
    const bidCard = page.getByTestId(
      `procurement-card-${workerData.procurementId}`,
    );
    await expect(bidCard).toBeVisible({ timeout: 10000 });

    // Procurement name (with prefix)
    await expect(bidCard.getByText('IT Support Services')).toBeVisible();

    // Status badge — bid is in "drafting" state, label is "Drafting"
    await expect(bidCard.getByText('Drafting')).toBeVisible();

    // Buyer
    await expect(bidCard.getByText('E2E Test Corp')).toBeVisible();
  });

  test('status filter buttons are displayed', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/procurement');

    // Wait for content to load
    await expect(
      page.getByRole('heading', { name: 'Procurement' }),
    ).toBeVisible({
      timeout: 10000,
    });

    // Filter group
    const filterGroup = page.getByRole('group', { name: 'Filter by status' });
    await expect(filterGroup).toBeVisible({ timeout: 10000 });

    // Each filter button
    for (const label of ['All', 'Draft', 'Active', 'Submitted', 'Completed']) {
      await expect(
        filterGroup.getByRole('button', { name: label }),
      ).toBeVisible();
    }
  });

  test('status filter: Active shows only active bids', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // The worker bid is in "drafting" state which maps to "Active" filter.
    // Create a "draft" state bid to verify it is hidden when Active is selected.
    const draftBidId = await createTestBid(workerData.prefix, {
      name: `${workerData.prefix} Draft Filter Test ${Date.now()}`,
    });

    try {
      await page.goto('/procurement');

      const filterGroup = page.getByRole('group', { name: 'Filter by status' });
      await expect(filterGroup).toBeVisible({ timeout: 10000 });

      // Click "Active" filter
      await filterGroup.getByRole('button', { name: 'Active' }).click();

      // Worker bid (drafting state = Active) should remain visible
      const workerCard = page.locator(
        `a[href="/procurement/${workerData.procurementId}"]`,
      );
      await expect(workerCard).toBeVisible();

      // Draft bid should be hidden
      const draftCard = page.locator(`a[href="/procurement/${draftBidId}"]`);
      await expect(draftCard).not.toBeVisible();
    } finally {
      // Clean up the temporary bid (a `form_instances` row, ID-145 W1)
      const supabase = createServiceClient();
      await supabase.from('form_instances').delete().eq('id', draftBidId);
    }
  });

  test('status filter: shows empty message when no matches', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/procurement');

    const filterGroup = page.getByRole('group', { name: 'Filter by status' });
    await expect(filterGroup).toBeVisible({ timeout: 10000 });

    // Click "Completed" filter — no won/lost/withdrawn bids exist in worker data
    await filterGroup.getByRole('button', { name: 'Completed' }).click();

    await expect(
      page.getByText('No procurements match the selected filter.'),
    ).toBeVisible();
  });

  test('bid card links to detail page', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto('/procurement');

    const bidCard = page.locator(
      `a[href="/procurement/${workerData.procurementId}"]`,
    );
    await expect(bidCard).toBeVisible({ timeout: 10000 });

    await bidCard.click();

    await expect(page).toHaveURL(`/procurement/${workerData.procurementId}`);
  });
});

// ---------------------------------------------------------------------------
// 2. Procurement Creation Form
// ---------------------------------------------------------------------------

test.describe('Procurement creation form', () => {
  test('create dialog opens on New Procurement click', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/procurement');
    await expect(
      page.getByRole('heading', { name: 'Procurement' }),
    ).toBeVisible({
      timeout: 10000,
    });

    await page.getByRole('button', { name: 'New Procurement' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('heading', { name: 'Create New Procurement' }),
    ).toBeVisible();
  });

  test('create dialog has required fields', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/procurement');
    await expect(
      page.getByRole('heading', { name: 'Procurement' }),
    ).toBeVisible({
      timeout: 10000,
    });

    await page.getByRole('button', { name: 'New Procurement' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Required fields (marked with *)
    await expect(dialog.getByLabel(/Procurement Name/)).toBeVisible();
    await expect(dialog.getByLabel(/Buyer/)).toBeVisible();

    // Optional fields
    await expect(dialog.getByLabel('Submission Deadline')).toBeVisible();
    await expect(dialog.getByLabel('Reference Number')).toBeVisible();
    await expect(dialog.getByLabel('Estimated Value')).toBeVisible();
    await expect(dialog.getByLabel('Notes')).toBeVisible();
  });

  test('create button disabled without required fields', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/procurement');
    await expect(
      page.getByRole('heading', { name: 'Procurement' }),
    ).toBeVisible({
      timeout: 10000,
    });

    await page.getByRole('button', { name: 'New Procurement' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // The in-use dialog is ProcurementCreationWizard (3-step), which exposes
    // two submit affordances on step 1: "Start Blank Procurement" (type=button,
    // create-only path) and "Create & Upload Tender" (type=submit, advance
    // path) — button copy re-verified against
    // components/procurement/procurement-creation-wizard.tsx (ID-145 {145.23}).
    // Both must be disabled until both required fields are filled.
    const createWithoutDocButton = dialog.getByRole('button', {
      name: /Start Blank Procurement/,
    });
    const nextButton = dialog.getByRole('button', {
      name: /Create & Upload Tender/,
    });
    await expect(createWithoutDocButton).toBeDisabled();
    await expect(nextButton).toBeDisabled();

    // Fill only name — still disabled
    await dialog.locator('#wizard-procurement-name').fill('Test Procurement');
    await expect(createWithoutDocButton).toBeDisabled();
    await expect(nextButton).toBeDisabled();

    // Fill buyer too — STILL disabled: both submit buttons are gated on three
    // required inputs (name + buyer + form type), and the form type is not yet
    // selected. Production gate:
    // `saving || !name.trim() || !buyer.trim() || !formType`
    // (components/procurement/procurement-creation-wizard.tsx). The
    // FormTypePicker (ID-130 {130.12}) predates the {145.6} form-first work, so
    // this is the true gating contract, not a W1 regression (ID-145 {145.23}).
    await dialog.locator('#wizard-procurement-buyer').fill('Test Buyer');
    await expect(createWithoutDocButton).toBeDisabled();
    await expect(nextButton).toBeDisabled();

    // Pick a form type — selecting a radio only stages the choice locally
    // (FormTypePicker's `setSelected`, form-type-picker.tsx:165); it does NOT
    // fire `onConfirm`, so the wizard's `formType` state
    // (procurement-creation-wizard.tsx:278 `onConfirm={(type) =>
    // setFormType(type)}`) is still null and both submit affordances remain
    // disabled. This is a deliberate two-step infer-then-confirm contract
    // (WCAG-considered — selection and confirmation are separate controls,
    // ID-130 {130.12}, re-verified {145.23}), not a bug: don't "fix" this by
    // removing the confirm step below.
    await dialog
      .getByRole('radiogroup', { name: 'Form type' })
      .getByRole('radio')
      .first()
      .click();
    await expect(createWithoutDocButton).toBeDisabled();
    await expect(nextButton).toBeDisabled();

    // Click the separate "Confirm form type" button (form-type-picker.tsx:192-200)
    // — only now does `onConfirm(selected)` fire, setting the wizard's
    // `formType` and satisfying the third required input, so both submit
    // affordances enable.
    await dialog.getByRole('button', { name: /Confirm form type/ }).click();
    await expect(createWithoutDocButton).toBeEnabled();
    await expect(nextButton).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// 3. Procurement Detail Page (/procurement/[id])
// ---------------------------------------------------------------------------

test.describe('Procurement detail page', () => {
  test('detail page loads with bid name and status', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    // Heading with bid name
    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // ProcurementWorkflowBadge with "Drafting" label (bid is in drafting state)
    await expect(page.getByText('Drafting').first()).toBeVisible();
  });

  test('detail page shows buyer and deadline', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Buyer
    await expect(page.getByText('E2E Test Corp')).toBeVisible();

    // Deadline — formatted in UK date format (DD/MM/YYYY)
    // The deadline is 14 days from fixture seeding time; just verify
    // a date-like string is present near the calendar icon
    const deadlineSpan = page
      .locator('span')
      .filter({ hasText: /\d{2}\/\d{2}\/\d{4}/ });
    await expect(deadlineSpan.first()).toBeVisible();
  });

  test('state stepper is displayed', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // ProcurementWorkflowStepper has role="list" with aria-label="Procurement progress"
    const stepper = page.getByRole('list', { name: 'Procurement progress' });
    await expect(stepper).toBeVisible();

    // Should have step indicators (listitems)
    const steps = stepper.getByRole('listitem');
    await expect(steps.first()).toBeVisible();
  });

  test('tab navigation shows Overview, Questions, Responses, Documents', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Tab nav uses role="tablist" with aria-label "Procurement sections"
    const tabNav = page.getByRole('tablist', { name: 'Procurement sections' });
    await expect(tabNav).toBeVisible();

    // Tab buttons (role="tab"). The Questions tab has a count badge so its
    // accessible name is "Questions <count>" — match by regex.
    await expect(tabNav.getByRole('tab', { name: 'Overview' })).toBeVisible();
    await expect(tabNav.getByRole('tab', { name: /^Questions/ })).toBeVisible();
    await expect(tabNav.getByRole('tab', { name: 'Responses' })).toBeVisible();
    await expect(tabNav.getByRole('tab', { name: /^Documents/ })).toBeVisible();
  });

  test('overview tab shows progress section', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Overview is the default tab — "Progress" heading should be visible
    await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();

    // Should show question progress text (bid has 4 questions)
    await expect(page.getByText(/of \d+ questions drafted/)).toBeVisible();
  });

  test('questions tab shows question list', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Click the Questions tab
    const tabNav = page.getByRole('tablist', { name: 'Procurement sections' });
    await tabNav.getByRole('tab', { name: /^Questions/ }).click();

    // Verify one of the seeded questions is visible
    await expect(
      page.getByText(
        'Describe your approach to providing IT support services.',
      ),
    ).toBeVisible({ timeout: 10000 });
  });

  test('back to bids link works', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // "Back to Bids" link
    const backLink = page.getByRole('link', { name: 'Back to Bids' });
    await expect(backLink).toBeVisible();

    await backLink.click();

    await expect(page).toHaveURL('/procurement');
  });
});

// ---------------------------------------------------------------------------
// 4. Role-Based Behaviour
// ---------------------------------------------------------------------------

test.describe('Procurement role gating', () => {
  test('New Procurement button visible for admin', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/procurement');
    await expect(
      page.getByRole('heading', { name: 'Procurement' }),
    ).toBeVisible({
      timeout: 10000,
    });

    await expect(
      page.getByRole('button', { name: 'New Procurement' }),
    ).toBeVisible();
  });

  test('New Procurement button visible for editor', async ({
    editorPage: page,
  }) => {
    await page.goto('/procurement');
    await expect(
      page.getByRole('heading', { name: 'Procurement' }),
    ).toBeVisible({
      timeout: 10000,
    });

    await expect(
      page.getByRole('button', { name: 'New Procurement' }),
    ).toBeVisible();
  });

  test('New Procurement button hidden for viewer', async ({
    viewerPage: page,
  }) => {
    await page.goto('/procurement');
    await expect(
      page.getByRole('heading', { name: 'Procurement' }),
    ).toBeVisible({
      timeout: 10000,
    });

    await expect(
      page.getByRole('button', { name: 'New Procurement' }),
    ).not.toBeVisible();
  });

  test('viewer cannot see action buttons on detail page', async ({
    viewerPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Viewer should not see state transition buttons, Open Session, or More actions
    await expect(
      page.getByRole('button', { name: 'Open Session' }),
    ).not.toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Open Session' }),
    ).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'More actions' }),
    ).not.toBeVisible();
  });

  test('admin sees delete option in more actions menu', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Desktop renders an icon button with sr-only "More actions"; mobile
    // renders a MobileActionMenu trigger labelled "Actions". Take whichever
    // is visible for the current viewport.
    const moreButton = page
      .getByRole('button', { name: /More actions|^Actions$/ })
      .first();
    await expect(moreButton).toBeVisible();

    await moreButton.click();

    // Dropdown menu item "Delete bid"
    await expect(
      page.getByRole('menuitem', { name: 'Delete bid' }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 5. Mobile-Specific
// ---------------------------------------------------------------------------

test.describe('Procurement mobile layout', () => {
  test('bid cards stack vertically on mobile', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // Only meaningful on mobile viewport
    if (!isMobileViewport(page)) {
      test.skip();
      return;
    }

    await page.goto('/procurement');

    const bidCard = page.getByTestId(
      `procurement-card-${workerData.procurementId}`,
    );
    await expect(bidCard).toBeVisible({ timeout: 10000 });

    // On mobile, the grid should be single column (no sm:grid-cols-2).
    // Verify the grid container does not have the multi-column class applied.
    const grid = page.locator('.grid.gap-4').first();
    const gridBox = await grid.boundingBox();
    const cardBox = await bidCard.boundingBox();

    // Card should be nearly full-width of the grid (single column)
    if (gridBox && cardBox) {
      const widthRatio = cardBox.width / gridBox.width;
      expect(widthRatio).toBeGreaterThan(0.9);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. WP2 Phase 3 — 8.0.3 bid create happy path submit
// ---------------------------------------------------------------------------

test.describe('Procurement create happy path submit (8.0.3)', () => {
  // Idempotent cleanup: delete any form_instances rows whose name carries
  // the 8.0.3 prefix from this or previous runs (ID-145 W1 — procurement
  // items are `form_instances` rows, not `workspaces` rows).
  const NAME_PREFIX = '[E2E-WP2-8.0.3]';

  test.afterEach(async () => {
    const supabase = createServiceClient();
    try {
      await supabase
        .from('form_instances')
        .delete()
        .like('name', `${NAME_PREFIX}%`);
    } catch (err) {
      // Cleanup must never mask test failures
      console.error('8.0.3 cleanup failed:', err);
    }
  });

  test('submit creates a bid that persists in DB and renders after reload', async ({
    authenticatedPage: page,
    workerData: _workerData,
  }) => {
    // workerData fixture is referenced (even though unused) so the worker
    // seeds at least one bid before this test runs — the bid list page then
    // shows the header "New Procurement" button rather than the empty-state CTA.
    void _workerData;
    const supabase = createServiceClient();

    // Resolve admin user id by email so we can assert created_by exactly.
    // NOTE: `auth.admin.listUsers` is currently returning a 500 on the live
    // Supabase project (see e2e/global-setup.ts comment). We resolve via
    // user_roles + per-row getUserById, which still works.
    const adminEmail = process.env.TEST_USER_1_EMAIL;
    expect(adminEmail, 'TEST_USER_1_EMAIL must be set in env').toBeTruthy();
    const { data: adminRoles, error: rolesErr } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin');
    if (rolesErr) throw rolesErr;
    let adminUserId: string | null = null;
    for (const row of adminRoles ?? []) {
      const { data: userData } = await supabase.auth.admin.getUserById(
        (row as { user_id: string }).user_id,
      );
      if (userData?.user?.email === adminEmail) {
        adminUserId = userData.user!.id;
        break;
      }
    }
    expect(
      adminUserId,
      `Admin user ${adminEmail} must be resolvable via user_roles`,
    ).toBeTruthy();

    // Compose a unique name carrying the 8.0.3 prefix for safe cleanup.
    const uniqueName = `${NAME_PREFIX} Submit Path Procurement ${Date.now()}`;
    const buyerName = 'E2E Submit Buyer';

    // 1. Navigate to /procurement
    await page.goto('/procurement');
    await expect(
      page.getByRole('heading', { name: 'Procurement' }),
    ).toBeVisible({
      timeout: 10000,
    });

    // 2. Open the create dialog via the header "New Procurement" button. The
    //    workerData fixture above ensures at least one bid is seeded so
    //    this button is rendered (the empty-state CTA is hidden).
    const newBidButton = page.getByRole('button', { name: 'New Procurement' });
    await expect(newBidButton).toBeVisible({ timeout: 10000 });
    await newBidButton.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(
      dialog.getByRole('heading', { name: 'Create New Procurement' }),
    ).toBeVisible();

    // 3. Fill required fields. The wizard
    //    (`components/procurement/procurement-creation-wizard.tsx`) renders
    //    inputs with `wizard-procurement-name` / `wizard-procurement-buyer`
    //    ids, a `FormTypePicker` radiogroup (also required — both submit
    //    buttons stay disabled without a selection), and submits the
    //    create-only path via the "Start Blank Procurement" button
    //    (`handleCreateProcurement(e, false)`, which POSTs /api/procurement
    //    and navigates via `onCreated`/`router.push`).
    await dialog
      .getByRole('radiogroup', { name: 'Form type' })
      .getByRole('radio')
      .first()
      .click();
    const nameInput = dialog.locator('#wizard-procurement-name');
    await nameInput.waitFor({ state: 'visible', timeout: 10000 });
    await nameInput.fill(uniqueName);
    const buyerInput = dialog.locator('#wizard-procurement-buyer');
    await buyerInput.waitFor({ state: 'visible' });
    await buyerInput.fill(buyerName);

    // 4. Submit via "Start Blank Procurement" (the create-only path).
    const createButton = dialog.getByRole('button', {
      name: /Start Blank Procurement/,
    });
    await expect(createButton).toBeVisible({ timeout: 10000 });
    await expect(createButton).toBeEnabled();

    // Wait for the POST + the resulting navigation deterministically.
    const postPromise = page.waitForResponse(
      (resp) =>
        resp.request().method() === 'POST' &&
        /\/api\/procurement$/.test(new URL(resp.url()).pathname),
    );
    await createButton.click();
    const postResponse = await postPromise;
    expect(postResponse.status(), 'POST /api/procurement must return 201').toBe(
      201,
    );

    // 5. Wait for navigation to /procurement/<uuid>
    await page.waitForURL(/\/procurement\/[0-9a-f-]{36}$/, { timeout: 15000 });

    // ASSERTION: URL matches /procurement/<uuid> exactly (BI-31 — never
    // /bid/<uuid> or /bids/<uuid>).
    const url = new URL(page.url());
    const uuidMatch = url.pathname.match(/^\/procurement\/([0-9a-f-]{36})$/);
    expect(
      uuidMatch,
      `URL ${url.pathname} must match /procurement/<uuid>`,
    ).not.toBeNull();
    const formInstanceId = uuidMatch![1];

    // ASSERTION: form_instances row exists with the correct name and buyer
    // (ID-145 {145.6}/{145.18} form-first re-architecture — the item IS the
    // form; no `workspaces` row, no `domain_metadata` JSONB).
    const { data: row, error: rowErr } = await supabase
      .from('form_instances')
      .select('id, name, issuing_organisation, created_by')
      .eq('id', formInstanceId)
      .single();
    if (rowErr) throw rowErr;
    expect(row, 'form_instances row must exist').toBeTruthy();
    expect(row!.name).toBe(uniqueName);

    // ASSERTION: buyer stored under `issuing_organisation` (a top-level
    // column, not a `domain_metadata` JSONB key).
    expect(row!.issuing_organisation).toBe(buyerName);

    // ASSERTION: created_by matches the admin user id (proves auth is
    // threaded through). Exact equality, not a null-check.
    expect(row!.created_by).toBe(adminUserId);

    // 6. Reload and assert the bid name still renders (proves DB persistence,
    // not optimistic UI state).
    await page.reload();
    await expect(
      page.getByRole('heading', { name: new RegExp(escapeRegex(uniqueName)) }),
    ).toBeVisible({ timeout: 15000 });
  });
});

// Helper: escape arbitrary text for use in a RegExp.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
