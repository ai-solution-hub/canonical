/**
 * §1.7 Admin Cross-System Dedup Review — read-only E2E spec (S214B WP2).
 *
 * Covers acceptance criteria from `docs/specs/§1.7-admin-dedup-review-spec.md`
 * §8:
 *   - AC1 — queue lists suspected duplicates with DD/MM/YYYY created_at
 *   - AC2 — primary_domain filter narrows to matching rows
 *   - AC3 — detail view shows side-by-side compare
 *   - AC8 — admin RBAC enforced (editor/viewer redirected, admin sees queue)
 *
 * Mutating actions (Confirm duplicate / Confirm unique / Mark superseded)
 * are deferred to WP3 — this spec is read-only and MUST NOT click any of
 * those buttons.
 *
 * Worker fixture: `adminDedupFixture` from
 * `e2e/fixtures/admin-dedup-fixture.ts` seeds 26 fixture rows (6 §1.7
 * pairs + 7 §1.9 pairs) per worker, with cleanup on worker exit. The
 * §1.7 queue rows the spec consumes are typed-accessor accessible via
 * `adminDedupFixture.queue.{confirmDuplicate,domainAFilter,domainBFilter,...}`.
 *
 * Memory references:
 *   - `feedback_e2e_no_workarounds`: real fixtures + hard expects only.
 *   - `feedback_e2e_conditional_false_pass`: NO `if (await x.isVisible()...)`
 *     fallbacks — every assertion is a hard expect.
 *   - `feedback_brief_quote_spec_verbatim`: AC text quoted verbatim from
 *     §1.7 spec §8.
 */
import { mergeTests, expect } from '@playwright/test';
import { test as authTest } from '../fixtures';
import { test as adminDedupTest } from '../fixtures/admin-dedup-fixture';

const test = mergeTests(authTest, adminDedupTest);

// DD/MM/YYYY date format the spec mandates (lib/format::formatDateUK).
// Anchored regex (`^...$`) for cell-level assertions where the WHOLE
// rendered text is expected to match (e.g. the queue table's Created
// cell). Non-anchored regex for `toContainText` calls where the date
// is one substring among many (e.g. the detail row card's metadata
// block, which contains "Created: DD/MM/YYYY ...").
const DD_MM_YYYY_EXACT = /^\d{2}\/\d{2}\/\d{4}$/;
const DD_MM_YYYY_SUBSTRING = /\d{2}\/\d{2}\/\d{4}/;

// Domain values used by the fixture — see admin-dedup-fixture-helpers.ts
// constants `DOMAIN_X` and `DOMAIN_Y`. Domain X has 5 §1.7 queue subjects
// (confirmDuplicate, confirmUnique, supersedeA, supersedeB, domainAFilter)
// plus several §1.9 near-dup rows; Domain Y has 1 §1.7 queue subject
// (domainBFilter) plus 2 §1.9 near-dup rows. Other workers/users may have
// additional rows present in staging — assertions are tolerant of those.
// Only DOMAIN_Y is referenced — Domain X coverage is implicit (fixture's
// domainAFilter row is the canonical Service-Delivery example for AC1).
const DOMAIN_Y = 'Technical Capability';

test.describe('Admin Dedup Queue — §1.7 read-only', () => {
  // Each spec needs the worker fixture to be ready (~26 rows seeded) and
  // cleaned up on teardown. The smoke gate inside the fixture covers
  // pgvector-roundtrip drift before any test runs.
  test.setTimeout(120_000);

  // ─────────────────────────────────────────────────────────────────────
  // AC1 — Queue lists suspected duplicates.
  // ─────────────────────────────────────────────────────────────────────
  test('AC1 — queue lists suspected duplicates with DD/MM/YYYY dates', async ({
    authenticatedPage: page,
    adminDedupFixture,
  }) => {
    await page.goto('/admin/content-dedup');

    // Page header is rendered by the queue client component once the
    // server-component shell hands off (auth gate passed).
    await expect(
      page.getByRole('heading', { name: /Cross-System Dedup Review/i }),
    ).toBeVisible({ timeout: 15_000 });

    // The fixture's confirmDuplicate subject row MUST be visible — this
    // row is seeded with `dedup_status='suspected_duplicate'` and
    // `archived_at IS NULL`, so it MUST surface in the queue.
    const confirmRow = page.getByTestId(
      `dedup-row-${adminDedupFixture.queue.confirmDuplicate.subjectId}`,
    );
    await expect(confirmRow).toBeVisible();

    // Spot-check additional fixture queue subjects to cover the full
    // suspected_duplicate set the fixture seeds. Tolerant of extra rows
    // (e.g. parallel workers / staging residuals).
    await expect(
      page.getByTestId(
        `dedup-row-${adminDedupFixture.queue.domainAFilter.subjectId}`,
      ),
    ).toBeVisible();
    await expect(
      page.getByTestId(
        `dedup-row-${adminDedupFixture.queue.domainBFilter.subjectId}`,
      ),
    ).toBeVisible();

    // Resolve link goes to the detail route for that row.
    const resolveLink = page.getByTestId(
      `dedup-row-resolve-${adminDedupFixture.queue.confirmDuplicate.subjectId}`,
    );
    await expect(resolveLink).toBeVisible();
    await expect(resolveLink).toHaveAttribute(
      'href',
      `/admin/content-dedup/${adminDedupFixture.queue.confirmDuplicate.subjectId}`,
    );

    // The Created-at cell on the confirmDuplicate row MUST render in
    // DD/MM/YYYY (formatDateUK) — verifies AC1's date-format clause.
    const createdCell = confirmRow.locator('td').first();
    await expect(createdCell).toHaveText(DD_MM_YYYY_EXACT);
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC2 — Filter and sort work.
  //
  // Apply the Radix Select domain filter to the fixture's Domain Y value
  // ("Technical Capability") and assert that the domain-B fixture row is
  // visible while the domain-A fixture row (Service Delivery) is NOT.
  // ─────────────────────────────────────────────────────────────────────
  test('AC2 — primary_domain filter narrows visible rows', async ({
    authenticatedPage: page,
    adminDedupFixture,
  }) => {
    await page.goto('/admin/content-dedup');
    await expect(
      page.getByRole('heading', { name: /Cross-System Dedup Review/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Pre-filter sanity — both fixture rows visible without filter.
    const domainARow = page.getByTestId(
      `dedup-row-${adminDedupFixture.queue.domainAFilter.subjectId}`,
    );
    const domainBRow = page.getByTestId(
      `dedup-row-${adminDedupFixture.queue.domainBFilter.subjectId}`,
    );
    await expect(domainARow).toBeVisible();
    await expect(domainBRow).toBeVisible();

    // Open the domain filter Radix Select. The trigger is labelled
    // "Filter by domain" via aria-label per the filter-bar component.
    const domainFilter = page.getByRole('combobox', {
      name: /Filter by domain/i,
    });
    await expect(domainFilter).toBeVisible();
    await domainFilter.click();

    // Pick Domain Y from the popover. Use Radix's role-based option
    // matcher per the markdown-batch precedent. This domain MUST be in
    // the dropdown because the fixture's domainBFilter subject is
    // visible and the queue derives availableDomains from current
    // results.
    await page
      .getByRole('option', { name: new RegExp(`^${DOMAIN_Y}$`, 'i') })
      .first()
      .click();

    // After filter applies, the network/state settles — TanStack Query
    // re-renders the table. Wait for the trigger to display the chosen
    // domain so we know the state is committed.
    await expect(domainFilter).toContainText(DOMAIN_Y);

    // Domain B row remains visible; Domain A row is hidden.
    await expect(domainBRow).toBeVisible();
    await expect(domainARow).not.toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC3 — Detail view shows side-by-side compare.
  //
  // Navigate via the Resolve link from the queue. Assert subject and
  // canonical row cards both render with title, body, created_at,
  // source, domain, and publication_status badge per §6.2. Similarity
  // score also visible in the header.
  // ─────────────────────────────────────────────────────────────────────
  test('AC3 — detail view renders subject and canonical side-by-side', async ({
    authenticatedPage: page,
    adminDedupFixture,
  }) => {
    const subjectId = adminDedupFixture.queue.confirmDuplicate.subjectId;

    await page.goto(`/admin/content-dedup/${subjectId}`);

    // Page heading and similarity badge appear once the detail query
    // resolves. The fixture's queue rows share content_text_hash with
    // their canonicals (md5 collision is intentional — see fixture
    // helpers §3) so similarity should be 1.0 (exact-hash soft-block).
    await expect(
      page.getByRole('heading', { name: /Resolve duplicate/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Similarity:\s*1\.00/i)).toBeVisible();

    // Both row-card label badges visible (testids set in
    // content-dedup-row-card.tsx).
    const subjectLabel = page.getByTestId('row-card-label-subject');
    const canonicalLabel = page.getByTestId('row-card-label-canonical');
    await expect(subjectLabel).toBeVisible();
    await expect(canonicalLabel).toBeVisible();

    // Each card has its own labelled region (Card aria-label). Subject
    // card shows the seeded title prefix; canonical card shows its.
    const subjectCard = page.getByRole('region', {
      name: /Subject \(suspected\) content body/i,
    });
    const canonicalCard = page.getByRole('region', {
      name: /Canonical \(existing\) content body/i,
    });
    await expect(subjectCard).toBeVisible();
    await expect(canonicalCard).toBeVisible();

    // Both bodies must contain the fixture's content marker — the
    // confirmDuplicate slot's content seed is "Confirm-duplicate fixture
    // — admin will mark this subject as a duplicate." Both subject and
    // canonical share this content (sharedContent in seedAdminDedupFixtures).
    await expect(subjectCard).toContainText(/Confirm-duplicate fixture/i);
    await expect(canonicalCard).toContainText(/Confirm-duplicate fixture/i);

    // Status / metadata rows render via text content. The Card region
    // sets aria-label="Subject (suspected)" / "Canonical (existing)";
    // assert metadata fields the spec §6.2 mandates (Created, Source,
    // Domain, Status) appear on both cards.
    const subjectRegion = page.getByLabel('Subject (suspected)').first();
    const canonicalRegion = page.getByLabel('Canonical (existing)').first();

    for (const label of [/Created:/i, /Source:/i, /Domain:/i, /Status:/i]) {
      await expect(subjectRegion).toContainText(label);
      await expect(canonicalRegion).toContainText(label);
    }

    // Created-at value rendered DD/MM/YYYY in BOTH cards (substring —
    // the card text contains "Created: DD/MM/YYYY" plus other rows).
    await expect(subjectRegion).toContainText(DD_MM_YYYY_SUBSTRING);
    await expect(canonicalRegion).toContainText(DD_MM_YYYY_SUBSTRING);
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC8 — Admin RBAC enforced.
  //
  // editorPage and viewerPage both attempt to load /admin/content-dedup.
  // Per app/admin/content-dedup/page.tsx, the server component:
  //   - redirect('/login') for unauthenticated
  //   - redirect('/') for authenticated non-admin (editor / viewer)
  // The admin (authenticatedPage) MUST land on the queue.
  // ─────────────────────────────────────────────────────────────────────
  test('AC8 — admin sees queue; editor + viewer redirected to /', async ({
    authenticatedPage: adminPage,
    editorPage,
    viewerPage,
  }) => {
    // Admin: queue heading rendered (no redirect).
    await adminPage.goto('/admin/content-dedup');
    await expect(
      adminPage.getByRole('heading', { name: /Cross-System Dedup Review/i }),
    ).toBeVisible({ timeout: 15_000 });
    expect(adminPage.url()).toContain('/admin/content-dedup');

    // Editor: redirected away from /admin/content-dedup. The redirect
    // target is `/` per the page's `redirect('/')` call. The queue
    // heading MUST NOT be visible.
    await editorPage.goto('/admin/content-dedup');
    await editorPage.waitForURL((url) => !url.pathname.startsWith('/admin/'), {
      timeout: 15_000,
    });
    expect(editorPage.url()).not.toContain('/admin/content-dedup');
    await expect(
      editorPage.getByRole('heading', { name: /Cross-System Dedup Review/i }),
    ).not.toBeVisible();

    // Viewer: same redirect contract.
    await viewerPage.goto('/admin/content-dedup');
    await viewerPage.waitForURL((url) => !url.pathname.startsWith('/admin/'), {
      timeout: 15_000,
    });
    expect(viewerPage.url()).not.toContain('/admin/content-dedup');
    await expect(
      viewerPage.getByRole('heading', { name: /Cross-System Dedup Review/i }),
    ).not.toBeVisible();
  });
});
