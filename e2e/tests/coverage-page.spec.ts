import { test, expect } from '../fixtures';
import { attachConsoleGate, type ConsoleGate } from '../helpers/console-gate';

/**
 * Coverage Dashboard tests
 *
 * ID-131.19 fix-Executor escalation 2 (DR-034, owner ruling): the
 * content_items-era coverage feature (taxonomy heatmap, priority gaps,
 * guides tabs + their backing RPCs `get_coverage_matrix`/
 * `get_coverage_summary`) has been retired. `/coverage` no longer hosts a
 * tab shell — it renders the single surviving template-completion view
 * directly. The tab-switching/deep-link/taxonomy-heatmap assertions that
 * lived here retired with that surface; only the page-shell smoke check
 * remains. Template-coverage-specific e2e coverage (if any) belongs to the
 * `template-coverage-content` surface, not this file.
 *
 * The tests deliberately use accessible role + name selectors so they survive
 * cosmetic refactors. No `data-testid` reliance, no conditional fallbacks.
 */

test.describe('Coverage page', { tag: '@smoke' }, () => {
  // bl-336: opt-in browser-error gate — fail on uncaught exceptions and
  // console.error/warning, with only the [branding] contrast warn allowlisted.
  let gate: ConsoleGate;
  test.beforeEach(({ authenticatedPage }) => {
    gate = attachConsoleGate(authenticatedPage);
  });
  test.afterEach(() => {
    gate.assertNoConsoleViolations();
  });

  // ---------------------------------------------------------------------------
  // 1. Page loads with header + subtitle
  // ---------------------------------------------------------------------------

  test('loads at /coverage with heading and subtitle', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/coverage');

    await expect(
      page.getByRole('heading', { name: 'Coverage Dashboard' }),
    ).toBeVisible();
    await expect(
      page.getByText('Measure knowledge base completeness'),
    ).toBeVisible();
  });
});
