/**
 * Deterministic `change_reports` seed + teardown helpers for the
 * change-reports-page E2E spec (WS3 / bl-115).
 *
 * WHY THIS EXISTS
 * ---------------
 * `change_reports` is a GLOBAL, unscoped table (no workspace_id / user_id
 * column). The `/api/change-reports/latest` and `/list` routes read the whole
 * table ordered by `created_at DESC`, so the change-reports page renders:
 *   - the empty-state hero  ⟺ zero rows exist globally
 *   - the loaded ChangeReportView ⟺ ≥1 row exists
 *   - the "Previous Reports" list ⟺ ≥2 rows exist (one is the "latest"/current
 *     report, the remainder are filtered into the previous-reports section)
 *
 * The two populated-state tests in change-reports-page.spec.ts previously
 * `if`-guarded their assertions because the test DB has no change-report data,
 * so the asserted branch never ran (a vacuous false-pass). Seeding real rows
 * here lets those tests assert UNCONDITIONALLY against a real DB → API → render
 * persistence contract.
 *
 * ISOLATION + TEARDOWN
 * --------------------
 * Because the table is global, seeded rows are visible to every reader. We tag
 * each seeded row with `metadata.e2e_change_report_fixture_run_id` (mirroring
 * the admin-dedup fixture tag convention) so teardown deletes ONLY this run's
 * rows and never a foreign row. The owning spec seeds in a serial
 * `beforeAll`/`afterAll` bracket and the empty-state test route-mocks the
 * endpoints so it stays correct regardless of any concurrent seeded rows.
 *
 * There are no FK children: `item_ids` is a plain `uuid[]` array on the row
 * itself (we seed it empty), so teardown is a single DELETE by tag.
 */
import type { Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChangeReportDomainSummary } from '@/types/change-reports';

/** Tag key written into `change_reports.metadata` for precise teardown. */
export const CHANGE_REPORT_FIXTURE_TAG = 'e2e_change_report_fixture_run_id';

/**
 * The single deterministic taxonomy-domain name injected by
 * {@link stubTaxonomyDomains}. The change-reports custom filter renders one
 * <SelectItem> per domain `name` (see app/change-reports/page.tsx) and the
 * active-filter badge + its remove button echo the selected `name` verbatim,
 * so the owning spec asserts the badge UNCONDITIONALLY against this constant.
 */
export const STUB_TAXONOMY_DOMAIN_NAME = 'cyber-security';

/**
 * Route-mock `taxonomy_domains` to a DETERMINISTIC single-domain list so the
 * custom-filter domain <Select> always offers exactly one selectable domain
 * (`STUB_TAXONOMY_DOMAIN_NAME`) beyond the "All domains" sentinel.
 *
 * WHY THIS EXISTS
 * ---------------
 * `contexts/taxonomy-context.tsx` populates the domain options via a direct
 * supabase-js read:
 *   from('taxonomy_domains').select('id, name, …').eq('is_active', true)
 * which resolves to `GET …/rest/v1/taxonomy_domains?select=…`. The test DB's
 * domain set is ambient and non-deterministic (it can legitimately be empty),
 * which is exactly why the spec previously soft-guarded its badge assertion
 * with `if (optionCount > 1)` — a vacuous false-pass whenever no domain seed
 * existed. Stubbing the REST read to a fixed single domain lets the spec drop
 * the guard and hard-assert the active-filter badge against a known name,
 * never against ambient staging content (test-philosophy.md §2.1).
 *
 * Mirrors the `stubEmptyChangeReports` pattern in change-reports-page.spec.ts:
 * route-mock BEFORE `page.goto`, deterministic JSON body, no DB mutation.
 *
 * Must be called BEFORE `page.goto`.
 */
export async function stubTaxonomyDomains(page: Page): Promise<void> {
  await page.route('**/rest/v1/taxonomy_domains*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: '00000000-0000-0000-0000-0000000000d1',
          name: STUB_TAXONOMY_DOMAIN_NAME,
          display_name: 'Cyber Security',
          display_order: 0,
          colour: 'blue',
          is_active: true,
          provenance: 'manual',
        },
      ]),
    }),
  );
}

export interface SeededChangeReport {
  id: string;
  frequency: string;
  period_start: string;
  period_end: string;
  item_count: number;
}

export interface ChangeReportFixtureData {
  /** Unique tag identifying every row seeded in this run. */
  runId: string;
  /** The newest seeded row — becomes the page's "current"/latest report. */
  latest: SeededChangeReport;
  /** Older seeded rows — render in the "Previous Reports" list. */
  previous: SeededChangeReport[];
  /** All seeded rows, newest-first. */
  all: SeededChangeReport[];
}

/** Generate a collision-resistant run id for tagging seeded rows. */
export function generateChangeReportRunId(label = 'cr'): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A single deterministic domain summary so the loaded view has content. */
function buildDomainSummary(): ChangeReportDomainSummary {
  return {
    domain: 'Market Intelligence',
    item_count: 3,
    summary:
      'Deterministic E2E fixture domain summary — three notable additions in the period.',
    top_items: [
      {
        id: '00000000-0000-0000-0000-000000000001',
        title: 'E2E fixture item — AI agents briefing',
        content_type: 'article',
        why_notable: 'Seeded for the change-reports populated-state E2E test.',
        summary: null,
      },
    ],
    key_themes: ['ai agents', 'cloud'],
  };
}

/**
 * Seed `count` (>= 2) deterministic change_reports rows, newest first.
 *
 * Each row gets a distinct, monotonically-decreasing `created_at` (and matching
 * `period_*` window) so ordering is stable: index 0 is the latest/current
 * report, indices 1.. are previous reports. Frequencies rotate through
 * weekly/daily/custom so the "type label" assertion (Weekly|Daily|Custom) has
 * deterministic coverage.
 */
export async function seedChangeReports(
  supabase: SupabaseClient,
  runId: string,
  count = 2,
): Promise<ChangeReportFixtureData> {
  if (count < 2) {
    throw new Error(
      `seedChangeReports requires count >= 2 so the "Previous Reports" ` +
        `section renders (one row is the current report); got ${count}.`,
    );
  }

  const frequencies = ['weekly', 'daily', 'custom'] as const;
  const dayMs = 24 * 60 * 60 * 1000;
  // Anchor in the past so seeded windows never collide with "today" and the
  // values are byte-stable within a run.
  const anchor = Date.parse('2026-03-22T00:00:00.000Z');

  const rows = Array.from({ length: count }, (_, i) => {
    // i = 0 is newest. Each older row shifts a full week earlier.
    const periodEndMs = anchor - i * 7 * dayMs;
    const periodStartMs = periodEndMs - 7 * dayMs;
    const createdAtMs = periodEndMs; // preserve newest-first ordering
    const frequency = frequencies[i % frequencies.length];
    return {
      frequency,
      period_start: new Date(periodStartMs).toISOString(),
      period_end: new Date(periodEndMs).toISOString(),
      item_count: 3 + i,
      domain_summaries: [buildDomainSummary()],
      narrative_summary: `E2E fixture change report ${i + 1} (${frequency}).`,
      generated_at: new Date(createdAtMs).toISOString(),
      generated_by: 'e2e-fixture',
      tokens_used: 0,
      item_ids: [],
      created_at: new Date(createdAtMs).toISOString(),
      metadata: { [CHANGE_REPORT_FIXTURE_TAG]: runId },
    };
  });

  const { data, error } = await supabase
    .from('change_reports')
    .insert(rows)
    .select('id, frequency, period_start, period_end, item_count, created_at');

  if (error) {
    throw new Error(`Failed to seed change_reports fixture: ${error.message}`);
  }

  const seeded = (data ?? []) as Array<
    SeededChangeReport & { created_at: string }
  >;
  // Order newest-first by created_at to match the API's ordering.
  seeded.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const all: SeededChangeReport[] = seeded.map((r) => ({
    id: r.id,
    frequency: r.frequency,
    period_start: r.period_start,
    period_end: r.period_end,
    item_count: r.item_count,
  }));

  if (all.length < 2) {
    throw new Error(
      `change_reports seed returned ${all.length} rows; expected >= 2.`,
    );
  }

  return {
    runId,
    latest: all[0],
    previous: all.slice(1),
    all,
  };
}

/**
 * Delete every change_reports row tagged with this run id.
 *
 * Returns the number of rows deleted (for an orphan-row assertion in teardown).
 * Tag-scoped so it can never delete a foreign row.
 */
export async function cleanupChangeReports(
  supabase: SupabaseClient,
  runId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('change_reports')
    .delete()
    .eq(`metadata->>${CHANGE_REPORT_FIXTURE_TAG}`, runId)
    .select('id');

  if (error) {
    throw new Error(
      `Failed to clean up change_reports fixture (run ${runId}): ${error.message}`,
    );
  }
  return (data ?? []).length;
}

/**
 * Count how many rows remain tagged with this run id. Used by the spec's
 * teardown to assert zero orphan rows persist in the prod-acting DB.
 */
export async function countChangeReportFixtureRows(
  supabase: SupabaseClient,
  runId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('change_reports')
    .select('id', { count: 'exact', head: true })
    .eq(`metadata->>${CHANGE_REPORT_FIXTURE_TAG}`, runId);

  if (error) {
    throw new Error(
      `Failed to count change_reports fixture rows (run ${runId}): ${error.message}`,
    );
  }
  return count ?? 0;
}
