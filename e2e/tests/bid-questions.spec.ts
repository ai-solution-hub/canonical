import { test, expect } from '../fixtures';
import { isMobileViewport } from '../helpers/responsive';

/**
 * Flow: Procurement Questions Tab
 *
 * Tests the Questions tab on the procurement detail page
 * (/procurement/[id]) against the ID-145 {145.44} ItemQuestionsPanel
 * (components/procurement/item-questions-panel.tsx — BI-40 honest
 * per-question states). The legacy QuestionList/QuestionRow surface
 * (collapsible sections, Add Question dialog, per-question Edit/Delete)
 * was removed as dead code in the {145.23} close-gate sweep, so this
 * spec asserts the CURRENT IA:
 *
 *   - a lowercase count paragraph "N questions" (NOT a heading role);
 *   - plain <h3> section headers (no collapse affordance);
 *   - role="listitem" question rows (data-testid="question-row-<id>")
 *     showing question text, "Word limit: N", and an honest state badge
 *     (Approved / Drafted / Matched / No match found);
 *   - "Find answers for N questions" + "Draft All" bulk affordances
 *     (canEdit only);
 *   - a manual-answer affordance on zero-match questions (canEdit only).
 *
 * Worker-scoped data provides one bid in "drafting" state with 4
 * questions across 4 sections (Technical, Experience, Social Value,
 * Commercial) and 2 responses — Q1 approved, Q2 draft; Q3/Q4 have no
 * response and no match candidates (confidence_posture NULL), so they
 * render the "No match found" empty state (see test-data-fixture.ts).
 */

/** Navigate to the detail page and open the Questions tab. */
async function gotoQuestionsTab(
  page: import('@playwright/test').Page,
  procurementId: string,
): Promise<void> {
  await page.goto(`/procurement/${procurementId}`);

  await expect(
    page.getByRole('heading', { name: /IT Support Services/ }),
  ).toBeVisible({ timeout: 10000 });

  const tabNav = page.getByRole('tablist', { name: 'Procurement sections' });
  await tabNav.getByRole('tab', { name: /^Questions/ }).click();

  // The count line is the panel's stable "loaded" signal — a lowercase
  // <p> "4 questions" (NOT a heading; the pre-{145.44} "4 Questions"
  // heading no longer exists).
  await expect(page.getByText('4 questions', { exact: true })).toBeVisible({
    timeout: 10000,
  });
}

// ---------------------------------------------------------------------------
// 1. Question List Rendering
// ---------------------------------------------------------------------------

test.describe('Procurement questions list', () => {
  test('questions tab shows count line and section headers', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await gotoQuestionsTab(page, workerData.procurementId);

    // All four section names render as plain <h3> headers (role=heading,
    // level 3 — display-only grouping, no collapse buttons).
    for (const section of [
      'Technical',
      'Experience',
      'Social Value',
      'Commercial',
    ]) {
      await expect(
        page.getByRole('heading', { name: section, exact: true, level: 3 }),
      ).toBeVisible();
    }
  });

  test('question rows show text and word limit', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await gotoQuestionsTab(page, workerData.procurementId);

    // First question row (scoped by its stable data-testid).
    const firstRow = page.getByTestId(
      `question-row-${workerData.questionIds[0]}`,
    );
    await expect(firstRow).toBeVisible();
    await expect(
      firstRow.getByText(
        'Describe your approach to providing IT support services.',
      ),
    ).toBeVisible();

    // Word limit renders inline as "Word limit: 500" (the pre-{145.44}
    // compact "500w" chip no longer exists).
    await expect(firstRow.getByText('Word limit: 500')).toBeVisible();
  });

  test('question rows show honest per-question state badges', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await gotoQuestionsTab(page, workerData.procurementId);

    const rowFor = (index: number) =>
      page.getByTestId(`question-row-${workerData.questionIds[index]}`);

    // Q1 has an approved response → "Approved".
    await expect(
      rowFor(0).getByText('Approved', { exact: true }),
    ).toBeVisible();

    // Q2 has a draft response → "Drafted". (exact: true keeps this from
    // colliding with the page-header "Drafting" workflow badge or the
    // Overview "questions drafted" copy.)
    await expect(rowFor(1).getByText('Drafted', { exact: true })).toBeVisible();

    // Q3/Q4 have no response and no match candidate → "No match found"
    // (the pre-{145.44} "Not Started" label no longer exists).
    await expect(
      rowFor(2).getByText('No match found', { exact: true }),
    ).toBeVisible();
    await expect(
      rowFor(3).getByText('No match found', { exact: true }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. Manual-Answer Affordance (zero-match questions only, BI-40)
// ---------------------------------------------------------------------------

test.describe('Procurement manual-answer affordance', () => {
  test('zero-match questions offer a direct-answer affordance; answered ones do not', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await gotoQuestionsTab(page, workerData.procurementId);

    const rowFor = (index: number) =>
      page.getByTestId(`question-row-${workerData.questionIds[index]}`);

    // Q3 (empty state) shows the affordance for an editor/admin.
    await expect(
      rowFor(2).getByRole('button', { name: 'Answer this question directly' }),
    ).toBeVisible();

    // Q1 (approved) must NOT show it — the affordance is a narrow
    // fallback for questions the corpus cannot answer at all.
    await expect(
      rowFor(0).getByRole('button', { name: 'Answer this question directly' }),
    ).not.toBeVisible();
  });

  test('affordance expands to a manual-answer form and cancel collapses it', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await gotoQuestionsTab(page, workerData.procurementId);

    const emptyRow = page.getByTestId(
      `question-row-${workerData.questionIds[2]}`,
    );
    await emptyRow
      .getByRole('button', { name: 'Answer this question directly' })
      .click();

    // Expanded form: labelled textarea + optional KB-promotion checkbox +
    // Save answer / Cancel. (Cancel path only — no writes from this test.)
    await expect(
      emptyRow.getByLabel(
        /^Manual answer for: How will you deliver social value/,
      ),
    ).toBeVisible();
    await expect(
      emptyRow.getByText('Also add this answer to your knowledge base'),
    ).toBeVisible();
    await expect(
      emptyRow.getByRole('button', { name: 'Save answer' }),
    ).toBeVisible();

    await emptyRow.getByRole('button', { name: 'Cancel' }).click();

    // Collapses back to the affordance button.
    await expect(
      emptyRow.getByRole('button', { name: 'Answer this question directly' }),
    ).toBeVisible();
    await expect(
      emptyRow.getByRole('button', { name: 'Save answer' }),
    ).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. Bulk Actions (Find answers / Draft All)
// ---------------------------------------------------------------------------

test.describe('Procurement questions bulk actions', () => {
  test('Find answers and Draft All are visible for admin', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await gotoQuestionsTab(page, workerData.procurementId);

    // All 4 seeded questions have confidence_posture NULL (unmatched), so
    // the match affordance renders with the unmatched count in its label.
    await expect(
      page.getByRole('button', { name: /^Find answers for \d+ questions?$/ }),
    ).toBeVisible();

    await expect(
      page.getByRole('button', { name: /^Draft All$/ }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 4. Role Gating
// ---------------------------------------------------------------------------

test.describe('Procurement questions role gating', () => {
  test('viewer sees questions but no write affordances', async ({
    viewerPage: page,
    workerData,
  }) => {
    await gotoQuestionsTab(page, workerData.procurementId);

    // Questions render for viewers…
    await expect(
      page.getByText(
        'Describe your approach to providing IT support services.',
      ),
    ).toBeVisible();

    // …but every write affordance is hidden (canEdit gating).
    await expect(
      page.getByRole('button', { name: /^Draft All$/ }),
    ).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: /^Find answers for/ }),
    ).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Answer this question directly' }),
    ).not.toBeVisible();
  });

  test('editor can access Questions tab and see Draft All', async ({
    editorPage: page,
    workerData,
  }) => {
    await gotoQuestionsTab(page, workerData.procurementId);

    await expect(
      page.getByRole('button', { name: /^Draft All$/ }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 5. Tab Badge
// ---------------------------------------------------------------------------

test.describe('Procurement questions tab badge', () => {
  test('Questions tab shows count badge with 4', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // The Questions tab carries a count badge span with the count "4"
    // (tab accessible name is therefore "Questions 4").
    const tabNav = page.getByRole('tablist', { name: 'Procurement sections' });
    const questionsTab = tabNav.getByRole('tab', { name: /^Questions/ });
    await expect(questionsTab).toBeVisible();
    await expect(
      questionsTab.locator('span').filter({ hasText: '4' }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 6. Mobile
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

    await gotoQuestionsTab(page, workerData.procurementId);

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
