#!/usr/bin/env bun
/**
 * WP-CI.RES.7 §4.3 — Seed integration fixtures into staging DB.
 *
 * One-time CI setup script: validates reference tables populated, then
 * seeds deterministic content_items + content_chunks + entity_mentions +
 * entity_relationships. Run AFTER seed-e2e-users.ts and AFTER
 * staging-reference-refresh.sh (or reference tables already populated).
 *
 * Usage:
 *   bun run scripts/seed-integration-fixtures.ts          # seed
 *   bun run scripts/seed-integration-fixtures.ts --clean   # clean up only
 *
 * Spec: wp-ci-res7-staging-data-strategy-spec.md §4.2–§4.5.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import {
  generateFixtures,
  FIXTURE_PREFIX,
} from '@/__tests__/integration/fixtures/staging-fixture-generator';
import { cleanupContentFixtures } from '@/__tests__/integration/fixtures/content-fixtures';

// ── Env loading (same pattern as service-client.ts) ─────────────────────

function findProjectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    try {
      const result = config({ path: resolve(dir, '.env') });
      if (!result.error) return dir;
    } catch {
      /* continue searching */
    }
    dir = resolve(dir, '..');
  }
  return process.cwd();
}

const projectRoot = findProjectRoot();
config({ path: resolve(projectRoot, '.env') });
config({ path: resolve(projectRoot, '.env.local'), override: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    'FATAL: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required in .env/.env.local',
  );
  process.exit(3);
}

const client = createScriptClient(url, key);

// ── CLI parsing ─────────────────────────────────────────────────────────

const cleanOnly = process.argv.includes('--clean');

async function main(): Promise<void> {
  if (cleanOnly) {
    console.log('[seed-fixtures] Clean-only mode — removing fixture data...');
    const { data: staleItems } = await client
      .from('content_items')
      .select('id')
      .like('title', `${FIXTURE_PREFIX}%`);
    if (staleItems && staleItems.length > 0) {
      await cleanupContentFixtures(
        client,
        staleItems.map((r) => r.id),
      );
      console.log(
        `[seed-fixtures] Cleaned ${staleItems.length} fixture items.`,
      );
    } else {
      console.log('[seed-fixtures] No fixture items found to clean.');
    }
    return;
  }

  console.log('[seed-fixtures] Generating integration fixtures...');
  const manifest = await generateFixtures(client);
  console.log(
    `[seed-fixtures] Done. ${manifest.contentItemIds.length} content_items, ` +
      `${manifest.contentChunkIds.length} chunks, ` +
      `${manifest.entityMentionIds.length} entity_mentions, ` +
      `${manifest.entityRelationshipIds.length} entity_relationships.`,
  );
}

main().catch((err: unknown) => {
  console.error('[seed-fixtures] FATAL:', err);
  process.exit(1);
});
