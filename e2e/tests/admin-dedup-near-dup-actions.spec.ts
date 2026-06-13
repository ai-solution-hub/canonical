/**
 * §1.9 Admin Near-Duplicate Merge Dashboard — mutating-action E2E spec
 * (S214B WP3).
 *
 * Covers acceptance criteria from
 * `docs/specs/§1.9-near-dup-merge-dashboard-spec.md` §9:
 *   - AC5 — Merge invokes setSupersession. Click `Merge — left supersedes
 *           right` → POST → right's `superseded_by ← left.id`,
 *           `dedup_status ← 'superseded'`; left untouched. content_history
 *           row records OQ2 audit context (`similarity_at_resolution` AND
 *           `threshold_at_resolution` non-null numerics in metadata).
 *   - AC6 — Confirm-unique flips both rows. Click `Confirm both unique` →
 *           POST → BOTH pair members flip to `'confirmed_unique'`. Two
 *           content_history rows inserted (one per row) via the
 *           `resolve_near_dup_confirm_unique` RPC in a single transaction.
 *   - AC7 — Audit trail correct (covered through per-action audit
 *           assertions in AC5 + AC6).
 *   - AC10 — Empty state present. With the threshold at the upper bound
 *           (0.99, the slider's max — at that threshold no fixture pair
 *           targeting SIM_HIGH=0.97±0.005 surfaces), the dashboard renders
 *           the empty-state panel from §6.3.
 *
 * Per-test isolation (mutating tests only): each mutating test seeds a
 * fresh near-dup pair on the `content_items` table tagged with a unique
 * `metadata.e2e_dedup_fixture_run_id`. The worker-scoped fixture
 * (`adminDedupFixture`) is deliberately NOT consumed by mutating tests —
 * those slots are reserved for read-only render tests (per
 * `docs/audits/s213b-admin-dedup-fixtures-design.md` §9.5). The empty-
 * state test (AC10) does NOT need per-test seeding — it relies on the
 * worker fixture's pairs all targeting SIM_HIGH=0.97 (max ~0.975 with
 * tolerance), so a 0.99 threshold hides them.
 *
 * Memory references:
 *   - `feedback_e2e_no_workarounds`: real fixtures + hard expects only.
 *   - `feedback_e2e_conditional_false_pass`: NO `if (await x.isVisible()...)`
 *     fallbacks — every assertion is a hard expect.
 *   - `feedback_brief_quote_spec_verbatim`: AC text quoted verbatim from
 *     §1.9 spec §9.
 *   - `feedback_content_text_hash_generated_always`: omit
 *     `content_text_hash` from inserts (PG computes via md5(normalised)).
 *   - `feedback_content_history_change_reason_mandatory`: every audit row
 *     check asserts an explicit, category-specific change_reason.
 */
import { mergeTests, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { test as authTest } from '../fixtures';
import { test as adminDedupTest } from '../fixtures/admin-dedup-fixture';
import { createServiceClient } from '../fixtures/supabase';
import { buildPair } from '../fixtures/admin-dedup-vectors';
import { buildPairId } from '@/lib/dedup/pair-id';

const test = mergeTests(authTest, adminDedupTest);

// ---------------------------------------------------------------------------
// Per-test seed helpers (option-(a) inline). Vector helpers re-used from
// `e2e/fixtures/admin-dedup-vectors.ts` per the helpers' precedent.
// ---------------------------------------------------------------------------

interface SeededNearDupPair {
  runId: string;
  /** Lexically-smaller UUID — matches the find_duplicate_pairs RPC's id1<id2 ordering. */
  leftId: string;
  /** Lexically-larger UUID. */
  rightId: string;
  /** Stable URL pair-id segment: smallerUUID__largerUUID. */
  pairId: string;
  /** All seeded ids for FK-safe afterEach cleanup. */
  seededIds: string[];
  /** UUID written to content_items.created_by — used in audit assertions. */
  actorUserId: string;
}

function newRunId(): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(3).toString('hex');
  return `s214b-wp3-${ts}-${rand}`;
}

/**
 * Resolve the Playwright admin actor UUID — the user the test runs AS.
 *
 * `auth.admin.listUsers()` is filtered by TEST_USER_1's email rather than
 * a generic `user_roles` lookup because staging has multiple admin rows
 * (TEST_USER_1 + the pipeline service account). The route under test
 * writes `auth.session.user.id`, which is TEST_USER_1's id, so audit
 * assertions must compare against THAT, not "first admin in user_roles".
 */
async function resolveAdminActorId(supabase: SupabaseClient): Promise<string> {
  const adminEmail = process.env.TEST_USER_1_EMAIL;
  if (!adminEmail) {
    throw new Error(
      'admin-dedup-near-dup-actions: TEST_USER_1_EMAIL not set. ' +
        'Required to disambiguate the Playwright admin from other admin rows.',
    );
  }

  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) {
    throw new Error(
      `admin-dedup-near-dup-actions: auth.admin.listUsers failed — ${error.message}`,
    );
  }

  const adminUser = data.users.find((u) => u.email === adminEmail);
  if (!adminUser) {
    throw new Error(
      `admin-dedup-near-dup-actions: admin user with email ${adminEmail} not found. ` +
        `Run \`bun run seed:e2e-users\` to provision test users.`,
    );
  }

  return adminUser.id;
}

/**
 * Seed a fresh near-dup pair for a §1.9 mutating test.
 *
 * Both rows are 'clean' (the §1.9 dashboard route filters
 * suspected/confirmed_duplicate/superseded out of its list — and the
 * dashboard must be able to detect this fresh pair). Embeddings are
 * generated by `buildPair(pairKey, targetSim)` from
 * `admin-dedup-vectors.ts` so the cosine similarity lands within ±0.005
 * of the target; we use 0.97 (matches fixture's SIM_HIGH).
 *
 * Critical invariants (per `feedback_content_text_hash_generated_always`
 * + helpers' precedent):
 *   - `content_text_hash` is OMITTED (PG GENERATED ALWAYS).
 *   - Embeddings serialised via `JSON.stringify` (Supabase RPC vector
 *     param convention).
 *   - Both rows tagged with the unique runId for tag-based safety-net
 *     cleanup via globalTeardown.
 */
async function seedNearDupPair(
  supabase: SupabaseClient,
  actorUserId: string,
  runId: string,
  slot: string,
): Promise<SeededNearDupPair> {
  const pairKey = `${runId}-${slot}`;
  const [leftEmbedding, rightEmbedding] = buildPair(pairKey, 0.97);

  // Insert both rows in a single batch so both rows land before either is
  // visible to the find_duplicate_pairs RPC's CROSS JOIN.
  const { data: rows, error } = await supabase
    .from('content_items')
    .insert([
      {
        title: `[E2E-WP3-${runId}] ${slot} left`,
        content: `Per-test near-dup fixture for ${slot} (left, run=${runId}).`,
        content_type: 'article',
        dedup_status: 'clean',
        primary_domain: 'Service Delivery',
        ingestion_source: 'manual',
        created_by: actorUserId,
        updated_by: actorUserId,
        content_owner_id: actorUserId,
        metadata: {
          e2e_dedup_fixture_run_id: runId,
          e2e_dedup_fixture_slot: `${slot}-left`,
        },
        embedding: JSON.stringify(leftEmbedding),
      },
      {
        title: `[E2E-WP3-${runId}] ${slot} right`,
        content: `Per-test near-dup fixture for ${slot} (right, run=${runId}).`,
        content_type: 'article',
        dedup_status: 'clean',
        primary_domain: 'Service Delivery',
        ingestion_source: 'manual',
        created_by: actorUserId,
        updated_by: actorUserId,
        content_owner_id: actorUserId,
        metadata: {
          e2e_dedup_fixture_run_id: runId,
          e2e_dedup_fixture_slot: `${slot}-right`,
        },
        embedding: JSON.stringify(rightEmbedding),
      },
    ])
    .select('id, metadata');

  if (error || !rows || rows.length !== 2) {
    throw new Error(
      `seedNearDupPair: insert failed — ${error?.message ?? 'returned ' + (rows?.length ?? 0) + ' rows'}`,
    );
  }

  // Resolve the inserted ids by metadata.slot — Postgres insert order is
  // not guaranteed, but the slot tag is.
  const leftRow = rows.find((r) => {
    const meta = r.metadata as Record<string, unknown> | null;
    return meta?.['e2e_dedup_fixture_slot'] === `${slot}-left`;
  });
  const rightRow = rows.find((r) => {
    const meta = r.metadata as Record<string, unknown> | null;
    return meta?.['e2e_dedup_fixture_slot'] === `${slot}-right`;
  });
  if (!leftRow || !rightRow) {
    throw new Error(
      'seedNearDupPair: failed to resolve inserted rows by metadata slot',
    );
  }

  // The pair-id encoding is lexical on the UUIDs — NOT on the seed-time
  // "left/right" labels. Build it from the actual ids so the URL matches
  // what `find_duplicate_pairs` returns.
  const idA = leftRow.id as string;
  const idB = rightRow.id as string;
  const lexLeft = idA < idB ? idA : idB;
  const lexRight = idA < idB ? idB : idA;

  // Pin merge default direction to "left supersedes right" by making
  // lexLeft's created_at strictly newer than lexRight's. Otherwise the
  // batch insert lands sub-millisecond apart and the dialog's
  // defaultMergeDirection() heuristic (newer-wins) hits the `>=` boundary
  // non-deterministically — fine for the radio-state-adaptive AC5 test
  // body, but the deterministic seed makes future variants safer.
  const { error: updateErr } = await supabase
    .from('content_items')
    .update({ created_at: new Date(Date.now() - 1000).toISOString() })
    .eq('id', lexRight);
  if (updateErr) {
    throw new Error(
      `seedNearDupPair: created_at pin failed — ${updateErr.message}`,
    );
  }

  return {
    runId,
    leftId: lexLeft,
    rightId: lexRight,
    pairId: buildPairId(idA, idB),
    seededIds: [idA, idB],
    actorUserId,
  };
}

/**
 * FK-safe cleanup matching `cleanupAdminDedupFixtures` order:
 *   1. Clear self-FK `superseded_by` on either row (set by merge tests).
 *   2. Delete content_chunks.
 *   3. Delete content_history.
 *   4. Delete content_items.
 */
async function cleanupSeededIds(
  supabase: SupabaseClient,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;

  await supabase
    .from('content_items')
    .update({ superseded_by: null })
    .in('id', ids);

  await supabase.from('content_chunks').delete().in('content_item_id', ids);
  await supabase.from('content_history').delete().in('content_item_id', ids);
  await supabase.from('content_items').delete().in('id', ids);
}

/**
 * Move the threshold slider to a target value. Same keyboard-arrow pattern
 * as the WP2 spec (admin-dedup-near-duplicates.spec.ts) — native range
 * inputs respond to ArrowLeft/ArrowRight per browser default.
 */
async function setThresholdSlider(page: Page, target: number): Promise<void> {
  const toolbar = page.getByRole('toolbar', {
    name: /Near-duplicate filters/i,
  });
  const slider = toolbar.getByTestId('near-dup-threshold-slider');
  await expect(slider).toBeVisible();
  await slider.focus();

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

const PAIRS_LIST_URL = '/api/admin/content-dedup/near-duplicates';

// ---------------------------------------------------------------------------
// Spec body
// ---------------------------------------------------------------------------

test.describe('Admin Near-Duplicate Actions — §1.9 mutating actions', () => {
  test.setTimeout(120_000);

  let supabase: SupabaseClient;
  let actorUserId: string;
  let perTestSeededIds: string[] = [];

  test.beforeAll(async () => {
    supabase = createServiceClient();
    actorUserId = await resolveAdminActorId(supabase);
  });

  test.afterEach(async () => {
    if (perTestSeededIds.length === 0) return;
    await cleanupSeededIds(supabase, perTestSeededIds);
    perTestSeededIds = [];
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC5 — Merge invokes setSupersession.
  //
  // Click `Merge — left supersedes right` (default direction) → POST →
  // right row's superseded_by ← left.id, dedup_status ← 'superseded';
  // left row untouched.
  //
  // CRITICAL OQ2 audit context (per spec v1.1 §5.5 line 679-680, §5.6
  // line 745-746): content_history.metadata MUST include both
  // `similarity_at_resolution` AND `threshold_at_resolution` populated
  // with non-null numeric values.
  //
  // Note on "left supersedes right" direction: the merge route accepts
  // body { oldId, newId } where oldId is the retired side and newId is
  // the canonical (kept) side. The dialog computes oldId/newId from the
  // chosen radio direction. With both rows having NULL publication_status
  // (DB default) and roughly equal created_at, the heuristic picks
  // "left supersedes right" (left retains, right retires). We'll accept
  // whichever direction the dialog defaults to and assert against the
  // resulting DB state.
  // ─────────────────────────────────────────────────────────────────────
  test('AC5 — merge default direction invokes setSupersession + records OQ2 audit context', async ({
    authenticatedPage: page,
  }) => {
    const seed = await seedNearDupPair(
      supabase,
      actorUserId,
      newRunId(),
      'merge-default',
    );
    perTestSeededIds = seed.seededIds;

    await page.goto(`/admin/content-dedup/near-duplicates/${seed.pairId}`);
    await expect(
      page.getByRole('heading', { name: /Resolve near-duplicate pair/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Open the merge direction dialog.
    await page.getByTestId('near-dup-merge-trigger').click();

    // Read the default direction from the radio state — the dialog's
    // `defaultMergeDirection()` heuristic picks left/right based on
    // publication_status + created_at. Both seeded rows have NULL
    // publication_status (DB default), so the heuristic falls back to
    // newer-wins on created_at. We don't pin a specific direction here;
    // the test asserts the outcome matches the chosen radio state.
    const leftSupersedes = await page
      .getByTestId('merge-direction-left-supersedes-right')
      .isChecked();
    const rightSupersedes = await page
      .getByTestId('merge-direction-right-supersedes-left')
      .isChecked();
    expect(leftSupersedes || rightSupersedes).toBe(true);

    // Compute expected (oldId, newId) from the dialog's choice. The
    // dialog's onConfirm is wired to:
    //   left-supersedes-right → oldId=right.id, newId=left.id
    //   right-supersedes-left → oldId=left.id,  newId=right.id
    const expectedOldId = leftSupersedes ? seed.rightId : seed.leftId;
    const expectedNewId = leftSupersedes ? seed.leftId : seed.rightId;

    const responsePromise = page.waitForResponse(
      (resp) =>
        resp
          .url()
          .endsWith(
            `/api/admin/content-dedup/near-duplicates/${seed.pairId}/merge`,
          ) && resp.request().method() === 'POST',
      { timeout: 15_000 },
    );

    await page.getByTestId('merge-direction-confirm').click();

    const resp = await responsePromise;
    expect(resp.status()).toBe(200);

    const respBody = (await resp.json()) as {
      pairId: string;
      oldId: string;
      newId: string;
      dedup_status: string;
    };
    expect(respBody.pairId).toBe(seed.pairId);
    expect(respBody.oldId).toBe(expectedOldId);
    expect(respBody.newId).toBe(expectedNewId);
    expect(respBody.dedup_status).toBe('superseded');

    await page.waitForURL('**/admin/content-dedup/near-duplicates', {
      timeout: 15_000,
    });

    // Hard DB assertion — old (loser) is superseded, new (winner) untouched.
    const { data: postRows, error: postErr } = await supabase
      .from('content_items')
      .select('id, dedup_status, superseded_by')
      .in('id', [seed.leftId, seed.rightId]);
    expect(postErr, postErr?.message).toBeNull();
    const postOld = postRows!.find((r) => r.id === expectedOldId);
    const postNew = postRows!.find((r) => r.id === expectedNewId);
    expect(postOld).toBeTruthy();
    expect(postOld!.dedup_status).toBe('superseded');
    expect(postOld!.superseded_by).toBe(expectedNewId);
    expect(postNew).toBeTruthy();
    // Winner is untouched — still 'clean', no superseded_by.
    expect(postNew!.dedup_status).toBe('clean');
    expect(postNew!.superseded_by).toBeNull();

    // Audit-row assertion — 1 row against the loser with merge + OQ2 context.
    const { data: historyRows, error: historyErr } = await supabase
      .from('content_history')
      .select(
        'content_item_id, change_reason, change_type, created_by, metadata',
      )
      .eq('content_item_id', expectedOldId)
      .eq('change_reason', 'dedup_admin_review_near_dup_merged');
    expect(historyErr, historyErr?.message).toBeNull();
    expect(historyRows).toHaveLength(1);
    const audit = historyRows![0];
    expect(audit.change_type).toBe('merge');
    expect(audit.created_by).toBe(actorUserId);

    // OQ2 audit context — similarity_at_resolution + threshold_at_resolution
    // must be non-null numerics. The route reads the slider's threshold
    // from the URL query (?threshold=…) which the page list view sets
    // when generating the resolve link, AND the similarity from the
    // detail GET. We navigated directly (no ?threshold=…), so the page
    // falls back to the default 0.95 threshold for the detail page.
    const meta = audit.metadata as Record<string, unknown>;
    expect(meta?.['pairId']).toBe(seed.pairId);
    expect(meta?.['oldId']).toBe(expectedOldId);
    expect(meta?.['newId']).toBe(expectedNewId);
    expect(meta?.['peerId']).toBe(expectedNewId);

    const sim = meta?.['similarity_at_resolution'];
    const thr = meta?.['threshold_at_resolution'];
    expect(typeof sim).toBe('number');
    expect(sim).not.toBeNull();
    expect(typeof thr).toBe('number');
    expect(thr).not.toBeNull();
    // Sanity-bounds — similarity should be near the seeded 0.97 target,
    // threshold should be a valid slider value (0.85–0.99).
    expect(sim as number).toBeGreaterThan(0.9);
    expect(sim as number).toBeLessThanOrEqual(1.0);
    expect(thr as number).toBeGreaterThanOrEqual(0.85);
    expect(thr as number).toBeLessThanOrEqual(0.99);
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC6 — Confirm-unique flips both rows.
  //
  // Click `Confirm both unique` → POST → BOTH pair members flip
  // dedup_status='confirmed_unique'.
  //
  // Audit assertion: TWO content_history rows inserted (one per row),
  // change_reason='dedup_admin_review_near_dup_confirmed_unique',
  // change_type='metadata_change'. Both inserts in same transaction
  // (per resolve_near_dup_confirm_unique RPC §5.6 — failure of second
  // rolls back first).
  // ─────────────────────────────────────────────────────────────────────
  test('AC6 — confirm-both-unique flips both rows + writes 2 audit rows', async ({
    authenticatedPage: page,
  }) => {
    const seed = await seedNearDupPair(
      supabase,
      actorUserId,
      newRunId(),
      'confirm-unique',
    );
    perTestSeededIds = seed.seededIds;

    await page.goto(`/admin/content-dedup/near-duplicates/${seed.pairId}`);
    await expect(
      page.getByRole('heading', { name: /Resolve near-duplicate pair/i }),
    ).toBeVisible({ timeout: 15_000 });

    const responsePromise = page.waitForResponse(
      (resp) =>
        resp
          .url()
          .endsWith(
            `/api/admin/content-dedup/near-duplicates/${seed.pairId}/confirm-unique`,
          ) && resp.request().method() === 'POST',
      { timeout: 15_000 },
    );

    await page.getByTestId('near-dup-confirm-unique').click();

    const resp = await responsePromise;
    expect(resp.status()).toBe(200);

    await page.waitForURL('**/admin/content-dedup/near-duplicates', {
      timeout: 15_000,
    });

    // Hard DB assertion — BOTH rows confirmed_unique.
    const { data: postRows, error: postErr } = await supabase
      .from('content_items')
      .select('id, dedup_status, superseded_by')
      .in('id', [seed.leftId, seed.rightId]);
    expect(postErr, postErr?.message).toBeNull();
    expect(postRows).toHaveLength(2);
    for (const row of postRows!) {
      expect(row.dedup_status).toBe('confirmed_unique');
      expect(row.superseded_by).toBeNull();
    }

    // Audit-row assertion — 2 rows total, one per pair member, both with
    // change_reason='dedup_admin_review_near_dup_confirmed_unique' and
    // change_type='metadata_change'. The RPC writes them transactionally.
    const { data: historyRows, error: historyErr } = await supabase
      .from('content_history')
      .select(
        'content_item_id, change_reason, change_type, created_by, metadata',
      )
      .in('content_item_id', [seed.leftId, seed.rightId])
      .eq('change_reason', 'dedup_admin_review_near_dup_confirmed_unique');
    expect(historyErr, historyErr?.message).toBeNull();
    expect(historyRows).toHaveLength(2);

    const leftHistory = historyRows!.find(
      (r) => r.content_item_id === seed.leftId,
    );
    const rightHistory = historyRows!.find(
      (r) => r.content_item_id === seed.rightId,
    );
    expect(leftHistory).toBeTruthy();
    expect(leftHistory!.change_type).toBe('metadata_change');
    expect(leftHistory!.created_by).toBe(actorUserId);
    const leftMeta = leftHistory!.metadata as Record<string, unknown>;
    expect(leftMeta?.['pairId']).toBe(seed.pairId);
    expect(leftMeta?.['peerId']).toBe(seed.rightId);

    expect(rightHistory).toBeTruthy();
    expect(rightHistory!.change_type).toBe('metadata_change');
    expect(rightHistory!.created_by).toBe(actorUserId);
    const rightMeta = rightHistory!.metadata as Record<string, unknown>;
    expect(rightMeta?.['pairId']).toBe(seed.pairId);
    expect(rightMeta?.['peerId']).toBe(seed.leftId);
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC10 — Empty state present.
  //
  // When the threshold is set to a value high enough that no pairs
  // surface, the dashboard renders the empty-state panel (§6.3) — not
  // an empty table.
  //
  // Approach: drive the slider to its upper bound (0.99 — the
  // THRESHOLD_MAX in `near-duplicates-filter-bar.tsx`). The fixture's
  // SIM_HIGH=0.97±0.005 pairs land at most ~0.975, so at threshold 0.99
  // none of them surface. Other staging data is unlikely to exceed
  // 0.99 — and if it did, the test would fail honestly per
  // `feedback_e2e_no_workarounds`.
  //
  // This test does NOT need per-test seeded subjects — it relies on the
  // worker fixture's pairs all being below the 0.99 threshold.
  // ─────────────────────────────────────────────────────────────────────
  test('AC10 — empty state renders at upper threshold (no pairs surface)', async ({
    authenticatedPage: page,
    adminDedupFixture,
  }) => {
    // Touch the fixture so Playwright runs the worker-scoped seed before
    // this test executes (without the fixture import the page might load
    // before any seed completes — defensive even though we don't read
    // any fixture-derived id below).
    expect(adminDedupFixture.runId).toBeTruthy();

    await page.goto('/admin/content-dedup/near-duplicates');
    await expect(
      page.getByRole('heading', { name: /Near-Duplicate Review/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Set the slider to its upper bound (THRESHOLD_MAX = 0.99). Wait for
    // the route's GET to commit at threshold=0.99 so the rendered list
    // reflects the new threshold before we assert empty state.
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(PAIRS_LIST_URL) &&
        resp.url().includes('threshold=0.99') &&
        resp.request().method() === 'GET',
      { timeout: 15_000 },
    );

    await setThresholdSlider(page, 0.99);
    const resp = await responsePromise;
    expect(resp.status()).toBe(200);

    // Threshold label committed to 0.99.
    await expect(
      page.getByTestId('near-dup-threshold-value').first(),
    ).toHaveText('0.99');

    // Empty-state panel is the spec §6.3 region with the
    // `near-dup-empty-heading` h2. It includes the active threshold
    // value formatted as 0.99 (2dp via `threshold.toFixed(2)`).
    const emptyHeading = page.getByRole('heading', {
      name: /No near-duplicate pairs above threshold 0\.99/i,
    });
    await expect(emptyHeading).toBeVisible({ timeout: 15_000 });

    // Empty-state region carries role=region + aria-labelledby pointing
    // at the heading (per `near-duplicates-empty-state.tsx`).
    const emptyRegion = page.getByRole('region', {
      name: /No near-duplicate pairs above threshold 0\.99/i,
    });
    await expect(emptyRegion).toBeVisible();

    // Crucially: NO pair table headers. A rendered (but empty) table
    // would still show the "Similarity / Pair / Action" thead — the
    // empty-state panel is mutually exclusive with the table card.
    // The list component renders one or the other (`stablePairs.length
    // === 0 ? <NearDuplicatesEmptyState /> : <Card ...>`), so the table
    // role MUST NOT be present.
    await expect(
      page.getByRole('table', { name: /Near-duplicate candidate pairs/i }),
    ).not.toBeVisible();

    // Sanity: pair-count label announces "0 candidate pairs ≥ 0.99".
    const countLabel = page.getByTestId('near-dup-pair-count').first();
    await expect(countLabel).toContainText(/0\s+candidate pairs/);
  });
});
