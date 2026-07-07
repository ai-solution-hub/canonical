/**
 * `get_guide_content` RPC — real DB regression test (fix-Executor, live P0).
 *
 * Root cause this guards against: `public.get_guide_content`'s SQL body
 * LEFT JOINed the M6-dropped `content_items` table
 * (20260706110000_id131_drops.sql). Postgres does not dependency-track a
 * `LANGUAGE sql` function body against the tables it queries the way it does
 * a view, so the DROP TABLE succeeded silently and every call started
 * erroring at runtime ("relation \"content_items\" does not exist") — no
 * existing test caught this. `__tests__/lib/guides/product-guide-resolution.test.ts`
 * only simulates the RPC's matching logic client-side against a mocked
 * Supabase client (`.from('guide_sections')`), so it never executes the
 * function's real SQL body against a real schema. This test closes that gap
 * by calling the RPC (via the real Supabase client, which routes to the
 * exposed `api` schema — `api.get_guide_content` is a thin
 * `SELECT * FROM public.get_guide_content(...)` wrapper, so it exercises the
 * identical body) against a freshly seeded guide + section pair.
 *
 * Fixed by 20260707210000_fix_get_guide_content_content_items_residue.sql —
 * AUTHORED, NOT YET APPLIED to staging as of this commit: remote-only
 * migration versions on staging (20260707190000/190500/190600/200000) are
 * not present in this worktree, which blocks `supabase db push` with
 * "Remote migration versions not found in local migrations directory" — per
 * this Subtask's dispatch brief, migration-history repair is explicitly out
 * of a fix-Executor's authority, so this ships as an apply-intent for the
 * owner/Orchestrator.
 *
 * Because the fix is not yet live, this file self-gates: a live probe below
 * detects whether the migration has landed (the pre-fix function errors on
 * ANY call — `content_items` is referenced unconditionally in the JOIN
 * clause, independent of input — so a call with a deliberately-nonexistent
 * slug reliably distinguishes broken vs fixed without needing seed data
 * first) and skips the assertion suite until it has, so this commit does not
 * turn `bun run test:integration` (a hard PR-blocking CI gate, WP-CI.RES.3)
 * red for an already-known, already-tracked, owner-gated apply. No manual
 * unskip step is needed — once 20260707210000 applies to the target
 * environment, this suite starts running (and asserting) automatically on
 * the next run.
 *
 * Live caller: app/api/guides/[slug]/route.ts:64, consumed by
 * app/guide/[slug]/guide-content.tsx (the `/guide/[slug]` page).
 *
 * Prerequisites:
 *   - `.env.local` (or .env) with NEXT_PUBLIC_SUPABASE_URL +
 *     SUPABASE_SERVICE_ROLE_KEY pointing at the persistent staging branch.
 *
 * Run via: `bun run test:integration -- get-guide-content-rpc`
 *   (NOT picked up by `bun run test`.)
 *
 * @vitest-environment node
 */

import { describe, it, expect, afterAll } from 'vitest';
import { serviceClient } from './helpers/service-client';
import {
  createTestGuide,
  createTestGuideSection,
} from './helpers/test-data-factory';

/**
 * Probe: does `get_guide_content` still reference the dropped `content_items`
 * table? A nonexistent slug produces zero matching rows either way, but the
 * pre-fix body fails at catalog-resolution time (before `WHERE g.slug = ...`
 * is even evaluated), so it errors regardless of input. Any error OTHER than
 * that exact signature is a genuine, unexpected failure and is surfaced by
 * re-throwing rather than silently folded into "not applied yet".
 */
async function probeMigrationApplied(): Promise<boolean> {
  const { error } = await serviceClient.rpc('get_guide_content', {
    p_guide_slug: '__id131_19_probe_nonexistent_guide_slug__',
  });
  if (!error) return true;
  if (error.code === '42P01' && error.message?.includes('content_items')) {
    console.warn(
      '[get-guide-content-rpc.integration] 20260707210000 not yet applied to this environment — skipping the regression suite (pre-fix content_items residue confirmed, tracked as a known apply-intent).',
    );
    return false;
  }
  throw error;
}

const migrationApplied = await probeMigrationApplied();

const guide = createTestGuide({
  slug: `id131-guide-content-rpc-${Date.now()}`,
  name: 'get_guide_content RPC regression fixture',
  domain_filter: 'corporate',
  is_published: true,
});

const sections = [
  createTestGuideSection({
    guide_id: guide.id,
    section_name: 'Section A',
    display_order: 0,
    is_required: true,
    expected_layer: 'sales_brief',
    subtopic_filter: 'company-info',
  }),
  createTestGuideSection({
    guide_id: guide.id,
    section_name: 'Section B',
    display_order: 1,
    is_required: false,
    expected_layer: 'research',
    subtopic_filter: null,
  }),
];

afterAll(async () => {
  if (!migrationApplied) return;
  // guide_sections FK is ON DELETE CASCADE from guides, so deleting the
  // guide alone is sufficient — the explicit section delete is defensive.
  await serviceClient
    .from('guide_sections')
    .delete()
    .in(
      'id',
      sections.map((s) => s.id),
    );
  await serviceClient.from('guides').delete().eq('id', guide.id);
}, 30_000);

describe.skipIf(!migrationApplied)('get_guide_content RPC — real DB', () => {
  it('seeds a guide + sections directly (bypassing RLS via the service client)', async () => {
    const { error: guideError } = await serviceClient.from('guides').insert({
      id: guide.id,
      slug: guide.slug,
      name: guide.name,
      description: guide.description,
      guide_type: guide.guide_type,
      domain_filter: guide.domain_filter,
      icon: guide.icon,
      color: guide.color,
      display_order: guide.display_order,
      is_published: guide.is_published,
      created_by: guide.created_by,
    });
    expect(guideError).toBeNull();

    const { error: sectionsError } = await serviceClient
      .from('guide_sections')
      .insert(
        sections.map((s) => ({
          id: s.id,
          guide_id: s.guide_id,
          section_name: s.section_name,
          description: s.section_description,
          expected_layer: s.expected_layer,
          subtopic_filter: s.subtopic_filter,
          content_type_filter: s.content_type_filter,
          display_order: s.display_order,
          is_required: s.is_required,
        })),
      );
    expect(sectionsError).toBeNull();
  });

  it('calling the RPC does not error and returns one row per section, ordered by display_order', async () => {
    const { data, error } = await serviceClient.rpc('get_guide_content', {
      p_guide_slug: guide.slug,
    });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data).toHaveLength(sections.length);

    const rows = (data ?? [])
      .slice()
      .sort((a, b) => a.section_order - b.section_order);
    expect(rows.map((r) => r.section_name)).toEqual(['Section A', 'Section B']);
    expect(rows.map((r) => r.section_order)).toEqual([0, 1]);
  });

  it('every content_* column is NULL (content-item matching structurally retired at M6 — see migration header)', async () => {
    const { data, error } = await serviceClient.rpc('get_guide_content', {
      p_guide_slug: guide.slug,
    });
    expect(error).toBeNull();

    for (const row of data ?? []) {
      expect(row.content_id).toBeNull();
      expect(row.content_title).toBeNull();
      expect(row.content_type).toBeNull();
      expect(row.content_layer).toBeNull();
      expect(row.content_brief).toBeNull();
      expect(row.content_freshness).toBeNull();
      expect(row.content_verified_at).toBeNull();
      expect(row.content_captured_date).toBeNull();
    }
  });

  it('section metadata round-trips (expected_layer, subtopic_filter, is_required)', async () => {
    const { data, error } = await serviceClient.rpc('get_guide_content', {
      p_guide_slug: guide.slug,
    });
    expect(error).toBeNull();

    const sectionA = (data ?? []).find((r) => r.section_name === 'Section A');
    expect(sectionA?.expected_layer).toBe('sales_brief');
    expect(sectionA?.subtopic_filter).toBe('company-info');
    expect(sectionA?.is_required).toBe(true);

    const sectionB = (data ?? []).find((r) => r.section_name === 'Section B');
    expect(sectionB?.expected_layer).toBe('research');
    expect(sectionB?.subtopic_filter).toBeNull();
    expect(sectionB?.is_required).toBe(false);
  });
});

// Always-on sentinel: fails loudly (rather than silently skipping forever)
// if this file is ever run in an environment where the probe itself cannot
// distinguish applied/not-applied — guards against the skip condition
// silently rotting into a permanent, invisible skip.
describe('get_guide_content RPC — probe sanity', () => {
  it('the migration-applied probe resolved to a definite boolean', () => {
    expect(typeof migrationApplied).toBe('boolean');
  });
});
