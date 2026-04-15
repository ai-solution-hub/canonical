import { test, expect } from '../fixtures';

/**
 * Flow: SI Prompt Refinement — Review and Refine page
 *
 * Exercises the prompt refinement flow wired up in S158 WP1:
 *   - `RefinementPanel` as the primary interface on the admin-only prompts page
 *   - Advanced disclosure that reveals the legacy PromptEditor
 *   - Happy path: analyse → preview → apply changes → flag count drops
 *
 * The happy path uses Playwright route interception to return canned
 * responses for the three Phase 2 backend endpoints + the create-version
 * endpoint. This avoids the need to seed flags + live LLM calls, and
 * keeps the test deterministic while still exercising the real UI code.
 *
 * Worker-scoped data provides an intelligence workspace
 * (`workerData.intelligenceWorkspaceId`) with a feed source + articles +
 * an active scoring prompt. Flags are NOT seeded by the fixture — the
 * happy-path test mocks the flags endpoint instead.
 */

// ---------------------------------------------------------------------------
// 1. Base navigation — admin sees the refinement panel, version sidebar
// ---------------------------------------------------------------------------

test.describe('Prompt refinement page navigation', () => {
  test('admin loads the prompts page with refinement panel + version sidebar', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(
      `/intelligence/${workerData.intelligenceWorkspaceId}/prompts`,
    );

    await page.waitForLoadState('networkidle', { timeout: 15000 });

    // Refinement panel is the primary interface — either renders the
    // empty-state copy or the flags-pending summary, depending on whether
    // any flags exist for this workspace.
    const refinementPanel = page.getByRole('region', {
      name: /refine filter rules/i,
    });
    await expect(refinementPanel).toBeVisible({ timeout: 10000 });

    // Advanced disclosure button exists and is collapsed by default.
    const advancedToggle = page.getByRole('button', {
      name: /advanced: edit prompt directly/i,
    });
    await expect(advancedToggle).toBeVisible();
    await expect(advancedToggle).toHaveAttribute('aria-expanded', 'false');

    // Version sidebar still present (unchanged from pre-S158).
    await expect(
      page.getByRole('heading', { name: /filter rule history/i }),
    ).toBeVisible({ timeout: 5000 });
  });

  test('advanced disclosure toggles the legacy prompt editor', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(
      `/intelligence/${workerData.intelligenceWorkspaceId}/prompts`,
    );
    await page.waitForLoadState('networkidle', { timeout: 15000 });

    const advancedToggle = page.getByRole('button', {
      name: /advanced: edit prompt directly/i,
    });
    await expect(advancedToggle).toBeVisible({ timeout: 10000 });

    // Editor textarea should NOT be in the DOM while collapsed (conditional render).
    await expect(
      page.locator('#advanced-prompt-editor'),
    ).toHaveCount(0);

    await advancedToggle.click();
    await expect(advancedToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#advanced-prompt-editor')).toBeVisible({
      timeout: 3000,
    });

    // Click again to collapse.
    await advancedToggle.click();
    await expect(advancedToggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('editor role is denied access to the prompts page', async ({
    editorPage,
    workerData,
  }) => {
    await editorPage.goto(
      `/intelligence/${workerData.intelligenceWorkspaceId}/prompts`,
    );
    await editorPage.waitForLoadState('networkidle', { timeout: 15000 });

    // Non-admin sees the access-denied copy — not the refinement panel.
    await expect(
      editorPage.getByText(/don.?t have access to this section/i),
    ).toBeVisible({ timeout: 5000 });

    await expect(
      editorPage.getByRole('region', { name: /prompt refinement/i }),
    ).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Happy path — analyse → preview → apply, with mocked API responses
// ---------------------------------------------------------------------------

test.describe('Prompt refinement happy path (mocked API)', () => {
  test('admin can analyse flags, preview, apply — flag count drops to zero', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    const workspaceId = workerData.intelligenceWorkspaceId;

    // Mutable state tracking across the two `GET /flags` intercept calls.
    // The first call (before apply) returns 3 flags; the second (after
    // apply, triggered by the resolve mutation's invalidation) returns 0.
    let resolveCalled = false;

    // Mock GET flags — returns 3 unresolved flags until resolve fires.
    await page.route(
      `**/api/intelligence/workspaces/${workspaceId}/flags**`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          return route.continue();
        }
        const body = resolveCalled
          ? []
          : [
              {
                id: '550e8400-e29b-41d4-a716-446655440001',
                feed_article_id: '550e8400-e29b-41d4-a716-446655440011',
                flag_type: 'false_positive',
                flagged_by: '550e8400-e29b-41d4-a716-446655440021',
                notes: 'Not actually relevant to our sector',
                resolved: false,
                resolved_at: null,
                resolved_by: null,
                resolved_notes: null,
                resolution_type: null,
                prompt_version_id: null,
                created_at: '2026-04-08T10:00:00.000Z',
                article_title: 'Mocked article one',
                article_external_url: 'https://example.com/a',
                article_relevance_score: 0.72,
                article_relevance_reasoning: 'Contains sector keywords',
                article_relevance_category: 'high',
                article_passed: true,
                source_name: 'Mocked Source',
              },
              {
                id: '550e8400-e29b-41d4-a716-446655440002',
                feed_article_id: '550e8400-e29b-41d4-a716-446655440012',
                flag_type: 'false_positive',
                flagged_by: '550e8400-e29b-41d4-a716-446655440021',
                notes: null,
                resolved: false,
                resolved_at: null,
                resolved_by: null,
                resolved_notes: null,
                resolution_type: null,
                prompt_version_id: null,
                created_at: '2026-04-08T11:00:00.000Z',
                article_title: 'Mocked article two',
                article_external_url: 'https://example.com/b',
                article_relevance_score: 0.65,
                article_relevance_reasoning: 'Adjacent topic match',
                article_relevance_category: 'medium',
                article_passed: true,
                source_name: 'Mocked Source',
              },
              {
                id: '550e8400-e29b-41d4-a716-446655440003',
                feed_article_id: '550e8400-e29b-41d4-a716-446655440013',
                flag_type: 'false_negative',
                flagged_by: '550e8400-e29b-41d4-a716-446655440021',
                notes: 'Should have passed',
                resolved: false,
                resolved_at: null,
                resolved_by: null,
                resolved_notes: null,
                resolution_type: null,
                prompt_version_id: null,
                created_at: '2026-04-08T12:00:00.000Z',
                article_title: 'Mocked article three',
                article_external_url: 'https://example.com/c',
                article_relevance_score: 0.35,
                article_relevance_reasoning: 'Keyword density low',
                article_relevance_category: 'low',
                article_passed: false,
                source_name: 'Mocked Source',
              },
            ];
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(body),
        });
      },
    );

    // Mock POST flags/analyse — returns a canned FlagAnalysisResult.
    await page.route(
      `**/api/intelligence/workspaces/${workspaceId}/flags/analyse`,
      async (route) => {
        if (route.request().method() !== 'POST') {
          return route.continue();
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            summary:
              'Three flags analysed. Two false positives share a common pattern around adjacent topics; one false negative indicates an under-weighting of a specific keyword set.',
            falsePositivePatterns: [
              {
                pattern: 'Adjacent-sector articles over-scoring',
                articleCount: 2,
                articles: ['Mocked article one', 'Mocked article two'],
                rootCause:
                  'Prompt treats keyword frequency as a proxy for relevance without a sector gate.',
              },
            ],
            falseNegativePatterns: [
              {
                pattern: 'Under-weighted niche keywords',
                articleCount: 1,
                articles: ['Mocked article three'],
                rootCause:
                  'Specialist terminology is not in the current keyword list.',
              },
            ],
            recommendations: [
              {
                type: 'add',
                section: 'Relevance criteria',
                currentText: null,
                proposedText:
                  'Articles must match at least one primary sector keyword in the title or first paragraph.',
                reasoning:
                  'Addresses the adjacent-sector false positive pattern.',
                affectedFlags: 2,
              },
              {
                type: 'add',
                section: 'Keyword list',
                currentText: null,
                proposedText: 'Include niche terminology X, Y, Z.',
                reasoning: 'Addresses the under-weighted keywords gap.',
                affectedFlags: 1,
              },
            ],
            proposedPromptText:
              'Updated scoring prompt with a sector gate and an expanded keyword list. (Mocked for the E2E test.)',
            confidenceNotes:
              'Small sample — verify with the re-scoring preview before applying.',
            analysedFlagCount: 3,
            truncated: false,
          }),
        });
      },
    );

    // Mock POST prompts/preview — returns a canned RescoringPreviewResponse.
    await page.route(
      `**/api/intelligence/workspaces/${workspaceId}/prompts/preview`,
      async (route) => {
        if (route.request().method() !== 'POST') {
          return route.continue();
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            samples: 3,
            mean_delta: -0.05,
            improved: 1,
            regressed: 2,
            results: [
              {
                article_id: '550e8400-e29b-41d4-a716-446655440011',
                title: 'Mocked article one',
                existing_score: 0.72,
                candidate_score: 0.35,
                score_delta: -0.37,
              },
              {
                article_id: '550e8400-e29b-41d4-a716-446655440012',
                title: 'Mocked article two',
                existing_score: 0.65,
                candidate_score: 0.4,
                score_delta: -0.25,
              },
              {
                article_id: '550e8400-e29b-41d4-a716-446655440013',
                title: 'Mocked article three',
                existing_score: 0.35,
                candidate_score: 0.7,
                score_delta: 0.35,
              },
            ],
          }),
        });
      },
    );

    // Mock POST prompts (create-version) — returns a fake new prompt row.
    await page.route(
      `**/api/intelligence/workspaces/${workspaceId}/prompts`,
      async (route) => {
        if (route.request().method() !== 'POST') {
          return route.continue();
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: '550e8400-e29b-41d4-a716-446655440099',
            workspace_id: workspaceId,
            version: 999,
            prompt_text:
              'Updated scoring prompt with a sector gate and an expanded keyword list. (Mocked for the E2E test.)',
            is_active: true,
            performance_snapshot: null,
            change_notes: 'Refinement from 3 flags',
            created_at: '2026-04-09T14:00:00.000Z',
            created_by: '550e8400-e29b-41d4-a716-446655440021',
          }),
        });
      },
    );

    // Mock POST flags/resolve — flip `resolveCalled` so subsequent GETs
    // return an empty list (simulating the DB state after the bulk update).
    await page.route(
      `**/api/intelligence/workspaces/${workspaceId}/flags/resolve`,
      async (route) => {
        if (route.request().method() !== 'POST') {
          return route.continue();
        }
        resolveCalled = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            resolved_count: 3,
            requested_count: 3,
          }),
        });
      },
    );

    // Navigate to the prompts page.
    await page.goto(
      `/intelligence/${workspaceId}/prompts`,
    );
    await page.waitForLoadState('networkidle', { timeout: 15000 });

    // Wait for the refinement panel header — the page is ready.
    await expect(
      page.getByRole('region', { name: /prompt refinement/i }),
    ).toBeVisible({ timeout: 10000 });

    // 3 unresolved flags should be summarised (pluralised UK English).
    await expect(
      page.getByText(/3 unresolved flags/i),
    ).toBeVisible({ timeout: 10000 });

    // Click "Analyse flags".
    const analyseButton = page.getByRole('button', {
      name: /analyse unresolved flags/i,
    });
    await expect(analyseButton).toBeEnabled();
    await analyseButton.click();

    // Analysis view renders the summary text from the mock.
    await expect(
      page.getByText(/Three flags analysed/i),
    ).toBeVisible({ timeout: 10000 });

    // Click "Preview impact".
    const previewButton = page.getByRole('button', {
      name: /preview the impact/i,
    });
    await previewButton.click();

    // Rescoring preview renders the sample count from the mock.
    await expect(
      page.getByText(/3 articles re-scored/i),
    ).toBeVisible({ timeout: 10000 });

    // Click "Apply changes".
    const applyButton = page.getByRole('button', {
      name: /apply proposed changes/i,
    });
    await applyButton.click();

    // After apply completes, the panel resets to the empty state because
    // the mocked GET /flags now returns [].
    await expect(
      page.getByText(/no unresolved flags/i),
    ).toBeVisible({ timeout: 15000 });
  });
});
