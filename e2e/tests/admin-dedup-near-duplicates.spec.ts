/**
 * §1.9 Admin Near-Duplicate Merge Dashboard — read-only E2E spec (S214B WP2).
 *
 * Covers acceptance criteria from
 * `docs/specs/§1.9-near-dup-merge-dashboard-spec.md` §9:
 *   - AC1 — pairs above threshold listed with DD/MM/YYYY-rendered
 *           timestamps and similarity score
 *   - AC2 — threshold slider triggers debounced (300ms) re-fetch; row
 *           count updates
 *   - AC3 — domain filter narrows pairs to those where both members
 *           share `primary_domain`
 *   - AC4 — detail view shows side-by-side compare with title, body,
 *           created_at, source, domain, content_type,
 *           publication_status badge, and length-in-chars; similarity
 *           score visible in header
 *
 * Mutating actions (Merge / Confirm both unique / Defer) are deferred
 * to WP3 — this spec is read-only and MUST NOT click any of those
 * buttons.
 *
 * Worker fixture: `adminDedupFixture` from
 * `e2e/fixtures/admin-dedup-fixture.ts` seeds 7 §1.9 near-dup pairs at
 * controlled cosine similarities (0.86 / 0.90 / 0.97 across DOMAIN_X +
 * DOMAIN_Y) plus 6 §1.7 queue pairs. See
 * `admin-dedup-fixture-helpers.ts` `AdminDedupFixtureData.nearDup` for
 * the typed accessors.
 *
 * Memory references:
 *   - `feedback_e2e_no_workarounds`: real fixtures + hard expects only.
 *   - `feedback_e2e_conditional_false_pass`: NO `if (await x.isVisible()...)`
 *     fallbacks — every assertion is a hard expect.
 *   - `feedback_brief_quote_spec_verbatim`: AC text quoted verbatim from
 *     §1.9 spec §9.
 */
import { mergeTests, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { test as authTest } from '../fixtures';
import { test as adminDedupTest } from '../fixtures/admin-dedup-fixture';

const test = mergeTests(authTest, adminDedupTest);

// Fixture domain X — matches DOMAIN_X in admin-dedup-fixture-helpers.ts.
// (DOMAIN_Y / "Technical Capability" is implicit via the highSimDomainY
// pair fixture but only DOMAIN_X is named in assertions — see AC3.)
const DOMAIN_X = 'Service Delivery';

// DD/MM/YYYY date format (lib/format::formatDateUK).
// Substring regex — used in `toContainText` against the card metadata
// block that bundles Created/Source/Domain/Type/Length/Status into one
// text node.
const DD_MM_YYYY_SUBSTRING = /\d{2}\/\d{2}\/\d{4}/;

// The list URL the slider re-fetch hits.
const PAIRS_LIST_URL = '/api/admin/content-dedup/near-duplicates';

/**
 * Move the threshold slider to a target value via keyboard arrows on the
 * native `<input type="range">`. Native range inputs respond to ArrowLeft
 * / ArrowRight per browser default; this avoids fragile drag interactions
 * while still triggering the underlying onChange + 300ms debounce path.
 */
async function setThresholdSlider(page: Page, target: number): Promise<void> {
  // Scope locators to the filter bar's <div role="toolbar"
  // aria-label="Near-duplicate filters"> so we don't trip Playwright's
  // strict-mode rule when Next.js dev / Turbopack briefly mounts a
  // second copy during a `key={threshold}` remount cycle.
  const toolbar = page.getByRole('toolbar', {
    name: /Near-duplicate filters/i,
  });
  const slider = toolbar.getByTestId('near-dup-threshold-slider');
  await expect(slider).toBeVisible();
  await slider.focus();

  // Read current threshold from the rendered label, then arrow toward
  // the target. step=0.01 per the filter-bar component.
  const valueLabel = toolbar.getByTestId('near-dup-threshold-value');
  const currentText = await valueLabel.textContent();
  const current = Number.parseFloat(currentText ?? '0.95');
  const targetRounded = Math.round(target * 100) / 100;
  const currentRounded = Math.round(current * 100) / 100;
  const diff = Math.round((targetRounded - currentRounded) * 100);
  if (diff === 0) return;

  const key = diff > 0 ? 'ArrowRight' : 'ArrowLeft';
  for (let i = 0; i < Math.abs(diff); i++) {
    await page.keyboard.press(key);
  }
}

test.describe('Admin Near-Duplicate Dashboard — §1.9 read-only', () => {
  // Each spec needs the worker fixture to be ready (~26 rows seeded) and
  // cleaned up on teardown.
  test.setTimeout(120_000);

  // ─────────────────────────────────────────────────────────────────────
  // AC1 — Pairs above threshold listed.
  //
  // The fixture seeds 5 high-similarity (~0.97) pairs in DOMAIN_X
  // (highSimDomainX, mergeTarget, confirmUnique near-dup) plus 2 in
  // DOMAIN_Y (highSimDomainY) — but the dashboard route filters out
  // pairs where either member is `suspected_duplicate` (overlapWith17
  // has one such side). So at the default threshold 0.95, the dashboard
  // MUST surface mergeTarget and the other ~0.97 pairs that don't
  // overlap with §1.7. The exact total is staging-dependent (other rows
  // may exist) — we hard-assert that fixture-known pairs are visible
  // and the count badge shows ≥ 1.
  // ─────────────────────────────────────────────────────────────────────
  test('AC1 — dashboard lists pairs above default threshold (0.95)', async ({
    authenticatedPage: page,
    adminDedupFixture,
  }) => {
    await page.goto('/admin/content-dedup/near-duplicates');

    await expect(
      page.getByRole('heading', { name: /Near-Duplicate Review/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Filter bar threshold value defaults to 0.95. Use `.first()` to
    // tolerate Next.js dev's transient double-render during server-
    // component hydration (the testid appears on hydrated + dev-overlay
    // copies briefly).
    await expect(
      page.getByTestId('near-dup-threshold-value').first(),
    ).toHaveText('0.95');

    // mergeTarget pair is a SIM_HIGH (~0.97) DOMAIN_X pair with both
    // sides 'clean' — MUST appear at the default 0.95 threshold.
    const mergeTargetRow = page.getByTestId(
      `near-dup-pair-row-${adminDedupFixture.nearDup.mergeTarget.pairId}`,
    );
    await expect(mergeTargetRow).toBeVisible();

    // confirmUnique pair (also SIM_HIGH DOMAIN_X, both clean) is
    // visible too — guards against accidental row exclusion.
    await expect(
      page.getByTestId(
        `near-dup-pair-row-${adminDedupFixture.nearDup.confirmUnique.pairId}`,
      ),
    ).toBeVisible();

    // highSimDomainY pair (SIM_HIGH DOMAIN_Y, both clean) — also visible
    // because no domain filter is applied yet.
    await expect(
      page.getByTestId(
        `near-dup-pair-row-${adminDedupFixture.nearDup.highSimDomainY.pairId}`,
      ),
    ).toBeVisible();

    // Resolve link on mergeTarget row points to the pair detail route.
    const resolveLink = page.getByTestId(
      `near-dup-pair-resolve-${adminDedupFixture.nearDup.mergeTarget.pairId}`,
    );
    await expect(resolveLink).toBeVisible();
    const href = await resolveLink.getAttribute('href');
    expect(href).toContain(
      `/admin/content-dedup/near-duplicates/${adminDedupFixture.nearDup.mergeTarget.pairId}`,
    );
    expect(href).toContain('threshold=0.95');

    // Pair-count aria-live region announces the visible count in the
    // form "<n> candidate pairs ≥ 0.95". n is staging-dependent so we
    // assert ≥ 1 via numeric extraction. `.first()` per the same
    // dev-mode double-render note above.
    const countLabel = page.getByTestId('near-dup-pair-count').first();
    await expect(countLabel).toBeVisible();
    const countText = (await countLabel.textContent()) ?? '';
    const match = countText.match(/(\d+)\s+candidate pair/);
    expect(match).not.toBeNull();
    const visibleCount = Number.parseInt(match![1], 10);
    expect(visibleCount).toBeGreaterThanOrEqual(1);
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC2 — Threshold slider re-fetches.
  //
  // Move slider from default 0.95 → 0.86 (below the fixture's lowSim
  // tier of 0.86). This MUST trigger a debounced re-fetch (300ms) and
  // the row count MUST update. Use waitForResponse on the
  // /api/admin/content-dedup/near-duplicates route — never
  // waitForTimeout — per `feedback_brief_quote_spec_verbatim`.
  //
  // After the re-fetch, lowSimDomainX (~0.86) MUST be visible at
  // threshold ≤ 0.86 (it was hidden at 0.95).
  // ─────────────────────────────────────────────────────────────────────
  test('AC2 — moving the threshold slider triggers a debounced re-fetch', async ({
    authenticatedPage: page,
    adminDedupFixture,
  }) => {
    await page.goto('/admin/content-dedup/near-duplicates');
    await expect(
      page.getByRole('heading', { name: /Near-Duplicate Review/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Capture initial row count. lowSimDomainX (~0.86) MUST be hidden
    // at the default 0.95 threshold per the fixture's similarity tiers.
    const lowSimRow = page.getByTestId(
      `near-dup-pair-row-${adminDedupFixture.nearDup.lowSimDomainX.pairId}`,
    );
    await expect(lowSimRow).not.toBeVisible();

    const initialCountText =
      (await page.getByTestId('near-dup-pair-count').first().textContent()) ??
      '';
    const initialMatch = initialCountText.match(/(\d+)\s+candidate pair/);
    expect(initialMatch).not.toBeNull();
    const initialCount = Number.parseInt(initialMatch![1], 10);

    // Move slider down to 0.85 (the floor). The fixture's lowSimDomainX
    // pair targets ±0.005 of SIM_LOW=0.86, so it lands somewhere in
    // [0.855, 0.865] in pgvector roundtrip. Setting the threshold to
    // 0.85 (≤ 0.855) guarantees the pair surfaces regardless of which
    // side of 0.86 it lands. The 300ms debounce + commit cycle
    // re-queries the list endpoint.
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(PAIRS_LIST_URL) &&
        resp.url().includes('threshold=0.85') &&
        resp.request().method() === 'GET',
      { timeout: 15_000 },
    );

    await setThresholdSlider(page, 0.85);

    const resp = await responsePromise;
    expect(resp.status()).toBe(200);

    // Threshold label updated to 0.85.
    await expect(
      page.getByTestId('near-dup-threshold-value').first(),
    ).toHaveText('0.85');

    // After re-fetch, lowSimDomainX surfaces (similarity ≈ 0.86 ≥ 0.85).
    await expect(lowSimRow).toBeVisible({ timeout: 15_000 });

    // Row count INCREASED relative to the 0.95 threshold (we lowered
    // the cut-off — strictly more pairs).
    const newCountText =
      (await page.getByTestId('near-dup-pair-count').first().textContent()) ??
      '';
    const newMatch = newCountText.match(/(\d+)\s+candidate pair/);
    expect(newMatch).not.toBeNull();
    const newCount = Number.parseInt(newMatch![1], 10);
    expect(newCount).toBeGreaterThan(initialCount);
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC3 — Domain filter applies.
  //
  // Select domain X (Service Delivery). After the filter applies, the
  // highSimDomainY pair (whose members live in domain Y "Technical
  // Capability") MUST NOT be visible — the route's RPC `p_domain` arg
  // narrows pairs to those whose members both share the chosen domain.
  // ─────────────────────────────────────────────────────────────────────
  test('AC3 — domain filter hides cross-domain pairs', async ({
    authenticatedPage: page,
    adminDedupFixture,
  }) => {
    await page.goto('/admin/content-dedup/near-duplicates');
    await expect(
      page.getByRole('heading', { name: /Near-Duplicate Review/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Pre-filter — both fixture pairs visible at default 0.95.
    const domainYRow = page.getByTestId(
      `near-dup-pair-row-${adminDedupFixture.nearDup.highSimDomainY.pairId}`,
    );
    const mergeTargetRow = page.getByTestId(
      `near-dup-pair-row-${adminDedupFixture.nearDup.mergeTarget.pairId}`,
    );
    await expect(domainYRow).toBeVisible();
    await expect(mergeTargetRow).toBeVisible();

    // Open the Radix Select domain filter. Aria-label is "Filter by
    // domain" per the filter-bar component.
    const domainFilter = page.getByRole('combobox', {
      name: /Filter by domain/i,
    });
    await expect(domainFilter).toBeVisible();

    // Wait for the response to the filter change so we don't race
    // against the debounce/network roundtrip. URLSearchParams encodes
    // spaces as `+`, not `%20`, so use a permissive check on the URL.
    const responsePromise = page.waitForResponse(
      (resp) => {
        if (resp.request().method() !== 'GET') return false;
        const url = resp.url();
        if (!url.includes(PAIRS_LIST_URL)) return false;
        const decoded = decodeURIComponent(url.replace(/\+/g, ' '));
        return decoded.includes(`domain=${DOMAIN_X}`);
      },
      { timeout: 15_000 },
    );

    await domainFilter.click();
    await page
      .getByRole('option', { name: new RegExp(`^${DOMAIN_X}$`, 'i') })
      .first()
      .click();

    const resp = await responsePromise;
    expect(resp.status()).toBe(200);

    // Trigger now displays the chosen domain.
    await expect(domainFilter).toContainText(DOMAIN_X);

    // mergeTarget (DOMAIN_X) remains; highSimDomainY (DOMAIN_Y) MUST be
    // hidden by the domain filter.
    await expect(mergeTargetRow).toBeVisible();
    await expect(domainYRow).not.toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC4 — Detail view shows side-by-side.
  //
  // Navigate via Resolve → on the mergeTarget pair. Assert both rows
  // render side-by-side with title, body, created_at, source, domain,
  // content_type, publication_status badge, and length-in-chars.
  // Similarity score visible in the header.
  // ─────────────────────────────────────────────────────────────────────
  test('AC4 — detail view renders left and right rows side-by-side', async ({
    authenticatedPage: page,
    adminDedupFixture,
  }) => {
    const { pairId } = adminDedupFixture.nearDup.mergeTarget;
    await page.goto(`/admin/content-dedup/near-duplicates/${pairId}`);

    // Page heading + similarity badge appear once the detail query
    // resolves.
    await expect(
      page.getByRole('heading', { name: /Resolve near-duplicate pair/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Similarity badge — fixture's mergeTarget targets ~0.97, with
    // tolerance ±0.005. Match either 0.96x or 0.97x (3 decimal places).
    await expect(page.getByText(/Similarity:\s*0\.9[67]\d/i)).toBeVisible();

    // Both side label badges visible.
    await expect(page.getByTestId('near-dup-row-card-label-left')).toBeVisible();
    await expect(
      page.getByTestId('near-dup-row-card-label-right'),
    ).toBeVisible();

    // Card aria-labels — Card sets aria-label="Left" / "Right".
    // .first() per Next.js dev double-render note above (server-component
    // hydration briefly mounts a duplicate Card during transition).
    const leftCard = page.getByLabel(/^Left$/).first();
    const rightCard = page.getByLabel(/^Right$/).first();
    await expect(leftCard).toBeVisible();
    await expect(rightCard).toBeVisible();

    // Each card surfaces title, the metadata rows (Created/Source/
    // Domain/Type/Length/Status), and the scrollable content body.
    // The fixture's mergeTarget content seed is "Near-dup merge target
    // — admin will merge this pair." Both sides share the seed string
    // (suffixed " (left, run=...)" / " (right, run=...)" in the
    // helpers).
    await expect(leftCard).toContainText(/Near-dup merge target/i);
    await expect(rightCard).toContainText(/Near-dup merge target/i);

    // Metadata rows — assert each label is visible per side.
    for (const label of [
      /Created:/i,
      /Source:/i,
      /Domain:/i,
      /Type:/i,
      /Length:/i,
      /Status:/i,
    ]) {
      await expect(leftCard).toContainText(label);
      await expect(rightCard).toContainText(label);
    }

    // Created-at value rendered DD/MM/YYYY in BOTH cards.
    await expect(leftCard).toContainText(DD_MM_YYYY_SUBSTRING);
    await expect(rightCard).toContainText(DD_MM_YYYY_SUBSTRING);

    // Length-in-chars assertion — both rows seed content via a JS
    // string, so chars > 0; the card formats as "<n> chars".
    await expect(leftCard).toContainText(/\d+\s+chars/);
    await expect(rightCard).toContainText(/\d+\s+chars/);

    // Body content regions present (role="region", aria-label
    // "<Left|Right> content body").
    await expect(
      page.getByRole('region', { name: /Left content body/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: /Right content body/i }),
    ).toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────────────
  // §1.9 AC9 — Admin RBAC (matches §1.7 AC8 pattern).
  //
  // The §1.9 spec §9 AC9 says "the dashboard page itself denies non-admins
  // per page-level handler". The current implementation
  // (app/admin/content-dedup/near-duplicates/page.tsx) redirects
  // non-admins to `/` (and unauthenticated to `/login`) — same shape as
  // §1.7. Verified for completeness even though the brief calls out
  // ACs 1-4; including this guards against silent middleware regression
  // on the §1.9 surface.
  // ─────────────────────────────────────────────────────────────────────
  test('§1.9 AC9 — admin sees dashboard; editor + viewer redirected', async ({
    authenticatedPage: adminPage,
    editorPage,
    viewerPage,
  }) => {
    // Admin: dashboard heading visible.
    await adminPage.goto('/admin/content-dedup/near-duplicates');
    await expect(
      adminPage.getByRole('heading', { name: /Near-Duplicate Review/i }),
    ).toBeVisible({ timeout: 15_000 });
    expect(adminPage.url()).toContain('/admin/content-dedup/near-duplicates');

    // Editor: redirected away.
    await editorPage.goto('/admin/content-dedup/near-duplicates');
    await editorPage.waitForURL((url) => !url.pathname.startsWith('/admin/'), {
      timeout: 15_000,
    });
    expect(editorPage.url()).not.toContain('/admin/content-dedup');
    await expect(
      editorPage.getByRole('heading', { name: /Near-Duplicate Review/i }),
    ).not.toBeVisible();

    // Viewer: redirected away.
    await viewerPage.goto('/admin/content-dedup/near-duplicates');
    await viewerPage.waitForURL((url) => !url.pathname.startsWith('/admin/'), {
      timeout: 15_000,
    });
    expect(viewerPage.url()).not.toContain('/admin/content-dedup');
    await expect(
      viewerPage.getByRole('heading', { name: /Near-Duplicate Review/i }),
    ).not.toBeVisible();
  });
});
