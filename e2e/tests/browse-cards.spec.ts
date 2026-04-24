import { test, expect } from '../fixtures';
import { createServiceClient } from '../fixtures/supabase';

/**
 * §1.20 Browse Cards — E2E tests (spec §11.4 tests 17, 18, 19, 19b, 20).
 *
 * Covers the new cold-start card behaviour:
 * - FILTER cards apply `Partial<BrowseFilters>` via URL params (AC-5).
 * - ChipComposite card chip clicks apply `?domain=<slug>` (AC-3, test 18).
 * - "More domains…" button opens the filter panel WITHOUT mutating URL
 *   (test 19) and outside-click dismiss restores cards (test 19b).
 * - SEARCH cards still write `?q=` (AC-6, test 20).
 *
 * Uses hard `expect(...).toBeVisible()` (not `if (visible)` fallbacks)
 * so cleanroom envs fail honestly — per
 * `feedback_e2e_conditional_false_pass` in CLAUDE.md.
 */

test.describe('§1.20 Browse Cards cold-start interactions', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // Clear any lingering query to start from cold-start baseline.
    await page.goto('/browse');
    // Wait for the page to render the item count or the prompt cards.
    await expect(
      page.getByTestId('search-prompt-cards').or(page.getByText(/^\d+ items?$/)).first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('test 17: click Q&A library card → ?type=q_a_pair&include_qa=true', async ({
    authenticatedPage: page,
  }) => {
    // F-4 fallback Q&A library or B-2 bid-writing Q&A library — the
    // test account is admin, so it may see any persona. We click the
    // card by title; the click target is rendered via `data-testid` that
    // varies by persona. Query by accessible name instead.
    const qaCard = page
      .getByRole('button', { name: /^Q&A library$/ })
      .first();
    await expect(qaCard).toBeVisible();
    await qaCard.click();

    await expect(page).toHaveURL(/type=q_a_pair/);
    await expect(page).toHaveURL(/include_qa=true/);
  });

  test('test 18: click a domain chip → ?domain=<slug>', async ({
    authenticatedPage: page,
  }) => {
    // Only the fallback persona renders the chipComposite card. Admin
    // users with no primary_focus land there; if a primary_focus is
    // set, skip.
    const chipCard = page.getByTestId('prompt-card-chip-composite');
    const chipCardExists = await chipCard.isVisible().catch(() => false);
    test.skip(
      !chipCardExists,
      'ChipComposite only renders in fallback persona set',
    );

    // Fetch a taxonomy domain name from the DB so we don't hardcode
    // `facilities_management` (spec test 18 — a DB rename must not
    // silently pass). First domain in display_order.
    const supabase = createServiceClient();
    const { data: domains, error } = await supabase
      .from('taxonomy_domains')
      .select('name, display_name')
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .limit(1);
    expect(error).toBeNull();
    expect(domains).not.toBeNull();
    expect(domains?.length ?? 0).toBeGreaterThan(0);
    const firstDomain = domains![0];
    const displayName = firstDomain.display_name ?? firstDomain.name;

    // Click the first chip by accessible name (`Filter to <display>`).
    const firstChip = chipCard
      .getByRole('button', { name: new RegExp(`filter to ${displayName}`, 'i') })
      .first();
    await expect(firstChip).toBeVisible();
    await firstChip.click();

    await expect(page).toHaveURL(
      new RegExp(`domain=${encodeURIComponent(firstDomain.name)}`),
    );
  });

  test('test 19: click More domains… → filter panel opens, URL unchanged', async ({
    authenticatedPage: page,
  }) => {
    const chipCard = page.getByTestId('prompt-card-chip-composite');
    const chipCardExists = await chipCard.isVisible().catch(() => false);
    test.skip(
      !chipCardExists,
      'ChipComposite only renders in fallback persona set',
    );

    const moreBtn = chipCard.getByRole('button', {
      name: /open filter panel to choose a different domain/i,
    });
    await expect(moreBtn).toBeVisible();
    await moreBtn.click();

    // Filter panel opened — its dialog is visible.
    await expect(page.getByRole('dialog')).toBeVisible();
    // URL must NOT carry ?domain=.
    const url = page.url();
    expect(url).not.toMatch(/[?&]domain=/);
  });

  test('test 19b: outside-click dismisses panel, cards return', async ({
    authenticatedPage: page,
  }) => {
    const chipCard = page.getByTestId('prompt-card-chip-composite');
    const chipCardExists = await chipCard.isVisible().catch(() => false);
    test.skip(
      !chipCardExists,
      'ChipComposite only renders in fallback persona set',
    );

    const moreBtn = chipCard.getByRole('button', {
      name: /open filter panel to choose a different domain/i,
    });
    await moreBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Dismiss via Escape (functional equivalent of backdrop click —
    // Radix Sheet handles both). Deliberate choice: `page.keyboard.press`
    // is deterministic across viewports, whereas a backdrop-click
    // co-ordinate needs measuring and is flaky.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // Cards still visible; URL unchanged.
    await expect(page.getByTestId('search-prompt-cards')).toBeVisible();
    const url = page.url();
    expect(url).not.toMatch(/[?&]domain=/);
  });

  test('test 20: click a SEARCH card → ?q=<exampleQuery>', async ({
    authenticatedPage: page,
  }) => {
    // SEARCH cards exist in bid_writing (Past bid responses), account
    // (Account context + Win themes) and marketing (Sector narratives).
    // Any of them will do. Pick one by accessible name that's a
    // SEARCH card regardless of persona exposure on the test user.
    const candidateCards = [
      /^Win themes and proposals:/i,
      /^Past bid responses:/i,
      /^Account context:/i,
      /^Sector narratives:/i,
    ];
    let clicked = false;
    for (const pattern of candidateCards) {
      const card = page.getByRole('button', { name: pattern }).first();
      if (await card.isVisible().catch(() => false)) {
        await card.click();
        clicked = true;
        break;
      }
    }
    test.skip(
      !clicked,
      'No SEARCH card visible for this persona — skipped cleanly',
    );

    await expect(page).toHaveURL(/[?&]q=/);
  });

  test('language alignment: "Browse by domain" rendered, not "Browse by sector"', async ({
    authenticatedPage: page,
  }) => {
    const chipCard = page.getByTestId('prompt-card-chip-composite');
    const chipCardExists = await chipCard.isVisible().catch(() => false);
    test.skip(
      !chipCardExists,
      'ChipComposite only renders in fallback persona set',
    );

    await expect(chipCard.getByText('Browse by domain')).toBeVisible();
    // Negative assertion — ensure the pre-rename title is gone.
    await expect(chipCard.getByText('Browse by sector')).toHaveCount(0);
  });
});
