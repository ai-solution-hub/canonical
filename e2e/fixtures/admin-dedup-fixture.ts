/* eslint-disable @typescript-eslint/no-empty-object-type -- Playwright fixture API requires {} for test-scoped type parameter */
/* eslint-disable react-hooks/rules-of-hooks -- Playwright fixture `use()` is not a React hook */
/**
 * Worker-scoped Playwright fixture for §1.7 + §1.9 admin-dedup E2E tests.
 *
 * Each Playwright worker seeds its own isolated `runId`-tagged dataset using
 * the helpers in `admin-dedup-fixture-helpers.ts`. After the worker finishes,
 * the fixture tears down its rows by `runId`. A globalSetup-level smoke
 * check (`verifySeededPairs`) runs after seed to fail-fast on vector-math
 * drift before any spec executes.
 *
 * Usage in spec files:
 * ```ts
 * import { test, expect } from '@/e2e/fixtures/admin-dedup-fixture';
 *
 * test('queue lists suspected duplicates', async ({ page, adminDedupFixture }) => {
 *   expect(adminDedupFixture.queue.confirmDuplicate.subjectId).toBeTruthy();
 *   await page.goto('/admin/content-dedup');
 *   ...
 * });
 * ```
 *
 * Reference: `docs/audits/s213b-admin-dedup-fixtures-design.md` §3, §6.2.
 */
import { test as base } from '@playwright/test';
import { createServiceClient } from './supabase';
import {
  type AdminDedupFixtureData,
  cleanupAdminDedupFixtures,
  generateRunId,
  seedAdminDedupFixtures,
  verifySeededPairs,
} from './admin-dedup-fixture-helpers';

interface AdminDedupWorkerFixtures {
  /** Pre-seeded §1.7 + §1.9 fixture data for this worker. */
  adminDedupFixture: AdminDedupFixtureData;
}

export const test = base.extend<{}, AdminDedupWorkerFixtures>({
  adminDedupFixture: [
    async ({}, use, workerInfo) => {
      const supabase = createServiceClient();
      const runId = generateRunId(`s213b-w${workerInfo.workerIndex}`);

      console.log(
        `[Worker ${workerInfo.workerIndex}] Seeding admin-dedup fixture run-id=${runId}...`,
      );
      const data = await seedAdminDedupFixtures(supabase, runId);

      // Smoke-check that seeded vectors land at the expected similarity in
      // pgvector. Catches vector-math drift, RPC regressions, or hidden
      // insert-trigger surprises before any spec executes.
      await verifySeededPairs(supabase, data);

      console.log(
        `[Worker ${workerInfo.workerIndex}] Seeded ${data.allIds.length} fixture rows ` +
          `(6 §1.7 pairs + 7 §1.9 pairs) tagged run-id=${runId}.`,
      );

      try {
        await use(data);
      } finally {
        console.log(
          `[Worker ${workerInfo.workerIndex}] Cleaning up admin-dedup fixture run-id=${runId}...`,
        );
        const counts = await cleanupAdminDedupFixtures(supabase, runId);
        console.log(
          `[Worker ${workerInfo.workerIndex}] Cleaned ${counts.deletedContentItems} ` +
            `content_items, ${counts.deletedHistoryRows} history rows, ` +
            `${counts.deletedChunks} chunks.`,
        );
      }
    },
    { scope: 'worker' },
  ],
});

export { expect } from '@playwright/test';
