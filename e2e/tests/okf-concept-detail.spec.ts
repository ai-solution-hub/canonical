import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { attachConsoleGate, type ConsoleGate } from '../helpers/console-gate';
import { isMobileViewport } from '../helpers/responsive';

/**
 * Flow: the OKF bundle viewer's ConceptDetail **provenance surface** (id-439).
 *
 * The first OKF coverage in the browser suite. Everything below runs against a
 * REAL regenerated v0.2 bundle on disk — `e2e/fixtures/okf-bundle-root/`, whose
 * concepts are byte-verbatim copies of the closing id-426/id-448 producer run
 * (see that root's README.md). `playwright.config.ts` points the server's
 * `OKF_BUNDLE_ROOT` at it; `E2E_OKF_BUNDLE_ROOT` + `E2E_OKF_BUNDLE_ID` re-point
 * the same spec at a full bundle tree without editing anything here.
 *
 * What the component tier (`__tests__/components/okf/concept-detail.test.tsx`,
 * 21 tests) already proves is that the component renders a `sources[]` array
 * handed to it as props. What only a browser pass can prove, and what these
 * tests are here for, is the whole lane end to end:
 *
 *   bundle files on disk -> `buildBundleGraph` -> the authed graph route ->
 *   TanStack Query -> nav click -> ConceptDetail -> the lazy `canonical://`
 *   resource route -> a real row in the Platform staging database.
 *
 * Four claims, one per test:
 *
 * 1. A v0.2 concept's `sources[]` entries render as the Sources row (the F2-B
 *    rework — provenance moved out of the single top-level `resource:`).
 * 2. A `canonical://` entry resolves through the secondary resource lane, and
 *    ONLY after a click (the lane is gated, never part of the graph load).
 * 3. A bundle-path entry is a concept citation: it navigates in-app, and the
 *    cited concept's "Cited by" shows the citation — for `company/overview`
 *    that backlink can ONLY come from `sources[]`, since the v0.2 producer
 *    dropped the `# Citations` trailer (F1-A) and neither citing concept links
 *    it from its body.
 * 4. A legacy v0.1 concept in the SAME bundle still renders — the §11 tolerance
 *    duty ("consumers MUST NOT reject a bundle for missing optional
 *    frontmatter fields"). The run that regenerated this bundle left 11 v0.1
 *    concepts in place where the augmentation guard refused to rewrite them, so
 *    a mixed-generation bundle is the normal case, not a contrived one.
 *
 * Desktop-only: `<BundleViewer>` is a fixed three-region grid
 * (`grid-cols-[260px_1fr_400px]`) with no responsive treatment, so the mobile
 * project skips these rather than asserting against a layout the app does not
 * claim to support (the `bid-export.spec.ts` precedent).
 */

/** The bundle directory under the configured root — one path segment. */
const BUNDLE_ID = process.env.E2E_OKF_BUNDLE_ID?.trim() || 'okf-v02-e2e';

/**
 * Failure hint for the one environmental trap: `webServer.reuseExistingServer`
 * means a dev server ALREADY up on the port is reused as-is, so the config's
 * `OKF_BUNDLE_ROOT` never reaches it and the graph route 500s against whatever
 * that server was started with.
 */
const BUNDLE_HINT =
  `The OKF viewer could not load bundle "${BUNDLE_ID}". The server under test must have ` +
  `OKF_BUNDLE_ROOT pointing at a parent directory that CONTAINS it — playwright.config.ts ` +
  `sets that for servers IT starts, but reuses an already-running dev server as-is. Stop any ` +
  `dev server on the test port (or set E2E_OKF_BUNDLE_ROOT/E2E_OKF_BUNDLE_ID at a real bundle).`;

async function openBundleViewer(page: Page) {
  await page.goto(`/okf/${BUNDLE_ID}`);
  await expect(page.getByTestId('bundle-viewer'), BUNDLE_HINT).toBeVisible({
    timeout: 20000,
  });
  // Nothing is selected yet — the detail pane is its empty state until a nav
  // row is clicked.
  await expect(page.getByTestId('concept-detail-empty')).toBeVisible();
}

/**
 * Click a concept row in the nav rail. Themes are collapsed by default (the
 * three-level progressive disclosure), so the theme heading is expanded first.
 */
async function selectConcept(page: Page, title: RegExp) {
  const nav = page.getByTestId('bundle-nav');
  const theme = nav.getByRole('button', { name: 'Concepts' });
  await expect(theme).toBeVisible();
  if ((await theme.getAttribute('aria-expanded')) !== 'true') {
    await theme.click();
  }
  await nav.getByRole('button', { name: title }).click();
}

test.describe('OKF ConceptDetail — v0.2 sources[] provenance', () => {
  // bl-336: opt-in browser-error gate (see e2e/helpers/console-gate.ts). It is
  // load-bearing for the §11 test — "renders without error" means the browser
  // console agrees, not just that a heading appeared.
  let gate: ConsoleGate;

  test.beforeEach(({ authenticatedPage }) => {
    // Attach BEFORE the skip: `test.skip()` aborts the rest of this hook, and
    // `afterEach` still runs — an unattached gate would throw there instead of
    // reporting the skip.
    gate = attachConsoleGate(authenticatedPage);
    test.skip(
      isMobileViewport(authenticatedPage),
      'Desktop-only surface: the OKF bundle viewer is a fixed three-region grid.',
    );
  });

  test.afterEach(() => {
    gate.assertNoConsoleViolations();
  });

  test('renders a v0.2 concept’s sources[] entries as the Sources row', async ({
    authenticatedPage: page,
  }) => {
    await openBundleViewer(page);
    await selectConcept(page, /^Data Protection —/);

    const detail = page.getByTestId('concept-detail');
    await expect(
      detail.getByRole('heading', { level: 1, name: 'Data Protection' }),
    ).toBeVisible();

    // The v0.2 stamp this concept carries instead of the v0.1 `timestamp`.
    const sources = detail.getByTestId('concept-sources');
    await expect(sources).toBeVisible();

    // One row per frontmatter entry, labelled by `title ?? id` — the producer
    // writes footnote-key ids here, and they are what the `[^id]` body
    // footnotes point at.
    await expect(sources.getByRole('listitem')).toHaveCount(4);
    for (const id of [
      'qa-data-protection',
      'topics-quality-management',
      'certifications-iso-27001',
      'company-overview',
    ]) {
      await expect(sources.getByText(id, { exact: true })).toBeVisible();
    }

    // The MIXED entry kinds are the point of the F2-B rework: a `canonical://`
    // pointer sits in the same list as bundle-path concept citations.
    await expect(
      sources.getByRole('button', {
        name: 'canonical://q_a_pairs?scope_tag=data-protection',
      }),
    ).toBeVisible();
    await expect(
      sources.getByRole('button', { name: 'topics-quality-management' }),
    ).toBeVisible();
  });

  test('resolves a canonical:// source through the resource lane, and only on click', async ({
    authenticatedPage: page,
  }) => {
    const resourceRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/okf/resource')) {
        resourceRequests.push(request.url());
      }
    });

    await openBundleViewer(page);
    await selectConcept(page, /^ISO 27001 —/);

    const detail = page.getByTestId('concept-detail');
    await expect(
      detail.getByRole('heading', { level: 1, name: 'ISO 27001' }),
    ).toBeVisible();

    const sources = detail.getByTestId('concept-sources');
    const chip = sources
      .getByRole('button', { name: /^canonical:\/\/source_documents\// })
      .first();
    await expect(chip).toBeVisible();

    // Lazy by construction: the Sources row is rendered and NOTHING has been
    // fetched from api.* yet (TECH-ADDENDUM Reframe B — the graph load never
    // touches the resource lane).
    expect(resourceRequests).toEqual([]);

    const uri = (await chip.textContent())?.trim() ?? '';
    expect(uri).toMatch(/^canonical:\/\/source_documents\/[0-9a-f-]{36}$/);
    const uuid = uri.split('/').pop() as string;

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/okf/resource')),
      chip.click(),
    ]);

    expect(response.url()).toContain(encodeURIComponent(uri));
    expect(response.status()).toBe(200);

    // The resolved row renders — the pointer reached a REAL `source_documents`
    // record in the Platform staging DB the producer run wrote to. A wiped
    // staging DB fails here honestly (404 -> "Could not resolve this
    // resource."), the same posture guide-pages.spec.ts takes to seeded guides.
    await expect(sources.locator('pre')).toContainText(uuid);
  });

  test('links a bundle-path sources[] entry to the cited concept, and the citation shows as a backlink', async ({
    authenticatedPage: page,
  }) => {
    await openBundleViewer(page);
    await selectConcept(page, /^Data Protection —/);

    const detail = page.getByTestId('concept-detail');
    const sources = detail.getByTestId('concept-sources');

    // `/company/overview.md` — cited in `sources[]` and NOT linked from the
    // body, so every edge it participates in is sources[]-derived.
    await sources.getByRole('button', { name: 'company-overview' }).click();

    await expect(
      detail.getByRole('heading', {
        level: 1,
        name: 'Ridgeway Commercial Services Ltd — Company Overview',
      }),
    ).toBeVisible();

    // The `cites` edge typing that F1-A moved off the `# Citations` trailer:
    // this backlink exists because Data Protection lists the concept in
    // `sources[]`, and nowhere else.
    await expect(
      detail.getByRole('heading', { name: 'Cited by' }),
    ).toBeVisible();
    const backlink = detail.getByRole('button', { name: 'Data Protection' });
    await expect(backlink).toBeVisible();

    // And the backlink navigates back — the citation is live in both
    // directions.
    await backlink.click();
    await expect(
      detail.getByRole('heading', { level: 1, name: 'Data Protection' }),
    ).toBeVisible();
  });

  test('renders a legacy v0.1 concept from the same bundle without rejecting it (§11 tolerance)', async ({
    authenticatedPage: page,
  }) => {
    await openBundleViewer(page);

    const nav = page.getByTestId('bundle-nav');
    const theme = nav.getByRole('button', { name: 'Concepts' });
    await expect(theme).toBeVisible();
    if ((await theme.getAttribute('aria-expanded')) !== 'true') {
      await theme.click();
    }

    // BOTH generations are enumerated — the v0.1 concept is not dropped from
    // the bundle listing for lacking `generated`/`sources[]`.
    await expect(
      nav.getByRole('button', { name: /^Data Protection —/ }),
    ).toBeVisible();
    await expect(
      nav.getByRole('button', { name: /^Quality Management —/ }),
    ).toBeVisible();

    await nav.getByRole('button', { name: /^Quality Management —/ }).click();

    const detail = page.getByTestId('concept-detail');
    await expect(
      detail.getByRole('heading', { level: 1, name: 'Quality Management' }),
    ).toBeVisible();

    // No `sources[]` -> no Sources row at all (not an empty one).
    await expect(detail.getByTestId('concept-sources')).toHaveCount(0);

    // The v0.1 lane is UNCHANGED: the top-level `resource:` pointer still
    // renders as its own chip...
    await expect(
      detail.getByRole('button', {
        name: 'canonical://q_a_pairs?scope_tag=quality-management',
      }),
    ).toBeVisible();

    // ...and the body — including the `# Citations` trailer the v0.2 producer
    // no longer writes — renders through.
    await expect(detail.getByText(/ISO 9001:2015/).first()).toBeVisible();
    await expect(
      detail.getByRole('heading', { name: 'Citations' }),
    ).toBeVisible();
  });
});
