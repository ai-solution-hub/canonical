/**
 * §1.7 Admin Cross-System Dedup Review — mutating-action E2E spec (S214B WP3).
 *
 * Covers acceptance criteria from `docs/specs/§1.7-admin-dedup-review-spec.md`
 * §8:
 *   - AC4 — Confirm-duplicate archives + flips status; content_history row
 *           with `change_reason='dedup_admin_review_confirmed_duplicate'`.
 *   - AC5 — Confirm-unique flips status only (archived_at stays NULL);
 *           content_history row with
 *           `change_reason='dedup_admin_review_confirmed_unique'`.
 *   - AC6 — Supersede invokes setSupersession() in both directions:
 *           Direction A (canonical-supersedes-subject — default): subject
 *             gets `superseded_by ← canonicalId`, `dedup_status='superseded'`;
 *             1 content_history row against subject.
 *           Direction B (subject-supersedes-canonical): canonical gets
 *             `superseded_by ← subjectId`, `dedup_status='superseded'`;
 *             subject's `dedup_status` flips to `'confirmed_unique'`;
 *             2 content_history rows (one per pair member).
 *           Pre-helper SAME_ID guard returns 400 with code
 *             `SAME_ID_PRE_HELPER`.
 *   - AC7 — Audit trail correct (covered through per-action audit
 *           assertions in AC4/AC5/AC6).
 *
 * Per-test isolation: each mutating test seeds a fresh subject+canonical
 * pair on the `content_items` table tagged with a unique
 * `metadata.e2e_dedup_fixture_run_id`. The worker-scoped fixture
 * (`adminDedupFixture`) is deliberately NOT consumed here — those slots
 * are reserved for read-only render tests (per
 * `docs/audits/s213b-admin-dedup-fixtures-design.md` §9.5). Cleanup runs
 * in `afterEach` via the service-role client; a tag-based safety net via
 * `globalTeardown` catches any leaked rows.
 *
 * Memory references:
 *   - `feedback_e2e_no_workarounds`: real fixtures + hard expects only.
 *   - `feedback_e2e_conditional_false_pass`: NO `if (await x.isVisible()...)`
 *     fallbacks — every assertion is a hard expect.
 *   - `feedback_brief_quote_spec_verbatim`: AC text quoted verbatim from
 *     §1.7 spec §8.
 *   - `feedback_content_text_hash_generated_always`: omit
 *     `content_text_hash` from inserts (PG computes via md5(normalised)).
 *   - `feedback_content_history_change_reason_mandatory`: every audit row
 *     check asserts an explicit, category-specific change_reason.
 */
import { mergeTests, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { test as authTest } from '../fixtures';
import { test as adminDedupTest } from '../fixtures/admin-dedup-fixture';
import { createServiceClient } from '../fixtures/supabase';

const test = mergeTests(authTest, adminDedupTest);

// ---------------------------------------------------------------------------
// Per-test seed helpers (option-(a) inline — avoids shared API surface
// expansion since both spec files have distinct seed shapes).
// ---------------------------------------------------------------------------

interface SeededQueuePair {
  runId: string;
  subjectId: string;
  canonicalId: string;
  /** Both rows' tracked IDs for FK-safe afterEach cleanup. */
  seededIds: string[];
  /** UUID written to content_items.created_by — used in audit assertions. */
  actorUserId: string;
}

/** Generate a per-test unique runId. Pattern matches helpers' generateRunId. */
function newRunId(): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(3).toString('hex');
  return `s214b-wp3-${ts}-${rand}`;
}

/** Resolve the admin actor UUID — same pattern as fixture helpers'. */
async function resolveAdminActorId(
  supabase: SupabaseClient,
): Promise<string> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('role', 'admin')
    .limit(1)
    .single();

  if (error || !data?.user_id) {
    throw new Error(
      'admin-dedup-actions: no admin user found in user_roles. ' +
        `Run \`bun run seed:e2e-users\` to provision test users. ` +
        `Underlying error: ${error?.message ?? 'no rows returned'}`,
    );
  }
  return data.user_id as string;
}

/**
 * Seed a fresh subject+canonical pair for a §1.7 mutating test.
 *
 * Both rows share `content` so PG's GENERATED ALWAYS `content_text_hash`
 * collides between them — the detail route's RPC fallback can resolve the
 * canonical from the subject's hash. The subject also carries
 * `metadata.suspected_duplicate_of=canonicalId` so the metadata path is
 * exercised (matches the production soft-block stamping pattern).
 *
 * Critical invariants (per `feedback_content_text_hash_generated_always`
 * + helpers' precedent):
 *   - `content_text_hash` is OMITTED from the payload (PG computes it).
 *   - Subject's `dedup_status='suspected_duplicate'` (gates the queue +
 *     all three action-route idempotency checks).
 *   - Both rows' `metadata.e2e_dedup_fixture_run_id` is the unique runId
 *     so globalTeardown can sweep on tag if afterEach somehow misses.
 */
async function seedQueuePair(
  supabase: SupabaseClient,
  actorUserId: string,
  runId: string,
  slot: string,
): Promise<SeededQueuePair> {
  // Both rows share `content` so md5(normalised) collides on the GENERATED
  // ALWAYS `content_text_hash` column.
  const sharedContent =
    `Per-test fixture for ${slot} action (run=${runId}). ` +
    'Deterministic content body so the canonical/subject pair shares a ' +
    'content_text_hash via PG GENERATED ALWAYS computation.';

  // Insert canonical first (clean status) so we have its id to stamp into
  // subject's metadata.suspected_duplicate_of.
  const { data: canonicalRow, error: canonicalErr } = await supabase
    .from('content_items')
    .insert({
      title: `[E2E-WP3-${runId}] ${slot} canonical`,
      content: sharedContent,
      content_type: 'article',
      dedup_status: 'clean',
      primary_domain: 'Service Delivery',
      ingest_source: 'manual',
      created_by: actorUserId,
      updated_by: actorUserId,
      content_owner_id: actorUserId,
      metadata: {
        e2e_dedup_fixture_run_id: runId,
        e2e_dedup_fixture_slot: `${slot}-canonical`,
      },
    })
    .select('id')
    .single();

  if (canonicalErr || !canonicalRow) {
    throw new Error(
      `seedQueuePair: canonical insert failed — ${canonicalErr?.message ?? 'no row returned'}`,
    );
  }
  const canonicalId = canonicalRow.id as string;

  // Subject row — suspected_duplicate, with metadata.suspected_duplicate_of
  // pointing at the canonical (matches production soft-block stamp shape).
  const { data: subjectRow, error: subjectErr } = await supabase
    .from('content_items')
    .insert({
      title: `[E2E-WP3-${runId}] ${slot} subject`,
      content: sharedContent,
      content_type: 'article',
      dedup_status: 'suspected_duplicate',
      primary_domain: 'Service Delivery',
      ingest_source: 'manual',
      created_by: actorUserId,
      updated_by: actorUserId,
      content_owner_id: actorUserId,
      metadata: {
        e2e_dedup_fixture_run_id: runId,
        e2e_dedup_fixture_slot: `${slot}-subject`,
        suspected_duplicate_of: canonicalId,
      },
    })
    .select('id')
    .single();

  if (subjectErr || !subjectRow) {
    // Roll back the canonical insert before throwing so we never leak the
    // canonical row when the subject insert fails.
    await supabase.from('content_items').delete().eq('id', canonicalId);
    throw new Error(
      `seedQueuePair: subject insert failed — ${subjectErr?.message ?? 'no row returned'}`,
    );
  }
  const subjectId = subjectRow.id as string;

  return {
    runId,
    subjectId,
    canonicalId,
    seededIds: [canonicalId, subjectId],
    actorUserId,
  };
}

/**
 * FK-safe cleanup for a per-test seed. Order matches
 * `cleanupAdminDedupFixtures` in `admin-dedup-fixture-helpers.ts`:
 *   1. Clear self-FK `superseded_by` on either row (set by supersede tests).
 *   2. Delete content_chunks (none seeded but defensive).
 *   3. Delete content_history (auto_v1_on_insert + action-handler writes).
 *   4. Delete content_items.
 */
async function cleanupSeededIds(
  supabase: SupabaseClient,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;

  // Clear self-FK first — supersede tests populate superseded_by between
  // these rows, and the `content_items.id <- superseded_by` FK would
  // otherwise block the delete.
  await supabase
    .from('content_items')
    .update({ superseded_by: null })
    .in('id', ids);

  await supabase.from('content_chunks').delete().in('content_item_id', ids);
  await supabase.from('content_history').delete().in('content_item_id', ids);
  await supabase.from('content_items').delete().in('id', ids);
}

// ---------------------------------------------------------------------------
// Spec body
// ---------------------------------------------------------------------------

test.describe('Admin Dedup Actions — §1.7 mutating actions', () => {
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
  // AC4 — Confirm-duplicate archives + flips status.
  //
  // Click `Confirm duplicate` → POST → subject row gets archived_at +
  // archived_by + archive_reason populated, dedup_status flips to
  // 'confirmed_duplicate'. UI redirects to queue with subject removed.
  //
  // Audit row assertion: content_history insert with
  // change_reason='dedup_admin_review_confirmed_duplicate', created_by=admin.
  // ─────────────────────────────────────────────────────────────────────
  test('AC4 — confirm-duplicate archives subject + flips status + writes audit', async ({
    authenticatedPage: page,
  }) => {
    const seed = await seedQueuePair(
      supabase,
      actorUserId,
      newRunId(),
      'confirm-duplicate',
    );
    perTestSeededIds = seed.seededIds;

    // Drive the action through the UI — the action button POSTs to the
    // route and on success router.push()es back to the queue.
    await page.goto(`/admin/content-dedup/${seed.subjectId}`);
    await expect(
      page.getByRole('heading', { name: /Resolve duplicate/i }),
    ).toBeVisible({ timeout: 15_000 });

    const responsePromise = page.waitForResponse(
      (resp) =>
        resp
          .url()
          .endsWith(
            `/api/admin/content-dedup/${seed.subjectId}/confirm-duplicate`,
          ) && resp.request().method() === 'POST',
      { timeout: 15_000 },
    );

    await page.getByTestId('dedup-confirm-duplicate').click();

    const resp = await responsePromise;
    expect(resp.status()).toBe(200);

    // UI redirected back to the queue list view.
    await page.waitForURL('**/admin/content-dedup', { timeout: 15_000 });

    // Hard DB assertion — subject is now archived + confirmed_duplicate.
    const { data: postSubject, error: postSubjectErr } = await supabase
      .from('content_items')
      .select('id, dedup_status, archived_at, archived_by, archive_reason')
      .eq('id', seed.subjectId)
      .single();
    expect(postSubjectErr, postSubjectErr?.message).toBeNull();
    expect(postSubject).toBeTruthy();
    expect(postSubject!.dedup_status).toBe('confirmed_duplicate');
    expect(postSubject!.archived_at).not.toBeNull();
    expect(postSubject!.archived_by).toBe(actorUserId);
    expect(postSubject!.archive_reason).toBe('dedup_admin_confirmed_duplicate');

    // Hard audit-row assertion (AC7 covered through this) — explicit
    // content_history insert with the per-action change_reason constant.
    const { data: historyRows, error: historyErr } = await supabase
      .from('content_history')
      .select('content_item_id, change_reason, change_type, created_by')
      .eq('content_item_id', seed.subjectId)
      .eq('change_reason', 'dedup_admin_review_confirmed_duplicate');
    expect(historyErr, historyErr?.message).toBeNull();
    expect(historyRows).toHaveLength(1);
    expect(historyRows![0].change_type).toBe('archive');
    expect(historyRows![0].created_by).toBe(actorUserId);
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC5 — Confirm-unique flips status only.
  //
  // Click `Confirm unique` → POST → subject dedup_status='confirmed_unique',
  // archived_at IS NULL, row remains in default search.
  //
  // Audit row assertion: content_history insert with
  // change_reason='dedup_admin_review_confirmed_unique'.
  // ─────────────────────────────────────────────────────────────────────
  test('AC5 — confirm-unique flips status only + writes audit', async ({
    authenticatedPage: page,
  }) => {
    const seed = await seedQueuePair(
      supabase,
      actorUserId,
      newRunId(),
      'confirm-unique',
    );
    perTestSeededIds = seed.seededIds;

    await page.goto(`/admin/content-dedup/${seed.subjectId}`);
    await expect(
      page.getByRole('heading', { name: /Resolve duplicate/i }),
    ).toBeVisible({ timeout: 15_000 });

    const responsePromise = page.waitForResponse(
      (resp) =>
        resp
          .url()
          .endsWith(
            `/api/admin/content-dedup/${seed.subjectId}/confirm-unique`,
          ) && resp.request().method() === 'POST',
      { timeout: 15_000 },
    );

    await page.getByTestId('dedup-confirm-unique').click();

    const resp = await responsePromise;
    expect(resp.status()).toBe(200);

    await page.waitForURL('**/admin/content-dedup', { timeout: 15_000 });

    // Hard DB assertion — confirmed_unique, NOT archived.
    const { data: postSubject, error: postSubjectErr } = await supabase
      .from('content_items')
      .select('id, dedup_status, archived_at')
      .eq('id', seed.subjectId)
      .single();
    expect(postSubjectErr, postSubjectErr?.message).toBeNull();
    expect(postSubject).toBeTruthy();
    expect(postSubject!.dedup_status).toBe('confirmed_unique');
    expect(postSubject!.archived_at).toBeNull();

    // Audit-row assertion (AC7 coverage).
    const { data: historyRows, error: historyErr } = await supabase
      .from('content_history')
      .select('content_item_id, change_reason, change_type, created_by')
      .eq('content_item_id', seed.subjectId)
      .eq('change_reason', 'dedup_admin_review_confirmed_unique');
    expect(historyErr, historyErr?.message).toBeNull();
    expect(historyRows).toHaveLength(1);
    expect(historyRows![0].change_type).toBe('metadata_change');
    expect(historyRows![0].created_by).toBe(actorUserId);
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC6a — Supersede direction A (default — canonical-supersedes-subject).
  //
  // Subject's superseded_by ← canonicalId; subject's dedup_status ←
  // 'superseded'. Response body shape (per spec §8 AC6 verbatim):
  //   { pathId, retiredId: subject.id, canonicalId,
  //     direction: 'canonical-supersedes-subject',
  //     retiredDedupStatus: 'superseded' }
  // (no `pathDedupStatus` in direction A).
  //
  // Audit row assertion: 1 content_history row against subject with
  // change_reason='dedup_admin_review_superseded', change_type='merge'.
  // ─────────────────────────────────────────────────────────────────────
  test('AC6a — supersede direction A retires subject; 1 audit row', async ({
    authenticatedPage: page,
  }) => {
    const seed = await seedQueuePair(
      supabase,
      actorUserId,
      newRunId(),
      'supersede-direction-a',
    );
    perTestSeededIds = seed.seededIds;

    await page.goto(`/admin/content-dedup/${seed.subjectId}`);
    await expect(
      page.getByRole('heading', { name: /Resolve duplicate/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Open the supersede dialog. Default radio selection is direction-A
    // (`canonical-supersedes-subject`) per the action-buttons component.
    await page.getByTestId('dedup-supersede-trigger').click();

    // Verify the default radio is the canonical-supersedes-subject one.
    await expect(
      page.getByTestId('supersede-direction-canonical-supersedes-subject'),
    ).toBeChecked();

    const responsePromise = page.waitForResponse(
      (resp) =>
        resp
          .url()
          .endsWith(`/api/admin/content-dedup/${seed.subjectId}/supersede`) &&
        resp.request().method() === 'POST',
      { timeout: 15_000 },
    );

    await page.getByTestId('supersede-confirm').click();

    const resp = await responsePromise;
    expect(resp.status()).toBe(200);

    // Direction-A response shape — no pathDedupStatus per spec §8 AC6.
    const respBody = (await resp.json()) as {
      pathId: string;
      retiredId: string;
      canonicalId: string;
      direction: string;
      retiredDedupStatus: string;
      pathDedupStatus?: string;
    };
    expect(respBody.pathId).toBe(seed.subjectId);
    expect(respBody.retiredId).toBe(seed.subjectId);
    expect(respBody.canonicalId).toBe(seed.canonicalId);
    expect(respBody.direction).toBe('canonical-supersedes-subject');
    expect(respBody.retiredDedupStatus).toBe('superseded');
    expect(respBody.pathDedupStatus).toBeUndefined();

    await page.waitForURL('**/admin/content-dedup', { timeout: 15_000 });

    // Hard DB assertion — subject retired, canonical untouched.
    const { data: postRows, error: postErr } = await supabase
      .from('content_items')
      .select('id, dedup_status, superseded_by')
      .in('id', [seed.subjectId, seed.canonicalId]);
    expect(postErr, postErr?.message).toBeNull();
    const postSubject = postRows!.find((r) => r.id === seed.subjectId);
    const postCanonical = postRows!.find((r) => r.id === seed.canonicalId);
    expect(postSubject).toBeTruthy();
    expect(postSubject!.dedup_status).toBe('superseded');
    expect(postSubject!.superseded_by).toBe(seed.canonicalId);
    expect(postCanonical).toBeTruthy();
    // Canonical is untouched (still 'clean', no superseded_by).
    expect(postCanonical!.dedup_status).toBe('clean');
    expect(postCanonical!.superseded_by).toBeNull();

    // Audit-row assertion — 1 row against subject with merge + supersede.
    const { data: historyRows, error: historyErr } = await supabase
      .from('content_history')
      .select(
        'content_item_id, change_reason, change_type, created_by, metadata',
      )
      .eq('content_item_id', seed.subjectId)
      .eq('change_reason', 'dedup_admin_review_superseded');
    expect(historyErr, historyErr?.message).toBeNull();
    expect(historyRows).toHaveLength(1);
    expect(historyRows![0].change_type).toBe('merge');
    expect(historyRows![0].created_by).toBe(actorUserId);
    // metadata.direction is the spec-canonical direction string.
    const meta = historyRows![0].metadata as Record<string, unknown>;
    expect(meta?.['direction']).toBe('canonical-supersedes-subject');
    expect(meta?.['peerId']).toBe(seed.canonicalId);
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC6b — Supersede direction B (subject-supersedes-canonical).
  //
  // Canonical's superseded_by ← subjectId; canonical's dedup_status ←
  // 'superseded'. Subject's dedup_status flips to 'confirmed_unique' so
  // the queue clears. Response body adds `pathDedupStatus: 'confirmed_unique'`.
  //
  // Audit row assertion: 2 content_history rows total (one per pair member),
  // both with change_reason='dedup_admin_review_superseded'.
  //   - canonical row: change_type='merge'
  //   - subject row: change_type='metadata_change',
  //                  metadata.resolution='kept_as_canonical'.
  // ─────────────────────────────────────────────────────────────────────
  test('AC6b — supersede direction B retires canonical; 2 audit rows', async ({
    authenticatedPage: page,
  }) => {
    const seed = await seedQueuePair(
      supabase,
      actorUserId,
      newRunId(),
      'supersede-direction-b',
    );
    perTestSeededIds = seed.seededIds;

    await page.goto(`/admin/content-dedup/${seed.subjectId}`);
    await expect(
      page.getByRole('heading', { name: /Resolve duplicate/i }),
    ).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('dedup-supersede-trigger').click();

    // Flip the radio to direction B.
    await page
      .getByTestId('supersede-direction-subject-supersedes-canonical')
      .click();
    await expect(
      page.getByTestId('supersede-direction-subject-supersedes-canonical'),
    ).toBeChecked();

    const responsePromise = page.waitForResponse(
      (resp) =>
        resp
          .url()
          .endsWith(`/api/admin/content-dedup/${seed.subjectId}/supersede`) &&
        resp.request().method() === 'POST',
      { timeout: 15_000 },
    );

    await page.getByTestId('supersede-confirm').click();

    const resp = await responsePromise;
    expect(resp.status()).toBe(200);

    // Direction-B response shape — pathDedupStatus='confirmed_unique'.
    const respBody = (await resp.json()) as {
      pathId: string;
      retiredId: string;
      canonicalId: string;
      direction: string;
      retiredDedupStatus: string;
      pathDedupStatus?: string;
    };
    expect(respBody.pathId).toBe(seed.subjectId);
    expect(respBody.retiredId).toBe(seed.canonicalId);
    expect(respBody.canonicalId).toBe(seed.canonicalId);
    expect(respBody.direction).toBe('subject-supersedes-canonical');
    expect(respBody.retiredDedupStatus).toBe('superseded');
    expect(respBody.pathDedupStatus).toBe('confirmed_unique');

    await page.waitForURL('**/admin/content-dedup', { timeout: 15_000 });

    // Hard DB assertion — canonical retired, subject confirmed_unique.
    const { data: postRows, error: postErr } = await supabase
      .from('content_items')
      .select('id, dedup_status, superseded_by')
      .in('id', [seed.subjectId, seed.canonicalId]);
    expect(postErr, postErr?.message).toBeNull();
    const postSubject = postRows!.find((r) => r.id === seed.subjectId);
    const postCanonical = postRows!.find((r) => r.id === seed.canonicalId);
    expect(postSubject).toBeTruthy();
    expect(postSubject!.dedup_status).toBe('confirmed_unique');
    expect(postSubject!.superseded_by).toBeNull();
    expect(postCanonical).toBeTruthy();
    expect(postCanonical!.dedup_status).toBe('superseded');
    expect(postCanonical!.superseded_by).toBe(seed.subjectId);

    // Audit-row assertion — 2 rows total under change_reason='_superseded':
    //   - canonical (retired side): change_type='merge'
    //   - subject (kept side): change_type='metadata_change',
    //                          metadata.resolution='kept_as_canonical'.
    const { data: historyRows, error: historyErr } = await supabase
      .from('content_history')
      .select(
        'content_item_id, change_reason, change_type, created_by, metadata',
      )
      .in('content_item_id', [seed.subjectId, seed.canonicalId])
      .eq('change_reason', 'dedup_admin_review_superseded');
    expect(historyErr, historyErr?.message).toBeNull();
    expect(historyRows).toHaveLength(2);

    const canonicalHistory = historyRows!.find(
      (r) => r.content_item_id === seed.canonicalId,
    );
    const subjectHistory = historyRows!.find(
      (r) => r.content_item_id === seed.subjectId,
    );
    expect(canonicalHistory).toBeTruthy();
    expect(canonicalHistory!.change_type).toBe('merge');
    expect(canonicalHistory!.created_by).toBe(actorUserId);
    const canonicalMeta = canonicalHistory!.metadata as Record<string, unknown>;
    expect(canonicalMeta?.['direction']).toBe('subject-supersedes-canonical');
    expect(canonicalMeta?.['peerId']).toBe(seed.subjectId);

    expect(subjectHistory).toBeTruthy();
    expect(subjectHistory!.change_type).toBe('metadata_change');
    expect(subjectHistory!.created_by).toBe(actorUserId);
    const subjectMeta = subjectHistory!.metadata as Record<string, unknown>;
    expect(subjectMeta?.['direction']).toBe('subject-supersedes-canonical');
    expect(subjectMeta?.['peerId']).toBe(seed.canonicalId);
    expect(subjectMeta?.['resolution']).toBe('kept_as_canonical');
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC6 guard — pre-helper SAME_ID returns 400 with code SAME_ID_PRE_HELPER.
  //
  // Posted directly via page.request because the UI never lets the admin
  // submit a self-supersede (canonicalId is fixed to the canonical row's
  // id from the detail query). Asserting the route's guard here matches
  // the spec §5.3 + §8 AC6 verbatim contract.
  // ─────────────────────────────────────────────────────────────────────
  test('AC6 guard — canonicalId === path id returns 400 SAME_ID_PRE_HELPER', async ({
    authenticatedPage: page,
  }) => {
    const seed = await seedQueuePair(
      supabase,
      actorUserId,
      newRunId(),
      'supersede-same-id-guard',
    );
    perTestSeededIds = seed.seededIds;

    // Visit the queue first so the page's auth cookies are attached to
    // the API request that follows.
    await page.goto('/admin/content-dedup');
    await expect(
      page.getByRole('heading', { name: /Cross-System Dedup Review/i }),
    ).toBeVisible({ timeout: 15_000 });

    const resp = await page.request.post(
      `/api/admin/content-dedup/${seed.subjectId}/supersede`,
      {
        data: {
          canonicalId: seed.subjectId, // intentional self-supersede
          direction: 'canonical-supersedes-subject',
        },
      },
    );

    expect(resp.status()).toBe(400);
    const body = (await resp.json()) as { error: string; code: string };
    expect(body.code).toBe('SAME_ID_PRE_HELPER');

    // Subject is unchanged — still suspected_duplicate, no superseded_by.
    const { data: postSubject } = await supabase
      .from('content_items')
      .select('dedup_status, superseded_by')
      .eq('id', seed.subjectId)
      .single();
    expect(postSubject!.dedup_status).toBe('suspected_duplicate');
    expect(postSubject!.superseded_by).toBeNull();

    // No content_history audit row written.
    const { data: historyRows } = await supabase
      .from('content_history')
      .select('id')
      .eq('content_item_id', seed.subjectId)
      .eq('change_reason', 'dedup_admin_review_superseded');
    expect(historyRows ?? []).toHaveLength(0);
  });
});
