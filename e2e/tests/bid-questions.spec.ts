import { test, expect } from '../fixtures';
import { isMobileViewport } from '../helpers/responsive';
import { createServiceClient } from '../fixtures/supabase';

/**
 * Flow: Procurement Questions Tab
 *
 * Tests the Questions tab on the bid detail page (/bid/[id]) covering
 * question list rendering, section grouping, inline expansion, word
 * limits, add question dialog, edit/delete actions, and role gating.
 *
 * Worker-scoped data provides one bid in "drafting" state with
 * 4 questions across 4 sections (Technical, Experience, Social Value,
 * Commercial) and 2 responses (see test-data-fixture.ts).
 */

// ---------------------------------------------------------------------------
// 1. Question List Rendering
// ---------------------------------------------------------------------------

test.describe('Procurement questions list', () => {
  test('questions tab shows question count and sections', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Click the Questions tab
    const tabNav = page.getByRole('tablist', { name: 'Procurement sections' });
    await tabNav.getByRole('tab', { name: 'Questions' }).click();

    // Question count heading
    await expect(
      page.getByRole('heading', { name: '4 Questions' }),
    ).toBeVisible({ timeout: 10000 });

    // Section count
    await expect(page.getByText(/Across 4 sections/)).toBeVisible();
  });

  test('questions are grouped by section with section headers', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Navigate to Questions tab
    const tabNav = page.getByRole('tablist', { name: 'Procurement sections' });
    await tabNav.getByRole('tab', { name: 'Questions' }).click();

    await expect(
      page.getByRole('heading', { name: '4 Questions' }),
    ).toBeVisible({ timeout: 10000 });

    // All four section headers should be visible
    for (const section of [
      'Technical',
      'Experience',
      'Social Value',
      'Commercial',
    ]) {
      await expect(
        page.getByRole('button', { name: new RegExp(section) }),
      ).toBeVisible();
    }
  });

  test('each section shows question count', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Navigate to Questions tab
    const tabNav = page.getByRole('tablist', { name: 'Procurement sections' });
    await tabNav.getByRole('tab', { name: 'Questions' }).click();

    await expect(
      page.getByRole('heading', { name: '4 Questions' }),
    ).toBeVisible({ timeout: 10000 });

    // Each section has "1 question" text (all sections have exactly 1 question)
    const sectionButtons = page
      .getByRole('button')
      .filter({ hasText: /1 question$/ });
    await expect(sectionButtons).toHaveCount(4);
  });

  test('question row shows question text and word limit', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Navigate to Questions tab
    const tabNav = page.getByRole('tablist', { name: 'Procurement sections' });
    await tabNav.getByRole('tab', { name: 'Questions' }).click();

    // First question text should be visible
    await expect(
      page.getByText(
        'Describe your approach to providing IT support services.',
      ),
    ).toBeVisible({ timeout: 10000 });

    // Word limit displays as "500w" (not "500")
    await expect(page.getByText('500w')).toBeVisible();
  });

  test('question row shows status indicator', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Navigate to Questions tab
    const tabNav = page.getByRole('tablist', { name: 'Procurement sections' });
    await tabNav.getByRole('tab', { name: 'Questions' }).click();

    await expect(
      page.getByRole('heading', { name: '4 Questions' }),
    ).toBeVisible({ timeout: 10000 });

    // The seeded data has 4 questions: 2 have responses (Q1 approved, Q2 draft),
    // and 2 have no responses (Q3, Q4 = "Not Started").
    // Status indicators are rendered as spans with the status label text.
    // Assert that "Not Started" appears for questions without responses.
    const notStartedIndicators = page.getByText('Not Started', { exact: true });
    await expect(notStartedIndicators.first()).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// 2. Question Row Expansion
// ---------------------------------------------------------------------------

test.describe('Procurement question row expansion', () => {
  test('clicking question row expands inline with full details', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Navigate to Questions tab
    const tabNav = page.getByRole('tablist', { name: 'Procurement sections' });
    await tabNav.getByRole('tab', { name: 'Questions' }).click();

    await expect(
      page.getByRole('heading', { name: '4 Questions' }),
    ).toBeVisible({ timeout: 10000 });

    // Click the first question row (it's a button role)
    const questionRow = page.getByRole('button', {
      name: /Describe your approach/,
    });
    await expect(questionRow).toBeVisible();
    await questionRow.click();

    // After expanding, the row should show aria-expanded="true"
    await expect(questionRow).toHaveAttribute('aria-expanded', 'true');

    // Expanded content should show section name
    await expect(page.getByText('Section: Technical')).toBeVisible();

    // Expanded content should show word limit (as number, not "500w")
    await expect(page.getByText('Word limit: 500')).toBeVisible();
  });

  test('expanded question shows edit and delete buttons for admin', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Navigate to Questions tab
    const tabNav = page.getByRole('tablist', { name: 'Procurement sections' });
    await tabNav.getByRole('tab', { name: 'Questions' }).click();

    await expect(
      page.getByRole('heading', { name: '4 Questions' }),
    ).toBeVisible({ timeout: 10000 });

    // Click to expand first question
    const questionRow = page.getByRole('button', {
      name: /Describe your approach/,
    });
    await questionRow.click();

    // Edit and Delete buttons should be visible
    await expect(page.getByRole('button', { name: /Edit/ })).toBeVisible();

    await expect(page.getByRole('button', { name: /Delete/ })).toBeVisible();
  });

  test('clicking expanded question row collapses it', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Navigate to Questions tab
    const tabNav = page.getByRole('tablist', { name: 'Procurement sections' });
    await tabNav.getByRole('tab', { name: 'Questions' }).click();

    await expect(
      page.getByRole('heading', { name: '4 Questions' }),
    ).toBeVisible({ timeout: 10000 });

    // Expand
    const questionRow = page.getByRole('button', {
      name: /Describe your approach/,
    });
    await questionRow.click();
    await expect(questionRow).toHaveAttribute('aria-expanded', 'true');

    // Collapse
    await questionRow.click();
    await expect(questionRow).toHaveAttribute('aria-expanded', 'false');
  });
});

// ---------------------------------------------------------------------------
// 3. Add Question Dialog
// ---------------------------------------------------------------------------

test.describe('Procurement add question dialog', () => {
  test('Add Question button opens dialog with form fields', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Navigate to Questions tab
    const tabNav = page.getByRole('tablist', { name: 'Procurement sections' });
    await tabNav.getByRole('tab', { name: 'Questions' }).click();

    await expect(
      page.getByRole('heading', { name: '4 Questions' }),
    ).toBeVisible({ timeout: 10000 });

    // Click "Add Question" button (the trigger button outside the dialog)
    await page.getByRole('button', { name: 'Add Question' }).click();

    // Dialog should appear
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await expect(
      dialog.getByRole('heading', { name: 'Add Question' }),
    ).toBeVisible();

    // Form fields
    await expect(dialog.getByLabel('Section Name')).toBeVisible();
    await expect(dialog.getByLabel(/Question Text/)).toBeVisible();
    await expect(dialog.getByLabel('Word Limit')).toBeVisible();

    // Submit and cancel buttons
    await expect(
      dialog.getByRole('button', { name: 'Add Question' }),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('add question creates a new question and refreshes list', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Navigate to Questions tab
    const tabNav = page.getByRole('tablist', { name: 'Procurement sections' });
    await tabNav.getByRole('tab', { name: 'Questions' }).click();

    await expect(
      page.getByRole('heading', { name: '4 Questions' }),
    ).toBeVisible({ timeout: 10000 });

    const uniqueText = `E2E test question ${Date.now()}`;

    try {
      // Click "Add Question" button (the trigger button outside the dialog)
      await page.getByRole('button', { name: 'Add Question' }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // Fill in the form
      const sectionInput = dialog.getByLabel('Section Name');
      await expect(sectionInput).toBeVisible();
      await sectionInput.fill('E2E Test Section');

      const questionInput = dialog.getByLabel(/Question Text/);
      await expect(questionInput).toBeVisible();
      await questionInput.fill(uniqueText);

      const wordLimitInput = dialog.getByLabel('Word Limit');
      await expect(wordLimitInput).toBeVisible();
      await wordLimitInput.fill('250');

      // Submit
      await dialog.getByRole('button', { name: 'Add Question' }).click();

      // Dialog should close
      await expect(dialog).not.toBeVisible({ timeout: 10000 });

      // Question count should update to 5
      await expect(
        page.getByRole('heading', { name: '5 Questions' }),
      ).toBeVisible({ timeout: 10000 });

      // New question should appear in the list
      await expect(page.getByText(uniqueText)).toBeVisible();
    } finally {
      // Clean up the created question via API
      const supabase = createServiceClient();
      await supabase
        .from('form_questions')
        .delete()
        .eq('workspace_id', workerData.procurementId)
        .like('question_text', `%${uniqueText}%`);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Section Collapse/Expand
// ---------------------------------------------------------------------------

test.describe('Procurement question sections', () => {
  test('section header can be collapsed and expanded', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Navigate to Questions tab
    const tabNav = page.getByRole('tablist', { name: 'Procurement sections' });
    await tabNav.getByRole('tab', { name: 'Questions' }).click();

    await expect(
      page.getByRole('heading', { name: '4 Questions' }),
    ).toBeVisible({ timeout: 10000 });

    // Find the Technical section header button
    const sectionHeader = page
      .getByRole('button', { name: /Technical/ })
      .filter({ hasText: /1 question/ });
    await expect(sectionHeader).toBeVisible();

    // Initially expanded (aria-expanded="true")
    await expect(sectionHeader).toHaveAttribute('aria-expanded', 'true');

    // Click to collapse
    await sectionHeader.click();
    await expect(sectionHeader).toHaveAttribute('aria-expanded', 'false');

    // The question within Technical section should be hidden
    await expect(
      page.getByText(
        'Describe your approach to providing IT support services.',
      ),
    ).not.toBeVisible();

    // Click to expand again
    await sectionHeader.click();
    await expect(sectionHeader).toHaveAttribute('aria-expanded', 'true');

    // Question should be visible again
    await expect(
      page.getByText(
        'Describe your approach to providing IT support services.',
      ),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 5. Role Gating
// ---------------------------------------------------------------------------

test.describe('Procurement questions role gating', () => {
  test('viewer cannot see Add Question button', async ({
    viewerPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Navigate to Questions tab
    const tabNav = page.getByRole('tablist', { name: 'Procurement sections' });
    await tabNav.getByRole('tab', { name: 'Questions' }).click();

    // Wait for questions to load
    await expect(
      page.getByText(
        'Describe your approach to providing IT support services.',
      ),
    ).toBeVisible({ timeout: 10000 });

    // Add Question button should NOT be visible for viewers
    await expect(
      page.getByRole('button', { name: 'Add Question' }),
    ).not.toBeVisible();
  });

  test('viewer cannot see edit or delete buttons on expanded question', async ({
    viewerPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Navigate to Questions tab
    const tabNav = page.getByRole('tablist', { name: 'Procurement sections' });
    await tabNav.getByRole('tab', { name: 'Questions' }).click();

    await expect(
      page.getByText(
        'Describe your approach to providing IT support services.',
      ),
    ).toBeVisible({ timeout: 10000 });

    // Expand a question
    const questionRow = page.getByRole('button', {
      name: /Describe your approach/,
    });
    await questionRow.click();
    await expect(questionRow).toHaveAttribute('aria-expanded', 'true');

    // Edit and Delete buttons should NOT be visible for viewers
    // Use the expanded section area to scope our search
    await expect(
      page.getByRole('button', { name: /^Edit$/ }),
    ).not.toBeVisible();

    await expect(
      page.getByRole('button', { name: /^Delete$/ }),
    ).not.toBeVisible();
  });

  test('editor can access Questions tab and see Add Question button', async ({
    editorPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Navigate to Questions tab
    const tabNav = page.getByRole('tablist', { name: 'Procurement sections' });
    await tabNav.getByRole('tab', { name: 'Questions' }).click();

    // Questions should load
    await expect(
      page.getByRole('heading', { name: '4 Questions' }),
    ).toBeVisible({ timeout: 10000 });

    // Editor should see Add Question button
    await expect(
      page.getByRole('button', { name: 'Add Question' }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 6. Tab Badge and Bulk Actions
// ---------------------------------------------------------------------------

test.describe('Procurement questions tab badge and bulk actions', () => {
  test('Questions tab shows count badge with 4', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // The Questions tab should show a count badge
    // Tab structure: <button role="tab">Questions <span>4</span></button>
    const tabNav = page.getByRole('tablist', { name: 'Procurement sections' });
    const questionsTab = tabNav.getByRole('tab', { name: 'Questions' });
    await expect(questionsTab).toBeVisible();

    // The tab contains a badge span with the count "4"
    await expect(
      questionsTab.locator('span').filter({ hasText: '4' }),
    ).toBeVisible();
  });

  test('bulk action buttons are visible when questions have no matches', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Navigate to Questions tab
    const tabNav = page.getByRole('tablist', { name: 'Procurement sections' });
    await tabNav.getByRole('tab', { name: 'Questions' }).click();

    await expect(
      page.getByRole('heading', { name: '4 Questions' }),
    ).toBeVisible({ timeout: 10000 });

    // All 4 seeded questions are unmatched, so "Find answers" bulk action should be visible
    await expect(
      page.getByRole('button', { name: /Find answers/i }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 7. Mobile
// ---------------------------------------------------------------------------

test.describe('Procurement questions mobile', () => {
  test('questions tab loads on mobile viewport without horizontal overflow', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // Only run on mobile
    if (!isMobileViewport(page)) {
      test.skip();
      return;
    }

    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Navigate to Questions tab
    const tabNav = page.getByRole('tablist', { name: 'Procurement sections' });
    await tabNav.getByRole('tab', { name: 'Questions' }).click();

    // Questions should load
    await expect(
      page.getByRole('heading', { name: '4 Questions' }),
    ).toBeVisible({ timeout: 10000 });

    // Verify no horizontal overflow: document scrollWidth should equal clientWidth
    const hasOverflow = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
      );
    });
    expect(hasOverflow).toBe(false);

    // First question text should be visible on mobile
    await expect(
      page.getByText(
        'Describe your approach to providing IT support services.',
      ),
    ).toBeVisible();
  });
});
