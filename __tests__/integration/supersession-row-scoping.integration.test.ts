/**
 * Supersession UPDATE row-scoping — real-DB integration test (ID-126.1 / bl-114 W-RD').
 *
 * WHY THIS EXISTS (persistence-contract reframe):
 *   `__tests__/lib/supersession/set.test.ts` proves UPDATE row-scoping with a
 *   MOCK-CALL-SHAPE assertion — `expect(updateChain.eq).toHaveBeenCalledWith('id', OLD_ID)`.
 *   That proves the helper's INTENT (the `.eq('id', oldId)` filter is present in the
 *   call chain) but NOT the resulting DB STATE: a mock cannot prove that the
 *   `WHERE id = oldId` predicate actually confined the write to the targeted row.
 *
 *   This test closes that gap against ACTUAL DB state. It seeds THREE rows —
 *   OLD (to be superseded), NEW (the successor), and an UNRELATED SIBLING that
 *   participates in neither side of the supersession — runs the prod helper
 *   `setSupersession`, and asserts via DB READ-BACK that ONLY the OLD row was
 *   mutated. The SIBLING is the load-bearing assertion: it is a non-participant,
 *   so if the `.eq('id', oldId)` predicate were ever dropped (turning the UPDATE
 *   into a table-wide write) this test FAILS where the mock-shape unit test
 *   cannot. The NEW row is also re-asserted untouched for completeness, but the
 *   successor being skipped is a weaker proof than the unrelated sibling because
 *   the helper's `NEW_ALREADY_SUPERSEDED` guard already exercises the newId row.
 *
 *   The unit `.eq` assertion is KEPT (it is a cheap contract proof that runs in
 *   the fast `bun run test` suite, which does NOT run this integration tier);
 *   this test ADDS the real-DB proof rather than replacing it.
 *
 * Prod symbol under test: `lib/supersession/set.ts` → `setSupersession`
 *   (gitnexus impact upstream: LOW risk, direct callers — PATCH /api/items/:id,
 *    MCP supersede_content_item. The admin content-dedup supersede route was
 *    also a caller before it was retired under ID-131.15.)
 *
 * Spec: docs/specs/supersession-model-spec.md §5.4 (UPDATE writes the OLD row only).
 *
 * ID-131.19 M6 retirement note (S450 GO tail): `setSupersession` was
 * ALREADY re-pointed onto `q_a_pairs` at ID-131.37 F1 (owner S446 ruling) —
 * it now reads/writes ONLY `superseded_by` + `publication_status`, the two
 * columns q_a_pairs carries (no `dedup_status`/`archived_at`/`archived_by`/
 * `archive_reason`/`updated_by` — those legs were dropped, not persisted,
 * per set.ts's own ID-131.37 F1 docstring). This fixture re-seeds onto
 * `q_a_pairs` accordingly; the row-scoping assertion (sibling untouched) is
 * unaffected by the narrower column set — it is still the load-bearing
 * proof that `.eq('id', oldId)` confines the UPDATE. `content_items` itself
 * was separately DROPPED at M6 (unrelated but coincident retirement).
 *
 * Prereqs (env-gated skip mirrors publication-state-supersession.integration.test.ts):
 *   - `.env.local` with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *
 * Runs via: `bun run test:integration -- supersession-row-scoping`
 *   (NOT picked up by `bun run test`; integration runner only.)
 *
 * Teardown: every seeded row is tracked in `seededIds` and deleted in
 *   afterAll — NO orphan rows in the prod-acting DB.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serviceClient } from './helpers/service-client';
import { setSupersession } from '@/lib/supersession/set';

// ---------------------------------------------------------------------------
// Constants — unique per run so concurrent/repeated runs never collide.
// ---------------------------------------------------------------------------

const TEST_PREFIX = `[SUPSEDE-SCOPE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const UNIQUE_KEYWORD = `SUPSEDESCOPE${Date.now().toString(36)}`;

// ---------------------------------------------------------------------------
// Env-gated skip.
// ---------------------------------------------------------------------------

const HAS_REQUIRED_ENV = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const describeIfEnv = HAS_REQUIRED_ENV ? describe : describe.skip;

// ---------------------------------------------------------------------------
// State shared across the suite.
// ---------------------------------------------------------------------------

const seededIds: string[] = [];
let actorUserId = '';
let oldId = '';
let newId = '';
let siblingId = '';

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

async function resolveAdminUserId(): Promise<string> {
  const adminEmail =
    process.env.TEST_USER_1_EMAIL ?? 'test.user1@test-kb-aish.co.uk';
  const { data: userList, error } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) {
    throw new Error(`Could not list users: ${error.message}`);
  }
  const userId = userList.users.find((u) => u.email === adminEmail)?.id;
  if (!userId) {
    throw new Error(
      `Could not resolve admin test user from email "${adminEmail}". ` +
        'Ensure .env.local sets TEST_USER_1_EMAIL or seed the canonical fixture.',
    );
  }
  return userId;
}

async function seedItem(label: string): Promise<string> {
  const { data, error } = await serviceClient
    .from('q_a_pairs')
    .insert({
      question_text: `${UNIQUE_KEYWORD} ${TEST_PREFIX} ${label} certification audit question`,
      answer_standard:
        `${UNIQUE_KEYWORD} ${TEST_PREFIX} ${label}. ` +
        'Certification audit fixture for supersession row-scoping integration testing.',
      publication_status: 'published',
    })
    .select('id, publication_status, superseded_by')
    .single();

  if (error || !data) {
    throw new Error(
      `Seed item "${label}" failed: ${error?.message ?? 'no data'}`,
    );
  }
  if (data.publication_status !== 'published') {
    throw new Error(
      `Seed item "${label}" baseline drift: pub=${data.publication_status}`,
    );
  }
  seededIds.push(data.id);
  return data.id;
}

interface RowSnapshot {
  id: string;
  publication_status: string | null;
  superseded_by: string | null;
}

async function readRow(itemId: string): Promise<RowSnapshot> {
  const { data, error } = await serviceClient
    .from('q_a_pairs')
    .select('id, publication_status, superseded_by')
    .eq('id', itemId)
    .single();
  if (error || !data) {
    throw new Error(
      `readRow(${itemId}) failed: ${error?.message ?? 'no data'}`,
    );
  }
  return data as unknown as RowSnapshot;
}

// ---------------------------------------------------------------------------
// Lifecycle.
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!HAS_REQUIRED_ENV) return;
  actorUserId = await resolveAdminUserId();
  oldId = await seedItem('OLD (to be superseded)');
  newId = await seedItem('NEW (successor)');
  siblingId = await seedItem('SIBLING (unrelated, must stay untouched)');
}, 60_000);

afterAll(async () => {
  if (seededIds.length === 0) return;
  await serviceClient.from('q_a_pairs').delete().in('id', seededIds);
}, 30_000);

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describeIfEnv(
  'setSupersession UPDATE is scoped to the OLD row only (real-DB read-back)',
  () => {
    // Snapshot the sibling BEFORE the supersession op so the after-state
    // comparison is exact (not just "looks unchanged").
    let siblingBefore: RowSnapshot | null = null;

    it('all three seeded rows start at the same published, un-superseded baseline', async () => {
      expect(oldId).toBeTruthy();
      expect(newId).toBeTruthy();
      expect(siblingId).toBeTruthy();

      for (const id of [oldId, newId, siblingId]) {
        const row = await readRow(id);
        expect(row.publication_status).toBe('published');
        expect(row.superseded_by).toBeNull();
      }

      siblingBefore = await readRow(siblingId);
    }, 60_000);

    it('the targeted OLD row is superseded and archived after the op', async () => {
      const result = await setSupersession(
        { oldId, newId, actorUserId },
        serviceClient,
      );

      // Helper return contract (ID-131.37 F1) — q_a_pairs archived model:
      // the projection is id/question_text/superseded_by/publication_status
      // only (no dedup_status/archived_at/archived_by/archive_reason/
      // updated_by — q_a_pairs carries none of those columns).
      expect(result.oldItem.id).toBe(oldId);
      expect(result.oldItem.superseded_by).toBe(newId);
      expect(result.oldItem.publication_status).toBe('archived');

      // DB read-back of the OLD row — the write actually landed.
      const post = await readRow(oldId);
      expect(post.superseded_by).toBe(newId);
      expect(post.publication_status).toBe('archived');
    }, 60_000);

    it('the unrelated SIBLING row is byte-for-byte unchanged (proves WHERE id = oldId confined the write)', async () => {
      // THE load-bearing row-scoping assertion. The sibling participates in
      // neither side of the supersession. If `.eq('id', oldId)` were dropped —
      // turning the UPDATE into a table-wide write — the sibling would also be
      // archived/superseded here. The mock-shape unit assertion cannot catch
      // that; this real-DB read-back can.
      expect(siblingBefore).not.toBeNull();
      const siblingAfter = await readRow(siblingId);
      expect(siblingAfter).toEqual(siblingBefore);

      // Explicit per-field guards (defence in depth — toEqual already covers
      // these, but they pin the exact invariant the scoping protects).
      expect(siblingAfter.superseded_by).toBeNull();
      expect(siblingAfter.publication_status).toBe('published');
    }, 60_000);

    it('the successor NEW row is also left untouched by the op', async () => {
      const newRow = await readRow(newId);
      expect(newRow.superseded_by).toBeNull();
      expect(newRow.publication_status).toBe('published');
    }, 60_000);
  },
);
