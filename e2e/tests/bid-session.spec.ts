import { test, expect } from '../fixtures';
import { isMobileViewport } from '../helpers/responsive';

/**
 * Flow: Bid Session Page
 *
 * Tests the bid drafting session at /bid/[id]/session. Covers page load,
 * question navigation, response editor, content library drawer, role
 * gating, and mobile-specific compact question bar.
 *
 * Worker-scoped data provides one bid in "drafting" state with
 * 4 questions and 2 responses (see test-data-fixture.ts).
 */

/**
 * Navigate to the session page and wait for the session layout to render.
 * The session page loads data CLIENT-SIDE so needs generous timeouts.
 */
async function gotoSession(
  page: import('@playwright/test').Page,
  bidId: string,
) {
  await page.goto(`/bid/${bidId}/session`);
  // Session page loads data CLIENT-SIDE and may need compilation on first hit.
  // Use a generous timeout to handle both cold starts and data fetching.
  const sessionArea = page.locator('[aria-label="Bid drafting session"]');
  await expect(sessionArea).toBeVisible({ timeout: 20000 });
}

// ---------------------------------------------------------------------------
// 1. Session Page Load
// ---------------------------------------------------------------------------

test.describe('Bid session page load', () => {
  test('session page loads with bid name and back link', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await gotoSession(page, workerData.bidId);

    // Heading with bid name
    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible();

    // Back to bid link
    const backLink = page.getByRole('link', { name: /Back to bid/i });
    await expect(backLink).toBeVisible();
  });

  test('session page shows question navigation', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await gotoSession(page, workerData.bidId);

    // On desktop, the question navigation aside is visible
    // On mobile, the compact question bar is shown instead
    if (!isMobileViewport(page)) {
      const aside = page.locator('aside[aria-label="Question navigation"]');
      await expect(aside).toBeVisible({ timeout: 10000 });
    } else {
      const compactBar = page.locator(
        '[role="navigation"][aria-label="Question navigation"]',
      );
      await expect(compactBar).toBeVisible({ timeout: 10000 });
    }
  });

  test('session page shows response editor area with content', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await gotoSession(page, workerData.bidId);

    // Response editor area
    const editorArea = page.locator('main[aria-label="Response editor"]');
    await expect(editorArea).toBeVisible();

    // Wait for loading spinner to disappear (response loads async)
    const loadingSpinner = editorArea.locator(
      '[aria-label="Loading response"]',
    );
    await expect(loadingSpinner).not.toBeVisible({ timeout: 15000 });

    // After loading, the ProseMirror editor should be rendered inside the editor area.
    // This confirms the response data loaded and the editor initialised — not just an empty shell.
    const editor = editorArea.locator('.ProseMirror');
    await expect(editor).toBeVisible({ timeout: 10000 });
  });

  test('session page shows current question text', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await gotoSession(page, workerData.bidId);

    // The first question text appears in the sidebar (desktop) or
    // compact bar details (mobile, collapsed by default)
    if (!isMobileViewport(page)) {
      const aside = page.locator('aside[aria-label="Question navigation"]');
      await expect(
        aside.getByText(
          'Describe your approach to providing IT support services.',
        ),
      ).toBeVisible({ timeout: 10000 });
    } else {
      // On mobile, the question text is inside a <details> element
      // Click the summary to expand and reveal the question text
      const summary = page.locator('details summary');
      await expect(summary.first()).toBeVisible({ timeout: 5000 });
      await summary.first().click();
      // Wait for expansion then check text inside the details element
      const detailsBlock = page.locator('details').first();
      await expect(
        detailsBlock.getByText(
          'Describe your approach to providing IT support services.',
        ),
      ).toBeVisible({ timeout: 10000 });
    }
  });

  test('session page shows word count indicator for current question', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await gotoSession(page, workerData.bidId);

    if (!isMobileViewport(page)) {
      // Desktop: word count is in the question sidebar panel
      const aside = page.locator('aside[aria-label="Question navigation"]');
      await expect(aside).toBeVisible({ timeout: 10000 });

      // WordCountIndicator renders as role="status" with "X / Y words" text
      // The seeded question has word_limit: 500
      const wordCountStatus = aside.locator('[role="status"]').filter({
        hasText: /\d+ \/ \d+ words/,
      });
      await expect(wordCountStatus).toBeVisible({ timeout: 10000 });
    } else {
      // Mobile: word count is inside the collapsible <details> element
      const summary = page.locator('details summary');
      await expect(summary.first()).toBeVisible({ timeout: 5000 });
      await summary.first().click();

      const wordCountStatus = page.locator('details [role="status"]').filter({
        hasText: /\d+ \/ \d+ words/,
      });
      await expect(wordCountStatus).toBeVisible({ timeout: 10000 });
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Question Navigation
// ---------------------------------------------------------------------------

test.describe('Bid session question navigation', () => {
  test('question navigator shows progress information', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // Skip on mobile — desktop navigator is hidden on mobile
    if (isMobileViewport(page)) {
      test.skip();
      return;
    }

    await gotoSession(page, workerData.bidId);

    const aside = page.locator('aside[aria-label="Question navigation"]');

    // Progress bar exists in the sidebar (may have 0 width if no questions complete)
    const progressbar = aside.locator('[role="progressbar"]');
    await expect(progressbar).toBeAttached({ timeout: 10000 });

    // Question counter (Q1 of 4)
    await expect(aside.getByText(/Q1 of 4/)).toBeVisible();

    // At least one question text snippet is visible in the navigator
    // The navigator buttons show "Q2: Experience" (section name) for the next question
    await expect(
      aside.getByRole('button').filter({ hasText: /Q2/ }),
    ).toBeVisible();
  });

  test('next question button navigates to next question', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // Skip on mobile — uses compact bar with different controls
    if (isMobileViewport(page)) {
      test.skip();
      return;
    }

    await gotoSession(page, workerData.bidId);

    const aside = page.locator('aside[aria-label="Question navigation"]');

    // Should start at Q1
    await expect(aside.getByText(/Q1 of 4/)).toBeVisible({ timeout: 10000 });

    // Click the next button (contains "Q2:" text)
    const nextButton = aside.getByRole('button').filter({ hasText: /Q2/ });
    await nextButton.click();

    // Should now show Q2
    await expect(aside.getByText(/Q2 of 4/)).toBeVisible();

    // Second question text should appear in the sidebar
    await expect(
      aside.getByText(
        'What experience does your organisation have in public sector IT?',
      ),
    ).toBeVisible({ timeout: 10000 });
  });

  test('mobile compact question bar shows question counter', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // Only run on mobile
    if (!isMobileViewport(page)) {
      test.skip();
      return;
    }

    await gotoSession(page, workerData.bidId);

    // Compact bar shows "Q1/4"
    await expect(page.getByText('Q1/4')).toBeVisible();
  });

  test('mobile compact bar next button navigates forward', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // Only run on mobile
    if (!isMobileViewport(page)) {
      test.skip();
      return;
    }

    await gotoSession(page, workerData.bidId);

    // Click the next question button
    const nextButton = page.getByRole('button', { name: 'Next question' });
    await nextButton.click();

    // Should now show Q2/4
    await expect(page.getByText('Q2/4')).toBeVisible();
  });

  test('mobile All button opens question sheet', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // Only run on mobile
    if (!isMobileViewport(page)) {
      test.skip();
      return;
    }

    await gotoSession(page, workerData.bidId);

    // Click the "All" button in the compact question bar
    const allButton = page.getByRole('button', { name: 'All' });
    await expect(allButton).toBeVisible({ timeout: 10000 });
    await allButton.click();

    // Sheet should open with "Questions" heading
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(
      dialog.getByRole('heading', { name: 'Questions' }),
    ).toBeVisible();

    // Sheet description shows question count
    await expect(dialog.getByText(/4 questions/)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. Response Actions and Editor
// ---------------------------------------------------------------------------

test.describe('Bid session response actions', () => {
  test('response actions toolbar is visible for admin', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await gotoSession(page, workerData.bidId);

    // The ResponseActions component should render action buttons
    const editorArea = page.locator('main[aria-label="Response editor"]');
    await expect(editorArea).toBeVisible();

    // Library button should be visible for editors
    await expect(page.getByRole('button', { name: /Library/i })).toBeVisible({
      timeout: 10000,
    });

    // History button should be visible when a response exists (first question has a seeded response)
    await expect(page.getByRole('button', { name: /History/i })).toBeVisible({
      timeout: 10000,
    });
  });

  test('browse for content link is visible', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await gotoSession(page, workerData.bidId);

    // "Browse for content" link
    const browseLink = page.getByRole('link', { name: /Browse for content/i });
    await expect(browseLink).toBeVisible();

    // Verify it has the correct href
    await expect(browseLink).toHaveAttribute(
      'href',
      new RegExp(`/browse\\?from_bid=${workerData.bidId}`),
    );
  });

  test('content library drawer opens on Library button click', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await gotoSession(page, workerData.bidId);

    // Click Library button
    const libraryButton = page.getByRole('button', { name: /Library/i });
    await expect(libraryButton).toBeVisible({ timeout: 10000 });
    await libraryButton.click();

    // Content Library drawer should open (it's a Sheet)
    const drawer = page.locator('[role="dialog"]');
    await expect(drawer).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// 4. Role-Based Behaviour
// ---------------------------------------------------------------------------

test.describe('Bid session role gating', () => {
  test('viewer cannot see response action buttons', async ({
    viewerPage: page,
    workerData,
  }) => {
    await gotoSession(page, workerData.bidId);

    // Viewer should not see the Library button (gated behind canEdit)
    await expect(
      page.getByRole('button', { name: /Library/i }),
    ).not.toBeVisible();
  });

  test('back to bid link navigates to bid detail', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await gotoSession(page, workerData.bidId);

    // Click "Back to bid" link
    const backLink = page.getByRole('link', { name: /Back to bid/i });
    await expect(backLink).toBeVisible();
    await backLink.click();

    await expect(page).toHaveURL(`/bid/${workerData.bidId}`, {
      timeout: 10000,
    });
  });
});
