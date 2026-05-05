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
      page
        .getByTestId('search-prompt-cards')
        .or(page.getByText(/^\d+ items?$/))
        .first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('test 17: click Q&A library card → ?type=q_a_pair&include_qa=true', async ({
    authenticatedPage: page,
  }) => {
    // F-4 fallback Q&A library or B-2 bid-writing Q&A library — the
    // test account is admin, so it may see any persona. We click the
    // card by title; the click target is rendered via `data-testid` that
    // varies by persona. Query by accessible name instead.
    const qaCard = page.getByRole('button', { name: /^Q&A library$/ }).first();
    await expect(qaCard).toBeVisible();
    await qaCard.click();

    await expect(page).toHaveURL(/type=q_a_pair/);
    await expect(page).toHaveURL(/include_qa=true/);
  });

  test('test 14b (AC-10 reverse): Q&A card → panel checkbox checked → uncheck → URL drops include_qa', async ({
    authenticatedPage: page,
  }) => {
    // (a) Click Q&A card on a fresh /browse → URL carries include_qa=true.
    const qaCard = page.getByRole('button', { name: /^Q&A library$/ }).first();
    await expect(qaCard).toBeVisible();
    await qaCard.click();
    await expect(page).toHaveURL(/include_qa=true/);

    // (b) Open the filter panel via the "Filters" button on the
    // FilterBar — the Advanced "Include Q&A pairs" checkbox must
    // reflect the URL state (`draft.include_qa = true`).
    const filtersBtn = page.getByRole('button', { name: /^Filters/ });
    await expect(filtersBtn).toBeVisible();
    await filtersBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // The Advanced checkbox lives inside the "Q&A Pairs" collapsible
    // section. Hard-assert visibility and expand it (defaultOpen={false}).
    const qaSection = page.getByRole('button', { name: /Q&A Pairs/ });
    await expect(qaSection).toBeVisible();
    await qaSection.click();
    const includeQaCheckbox = page.getByRole('checkbox', {
      name: /Include Q&A pairs/,
    });
    await expect(includeQaCheckbox).toBeVisible();
    await expect(includeQaCheckbox).toBeChecked();

    // (c) Uncheck and apply — URL must drop include_qa.
    await includeQaCheckbox.click();
    await expect(includeQaCheckbox).not.toBeChecked();
    const applyBtn = page.getByRole('button', { name: /Apply filters/ });
    await applyBtn.click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    expect(page.url()).not.toContain('include_qa');
  });

  test('test 18: click a domain chip → ?domain=<slug>', async ({
    authenticatedPage: page,
  }) => {
    // Only the fallback persona renders the chipComposite card. Admin
    // users with no primary_focus land there. Hard-assert visibility so
    // a missing chipComposite (e.g. cleanroom DB without persona seeds)
    // fails honestly rather than silently skipping.
    const chipCard = page.getByTestId('prompt-card-chip-composite');
    await expect(chipCard).toBeVisible();

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
      .getByRole('button', {
        name: new RegExp(`filter to ${displayName}`, 'i'),
      })
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
    // Hard-assert chipComposite visibility — missing fallback persona seeds
    // should fail honestly, not silently skip.
    const chipCard = page.getByTestId('prompt-card-chip-composite');
    await expect(chipCard).toBeVisible();

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

  test('test 19b: outside-click dismisses panel via Escape (keyboard a11y)', async ({
    authenticatedPage: page,
  }) => {
    // Hard-assert chipComposite visibility — missing fallback persona seeds
    // should fail honestly, not silently skip.
    const chipCard = page.getByTestId('prompt-card-chip-composite');
    await expect(chipCard).toBeVisible();

    const moreBtn = chipCard.getByRole('button', {
      name: /open filter panel to choose a different domain/i,
    });
    await moreBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Keyboard-a11y dismiss path. Backdrop-click dismiss is covered
    // separately in test 19c.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // Cards still visible; URL unchanged.
    await expect(page.getByTestId('search-prompt-cards')).toBeVisible();
    const url = page.url();
    expect(url).not.toMatch(/[?&]domain=/);
  });

  test('test 19c (L-A): backdrop click dismisses panel, cards return', async ({
    authenticatedPage: page,
  }) => {
    // Spec §11.4 test 19b mandates a click on the backdrop outside the
    // panel — distinct from the keyboard-Escape path covered in 19b.
    // Radix Sheet's overlay element carries `data-slot="sheet-overlay"`
    // (see `components/ui/sheet.tsx:37`).
    // Hard-assert chipComposite visibility — missing fallback persona seeds
    // should fail honestly, not silently skip.
    const chipCard = page.getByTestId('prompt-card-chip-composite');
    await expect(chipCard).toBeVisible();

    const moreBtn = chipCard.getByRole('button', {
      name: /open filter panel to choose a different domain/i,
    });
    await moreBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Locate the backdrop overlay and click it. The overlay covers the
    // entire viewport; click at (10, 10) so we land OUTSIDE the panel
    // content (which sits to the right by default).
    const overlay = page.locator('[data-slot="sheet-overlay"]');
    await expect(overlay).toBeVisible();
    await overlay.click({ position: { x: 10, y: 10 } });

    // Panel closes; cards re-appear.
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByTestId('search-prompt-cards')).toBeVisible();
    expect(page.url()).not.toMatch(/[?&]domain=/);
  });

  test('test 20: click a SEARCH card → ?q=<exampleQuery>', async ({
    authenticatedPage: page,
  }) => {
    // SEARCH cards exist in bid_writing (Past bid responses), account
    // (Account context + Win themes) and marketing (Sector narratives).
    // Any of them will do. Hard-assert that the union of candidate cards
    // is visible so missing persona seeds fail honestly, then click the
    // first one that resolves.
    const candidateCards = [
      page
        .getByRole('button', { name: /^Win themes and proposals:/i })
        .first(),
      page.getByRole('button', { name: /^Past bid responses:/i }).first(),
      page.getByRole('button', { name: /^Account context:/i }).first(),
      page.getByRole('button', { name: /^Sector narratives:/i }).first(),
    ];
    const anyCard = candidateCards.reduce((acc, locator) => acc.or(locator));
    await expect(anyCard).toBeVisible();
    await anyCard.first().click();

    await expect(page).toHaveURL(/[?&]q=/);
  });

  test('language alignment: "Browse by domain" rendered, not "Browse by sector"', async ({
    authenticatedPage: page,
  }) => {
    // Hard-assert chipComposite visibility — missing fallback persona seeds
    // should fail honestly, not silently skip.
    const chipCard = page.getByTestId('prompt-card-chip-composite');
    await expect(chipCard).toBeVisible();

    await expect(chipCard.getByText('Browse by domain')).toBeVisible();
    // Negative assertion — ensure the pre-rename title is gone.
    await expect(chipCard.getByText('Browse by sector')).toHaveCount(0);
  });
});
