/**
 * WP-CI.RES.7 §4.2 — Staging fixture generator (main entry point).
 *
 * Orchestrates: reference-data validation → content fixtures → entity
 * fixtures. Designed to be called from scripts/seed-integration-fixtures.ts
 * as a one-time CI setup step (not per-test beforeEach).
 *
 * Spec: wp-ci-res7-staging-data-strategy-spec.md §4.2–§4.5.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { validateReferenceData } from './reference-data-validator';
import {
  seedContentFixtures,
  cleanupContentFixtures,
  FIXTURE_PREFIX,
} from './content-fixtures';
import { seedEntityFixtures } from './entity-fixtures';

export interface FixtureManifest {
  contentItemIds: string[];
  contentChunkIds: string[];
  entityMentionIds: string[];
  entityRelationshipIds: string[];
}

/**
 * Run the full fixture generation pipeline:
 * 1. Validate reference data is populated.
 * 2. Clean up any stale fixtures from a prior run.
 * 3. Seed content_items + content_chunks.
 * 4. Seed entity_mentions + entity_relationships.
 *
 * Returns a manifest of all created IDs for cleanup.
 */
export async function generateFixtures(
  client: SupabaseClient<Database>,
): Promise<FixtureManifest> {
  // Step 1: Validate reference data.
  console.log('[generator] Validating reference data...');
  const validation = await validateReferenceData(client);
  if (!validation.ok) {
    const msg = [
      'Reference-data validation FAILED:',
      ...validation.failures.map((f) => `  - ${f}`),
      '',
      'Run staging-reference-refresh.sh first, or ensure staging DB has reference data.',
    ].join('\n');
    throw new Error(msg);
  }
  console.log('[generator] Reference data validation PASSED.');

  // Step 2: Clean up stale fixtures (idempotent).
  console.log('[generator] Cleaning up stale fixtures...');
  const { data: staleItems } = await client
    .from('content_items')
    .select('id')
    .like('title', `${FIXTURE_PREFIX}%`);
  if (staleItems && staleItems.length > 0) {
    await cleanupContentFixtures(
      client,
      staleItems.map((r) => r.id),
    );
  }

  // Step 3: Seed content fixtures.
  console.log('[generator] Seeding content fixtures...');
  const { contentItemIds, contentChunkIds } = await seedContentFixtures(client);

  // Step 4: Seed entity fixtures.
  console.log('[generator] Seeding entity fixtures...');
  const { entityMentionIds, entityRelationshipIds } = await seedEntityFixtures(
    client,
    contentItemIds,
  );

  console.log('[generator] Fixture generation complete.');
  console.log(
    `  content_items: ${contentItemIds.length}, content_chunks: ${contentChunkIds.length}`,
  );
  console.log(
    `  entity_mentions: ${entityMentionIds.length}, entity_relationships: ${entityRelationshipIds.length}`,
  );

  return {
    contentItemIds,
    contentChunkIds,
    entityMentionIds,
    entityRelationshipIds,
  };
}

/**
 * Clean up all fixture data created by generateFixtures().
 */
export async function cleanupAllFixtures(
  client: SupabaseClient<Database>,
  manifest: FixtureManifest,
): Promise<void> {
  await cleanupContentFixtures(client, manifest.contentItemIds);
}

export { FIXTURE_PREFIX } from './content-fixtures';
export {
  FIXTURE_COUNTS,
  VALID_PUBLICATION_STATUSES,
} from './publication-fixtures';
