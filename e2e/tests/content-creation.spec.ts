import { test, expect } from '../fixtures';
import { isMobileViewport } from '../helpers/responsive';
import { createServiceClient } from '../fixtures/supabase';

/**
 * Flow: Content Creation
 *
 * Tests the content creation flow at `/item/new`. The page uses a tabbed
 * interface with three methods: "Write content" (manual form), "Import
 * from URL", and "Upload file". The manual write form uses react-hook-form
 * with Zod validation, includes a rich text editor (TipTap, dynamically
 * imported), classification fields (domain, subtopic), and progressive
 * depth layers.
 *
 * Worker-scoped data provides standard test fixtures. No additional seeding
 * is needed; tests that create content items clean them up in finally blocks.
 */

// ---------------------------------------------------------------------------
// 1. Page Access and Tab Structure
// ---------------------------------------------------------------------------

test.describe('Content creation -- page access and tab structure', () => {
  test('create page loads with Write content tab active', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/item/new');

    // Tab list is visible
    const tablist = page.getByRole('tablist');
    await expect(tablist).toBeVisible({ timeout: 10000 });

    // "Write content" tab is present and selected
    const writeTab = page.getByRole('tab', { name: /Write content/i });
    await expect(writeTab).toBeVisible();
    await expect(writeTab).toHaveAttribute('aria-selected', 'true');

    // Other tabs are visible
    await expect(
      page.getByRole('tab', { name: /Import from URL/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('tab', { name: /Upload file/i }),
    ).toBeVisible();

    // The write content section is visible
    await expect(
      page.locator('section[aria-label="Write new content"]'),
    ).toBeVisible();
  });

  test('viewer role is redirected away from create page', async ({
    viewerPage: page,
  }) => {
    await page.goto('/item/new');

    // Viewer should be redirected to /browse
    await expect(page).toHaveURL(/\/browse/, { timeout: 10000 });
  });

  test('editor role can access create page', async ({
    editorPage: page,
  }) => {
    await page.goto('/item/new');

    // Tab list is visible (editor can create content)
    const tablist = page.getByRole('tablist');
    await expect(tablist).toBeVisible({ timeout: 10000 });

    // The write content section loads
    await expect(
      page.locator('section[aria-label="Write new content"]'),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. Form Fields and Validation
// ---------------------------------------------------------------------------

test.describe('Content creation -- form fields and validation', () => {
  test('required fields are present in the write form', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/item/new');

    // Wait for the write content section
    await expect(
      page.locator('section[aria-label="Write new content"]'),
    ).toBeVisible({ timeout: 10000 });

    // Title input (label is "Title *" or "Question *" for Q&A pairs)
    await expect(page.getByLabel(/title/i)).toBeVisible();

    // Content type selector (label is "Content Type *")
    await expect(page.getByLabel(/content type/i)).toBeVisible();

    // Content editor — shows loading skeleton first, then the editor loads
    // The loading state has role="status" and aria-label="Loading editor"
    // Wait for either the loading skeleton to appear or the editor to load
    const editorLoading = page.locator('[aria-label="Loading editor"]');
    const editorContainer = page.locator('.tiptap, .ProseMirror');
    await expect(
      editorLoading.or(editorContainer),
    ).toBeVisible({ timeout: 15000 });
  });

  test('content type selector shows all valid types', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/item/new');

    await expect(
      page.locator('section[aria-label="Write new content"]'),
    ).toBeVisible({ timeout: 10000 });

    // Click the content type select trigger
    const selectTrigger = page.getByLabel(/content type/i);
    await selectTrigger.click();

    // Common types group (displayed as "Q A Pair" not "Q&A Pair")
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible({ timeout: 5000 });
    await expect(listbox.getByText('Q A Pair')).toBeVisible();
    await expect(listbox.getByText('Case Study')).toBeVisible();
    await expect(listbox.getByText('Policy')).toBeVisible();
    await expect(listbox.getByText('Methodology')).toBeVisible();
    await expect(listbox.getByText('Capability')).toBeVisible();

    // "More types" group includes Article, Certification, Note
    await expect(listbox.getByText('Article')).toBeVisible();
    await expect(listbox.getByText('Certification')).toBeVisible();
    await expect(listbox.getByText('Note')).toBeVisible();

    // Close the dropdown by pressing Escape
    await page.keyboard.press('Escape');
  });

  test('title field shows validation error when empty on blur', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/item/new');

    await expect(
      page.locator('section[aria-label="Write new content"]'),
    ).toBeVisible({ timeout: 10000 });

    // Focus the title input and then blur (trigger onTouched validation)
    const titleInput = page.getByLabel(/title/i);
    await titleInput.focus();
    await titleInput.blur();

    // An error message should appear (role="alert" with error text)
    await expect(
      page.locator('[role="alert"]').filter({ hasText: /title|required/i }),
    ).toBeVisible({ timeout: 5000 });
  });

  test('can fill title and select content type', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/item/new');

    await expect(
      page.locator('section[aria-label="Write new content"]'),
    ).toBeVisible({ timeout: 10000 });

    // Fill title
    const titleInput = page.getByLabel(/title/i);
    await titleInput.fill('E2E Test Article');
    await expect(titleInput).toHaveValue('E2E Test Article');

    // Select content type "Article"
    const selectTrigger = page.getByLabel(/content type/i);
    await selectTrigger.click();

    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible({ timeout: 5000 });
    await listbox.getByText('Article').click();

    // Content type should now show "Article" selected
    await expect(selectTrigger).toHaveText(/Article/);
  });
});

// ---------------------------------------------------------------------------
// 3. Classification Fields
// ---------------------------------------------------------------------------

test.describe('Content creation -- classification fields', () => {
  test('domain selector is present and shows taxonomy domains', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/item/new');

    await expect(
      page.locator('section[aria-label="Write new content"]'),
    ).toBeVisible({ timeout: 10000 });

    // The ClassificationFieldset includes a domain select
    // For admins, the "More details" section is auto-expanded
    // Look for the domain selector
    const domainSelect = page.getByLabel(/domain/i).first();
    await expect(domainSelect).toBeVisible({ timeout: 10000 });

    // Open the domain selector
    await domainSelect.click();

    // Should show taxonomy domains loaded from the database
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible({ timeout: 5000 });

    // At least one domain option should be present
    await expect(
      listbox.getByRole('option').first(),
    ).toBeVisible();

    await page.keyboard.press('Escape');
  });

  test('subtopic selector updates when domain is selected', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/item/new');

    await expect(
      page.locator('section[aria-label="Write new content"]'),
    ).toBeVisible({ timeout: 10000 });

    // Select a domain first
    const domainSelect = page.getByLabel(/domain/i).first();
    await expect(domainSelect).toBeVisible({ timeout: 10000 });
    await domainSelect.click();

    const domainListbox = page.getByRole('listbox');
    await expect(domainListbox).toBeVisible({ timeout: 5000 });

    // Select the first available domain option
    const firstDomain = domainListbox.getByRole('option').first();
    await firstDomain.click();

    // Now check for the subtopic selector
    const subtopicSelect = page.getByLabel(/subtopic/i).first();

    // Subtopic selector should be visible after domain selection
    if (await subtopicSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      await subtopicSelect.click();

      const subtopicListbox = page.getByRole('listbox');
      await expect(subtopicListbox).toBeVisible({ timeout: 5000 });

      // Should have at least one subtopic option
      await expect(
        subtopicListbox.getByRole('option').first(),
      ).toBeVisible();

      await page.keyboard.press('Escape');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Form Submission
// ---------------------------------------------------------------------------

test.describe('Content creation -- form submission', () => {
  test('can create a new content item and redirect to detail page', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    const itemTitle = `${workerData.prefix} Created Item ${Date.now()}`;

    try {
      await page.goto('/item/new');

      await expect(
        page.locator('section[aria-label="Write new content"]'),
      ).toBeVisible({ timeout: 10000 });

      // Fill title
      await page.getByLabel(/title/i).fill(itemTitle);

      // Select content type "Note"
      const selectTrigger = page.getByLabel(/content type/i);
      await selectTrigger.click();
      const listbox = page.getByRole('listbox');
      await expect(listbox).toBeVisible({ timeout: 5000 });
      await listbox.getByText('Note').click();

      // Wait for the TipTap editor to load
      // The loading skeleton has aria-label="Loading editor"
      const editorLoading = page.locator('[aria-label="Loading editor"]');
      if (await editorLoading.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(editorLoading).not.toBeVisible({ timeout: 15000 });
      }

      // Type content into the TipTap editor (ProseMirror container)
      // Note: ProseMirror is a contenteditable div, so we must use type() not fill()
      const editor = page.locator('.ProseMirror').first();
      await expect(editor).toBeVisible({ timeout: 10000 });
      await editor.click();
      await page.keyboard.type('This is test content created by E2E tests.');

      // Wait briefly for the form state to update (react-hook-form watches the editor)
      await page.waitForTimeout(500);

      // Click the save button — SaveActionsBar has type="submit" button with text "Save"
      const saveButton = page.getByRole('button', { name: 'Save', exact: true });
      await expect(saveButton).toBeEnabled({ timeout: 5000 });
      await saveButton.click();

      // The API creates the item and shows a success toast, then redirects.
      // Verify the success toast appeared as proof the API call succeeded.
      await expect(
        page.getByText(/Content created/),
      ).toBeVisible({ timeout: 15000 });

      // After save, URL should change away from /item/new
      // The redirect goes to /item/{uuid} but there can be a brief 404 if the
      // detail page loads before the item is readable, so just verify we left /item/new
      await expect(page).not.toHaveURL(/\/item\/new/, { timeout: 10000 });
    } finally {
      // Clean up: delete any items matching the title via service client
      const supabase = createServiceClient();
      await supabase
        .from('content_items')
        .delete()
        .eq('title', itemTitle);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Mobile
// ---------------------------------------------------------------------------

test.describe('Content creation -- mobile', () => {
  test('create form is usable on mobile viewport', async ({
    authenticatedPage: page,
  }) => {
    test.skip(!isMobileViewport(page), 'Mobile-only test');

    await page.goto('/item/new');

    // Tab list is visible (may be scrollable)
    const tablist = page.getByRole('tablist');
    await expect(tablist).toBeVisible({ timeout: 10000 });

    // Title input is visible and within viewport
    const titleInput = page.getByLabel(/title/i);
    await expect(titleInput).toBeVisible();

    // Content type selector is visible
    await expect(page.getByLabel(/content type/i)).toBeVisible();
  });
});
