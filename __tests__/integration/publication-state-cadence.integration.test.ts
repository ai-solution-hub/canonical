/**
 * §5.2 Phase 5 — AC5.5 cross-feature integration test (S216 W6).
 *
 * Spec section 9.5 (line 1624, verbatim):
 *   "After §5.5 ships + §5.2 Phase 3: archived items NOT flagged by
 *    cadence cron (archived items excluded from
 *    `next_review_date < CURRENT_DATE` query)"
 *
 * What this test asserts:
 *
 *   Two items are seeded with `next_review_date < TODAY`:
 *     - Item A: published, archived_at IS NULL, governance_review_status='approved'.
 *       This is a textbook cadence cron candidate — MUST be flagged
 *       'review_overdue' post-cron.
 *     - Item B: same as A, but seeded with publication_status='archived'.
 *       The §6.6 BIDIRECTIONAL trigger Direction 1 also stamps
 *       archived_at on B (so the legacy `archived_at IS NULL` filter
 *       alone would already exclude B). The new
 *       `publication_status != 'archived'` filter (§6.4 Phase 5 wiring)
 *       is the belt-and-braces filter under test here.
 *       Post-cron: B's governance_review_status MUST remain unchanged.
 *
 * The test invokes the production GET handler for
 * `/api/cron/review-cadence` directly, with a real `Bearer ${CRON_SECRET}`
 * authorization header. The cron is global (no workspace scope), so other
 * test data with past `next_review_date` may inflate `items_flagged` —
 * assertions on the test rows use re-fetch-by-ID, not global counts
 * (mirroring `review-cadence-lifecycle.integration.test.ts` T3 pattern).
 *
 * Spec sources:
 *   - §6.4 lines 986-1011 — §5.5 cadence cron exclusion concrete coordination
 *   - §9.5 line 1624 — AC5.5 verbatim
 *   - §10.5 lines 1848-1869 — Phase 5 plan
 *
 * Prereqs:
 *   - `.env.local` with NEXT_PUBLIC_SUPABASE_URL,
 *     SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, TEST_USER_1_PASSWORD.
 *   - Migration 20260427141627 (Phase 1g §6.6 trigger) applied.
 *   - §5.5 Phase 1 schema is live (governance_review_status CHECK
 *     includes 'review_overdue').
 *
 * Runs via: `bun run test:integration -- publication-state-cadence`
 *   (NOT picked up by `bun run test`; integration runner only — see
 *   feedback_test_runners_split + feedback_integration_test_location.)
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serviceClient } from './helpers/service-client';
import { randomUUID } from 'crypto';

// Import the cron handler dynamically AFTER env is loaded by service-client.
// service-client eagerly loads dotenv, so this is the safe pattern (same
// as review-cadence-lifecycle.integration.test.ts:94).
const { GET: cronReviewCadenceGET } = await import(
  '@/app/api/cron/review-cadence/route'
);
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RUN_PREFIX = `S216-W6-AC5.5-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PAST_REVIEW_DATE = '2025-01-01';
const REVIEW_CADENCE_DAYS = 180;

// ---------------------------------------------------------------------------
// Env-gated skip
// ---------------------------------------------------------------------------

const HAS_REQUIRED_ENV = Boolean(
  process.env.CRON_SECRET &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.TEST_USER_1_PASSWORD,
);
const describeIfEnv = HAS_REQUIRED_ENV ? describe : describe.skip;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const seededIds: string[] = [];
let TEST_USER_1_ID = '';
let itemA = ''; // published, overdue → MUST be flagged
let itemB = ''; // archived, overdue → MUST NOT be flagged

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveAdminUserId(): Promise<string> {
  const adminEmail =
    process.env.TEST_USER_1_EMAIL ?? 'test.user1@test-kb-aish.co.uk';
  const { data: userList, error } =
    await serviceClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
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

interface SeedItemParams {
  label: string;
  publicationStatus: 'published' | 'archived';
}

async function seedOverdueItem({
  label,
  publicationStatus,
}: SeedItemParams): Promise<string> {
  // GENERATED ALWAYS column `content_text_hash` MUST be omitted (CLAUDE.md
  // gotcha `feedback_content_text_hash_generated_always`).
  // INSERT does NOT fire BEFORE UPDATE on the inserted row, so seeding with
  // publication_status='archived' requires explicit archived_at to uphold
  // the §6.6 invariant on the seed row (mirrors W1 archive-trigger-coverage
  // seedItem helper).
  const archiveMetadata =
    publicationStatus === 'archived'
      ? {
          archived_at: new Date().toISOString(),
          archived_by: TEST_USER_1_ID,
          archive_reason: `${RUN_PREFIX} — seeded archive for AC5.5 fixture`,
        }
      : {};

  const seedSlug = randomUUID();
  const { data, error } = await serviceClient
    .from('content_items')
    .insert({
      title: `${RUN_PREFIX} ${label}`,
      content: `AC5.5 cadence cron exclusion fixture: ${label} (${RUN_PREFIX}). Disposable.`,
      content_type: 'article',
      next_review_date: PAST_REVIEW_DATE,
      review_cadence_days: REVIEW_CADENCE_DAYS,
      governance_review_status: 'approved',
      content_owner_id: TEST_USER_1_ID,
      publication_status: publicationStatus,
      verified_at: null,
      metadata: { test_run: RUN_PREFIX, seed_slug: seedSlug },
      ...archiveMetadata,
    })
    .select('id, publication_status, archived_at, governance_review_status')
    .single();

  if (error || !data) {
    throw new Error(
      `Seed item "${label}" failed: ${error?.message ?? 'no data'}`,
    );
  }
  if (data.publication_status !== publicationStatus) {
    throw new Error(
      `Seed item "${label}" baseline drift: requested ${publicationStatus}, got ${data.publication_status}`,
    );
  }
  if (publicationStatus === 'archived' && data.archived_at === null) {
    throw new Error(
      `Seed item "${label}" baseline drift: archived item must have archived_at set`,
    );
  }
  if (data.governance_review_status !== 'approved') {
    throw new Error(
      `Seed item "${label}" baseline drift: requested status='approved', got ${data.governance_review_status}`,
    );
  }
  seededIds.push(data.id);
  return data.id;
}

async function readGovernanceStatus(itemId: string): Promise<string | null> {
  const { data, error } = await serviceClient
    .from('content_items')
    .select('governance_review_status')
    .eq('id', itemId)
    .single();
  if (error || !data) {
    throw new Error(`readGovernanceStatus failed: ${error?.message ?? 'no data'}`);
  }
  return data.governance_review_status;
}

function buildCronRequest(): NextRequest {
  return new NextRequest('http://localhost/api/cron/review-cadence', {
    headers: {
      authorization: `Bearer ${process.env.CRON_SECRET}`,
    },
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!HAS_REQUIRED_ENV) return;
  TEST_USER_1_ID = await resolveAdminUserId();
  // Seed the published-overdue control case first, then the archived-overdue
  // case under test.
  itemA = await seedOverdueItem({
    label: 'A (published, overdue, MUST be flagged)',
    publicationStatus: 'published',
  });
  itemB = await seedOverdueItem({
    label: 'B (archived, overdue, MUST NOT be flagged)',
    publicationStatus: 'archived',
  });
}, 60_000);

afterAll(async () => {
  if (seededIds.length === 0) return;
  // Clean up notifications first — entity_id is polymorphic with no FK
  // cascade, so they would otherwise leak (mirrors review-cadence-lifecycle).
  for (const itemId of seededIds) {
    await serviceClient.from('notifications').delete().eq('entity_id', itemId);
  }
  // content_history rows are emitted by AFTER INSERT trigger; clean before
  // the parent row.
  await serviceClient
    .from('content_history')
    .delete()
    .in('content_item_id', seededIds);
  await serviceClient.from('content_items').delete().in('id', seededIds);
}, 30_000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeIfEnv(
  'AC5.5 — review-cadence cron excludes archived items',
  () => {
    it(
      'cron flags A (published, overdue) AND skips B (archived, overdue)',
      async () => {
        // Pre-conditions: both items are 'approved' before the cron runs.
        expect(await readGovernanceStatus(itemA)).toBe('approved');
        expect(await readGovernanceStatus(itemB)).toBe('approved');

        const res = await cronReviewCadenceGET(buildCronRequest());
        const bodyText = await res.text();
        expect(res.status, `cron failed: ${bodyText}`).toBe(200);

        const body = JSON.parse(bodyText) as {
          success: boolean;
          items_flagged: number;
          notifications_created: number;
        };
        expect(body.success).toBe(true);
        // Global cron — other test data may inflate counts; assert >= 1
        // (mirrors review-cadence-lifecycle.integration.test.ts T3 gotcha).
        expect(body.items_flagged).toBeGreaterThanOrEqual(1);

        // Item A — control: a published-overdue row is flagged.
        const postA = await readGovernanceStatus(itemA);
        expect(
          postA,
          'Item A (published, overdue) MUST be flagged "review_overdue" by the cron',
        ).toBe('review_overdue');

        // Item B — load-bearing: archived-overdue row is NOT flagged.
        // Without the §6.4 `publication_status != 'archived'` filter (or
        // without the §6.6 trigger keeping archived_at in lockstep with
        // publication_status), B would also flip to 'review_overdue'.
        const postB = await readGovernanceStatus(itemB);
        expect(
          postB,
          'Item B (archived, overdue) MUST NOT be flagged — exclusion required by §6.4',
        ).toBe('approved');

        // Defence-in-depth: assert no notification was emitted for B.
        // Item A may or may not have a notification depending on owner
        // resolution; the load-bearing assertion is "B has zero".
        const { data: notificationsB, error: notifBErr } = await serviceClient
          .from('notifications')
          .select('id')
          .eq('entity_id', itemB)
          .eq('type', 'review_overdue');
        expect(notifBErr).toBeNull();
        expect(
          notificationsB ?? [],
          'No "review_overdue" notification should be emitted for an archived item',
        ).toHaveLength(0);
      },
      90_000,
    );
  },
);
