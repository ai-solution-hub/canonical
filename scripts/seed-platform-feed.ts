#!/usr/bin/env bun
/**
 * ID-127.3 (BI-4) — seed the Platform feed slice (feed_sources → feed_articles).
 *
 * Seeds ONE `feed_sources` row and ONE `feed_articles` row (with `passed = true`)
 * into a Platform Supabase DB so the cocoindex worker's `FeedUrlSource`
 * (`_PASSED_URLS_SQL`: `SELECT … WHERE passed = true`) enumerates a real URL and
 * a later `/extract` produces real cleaned content.
 *
 * **STRICT FK ORDER (TECH Risks "Feed-seed FK ordering").** Both rows carry
 * NOT-NULL FKs:
 *   - `feed_sources.workspace_id`   → workspaces(id)   NOT NULL
 *   - `feed_articles.workspace_id`  → workspaces(id)   NOT NULL
 *   - `feed_articles.feed_source_id`→ feed_sources(id) NOT NULL
 * So the seed runs in order: assert the Platform **procurement** workspace
 * exists (seeded by `seed-platform-workspaces.ts`, BI-8) → insert the
 * `feed_sources` row → insert the `feed_articles` row. It FAILS LOUD if the
 * workspace is absent — it never creates a workspace (that is the BI-8 seed's
 * job, which must run first).
 *
 * **Hermetic synthetic fixture (bl-372).** The live gov.uk URLs previously
 * seeded here rotted twice (S415, then again post-S415) — a third-party site
 * this repo does not control. Both constants now point at fixture files
 * this repo OWNS (`scripts/fixtures/platform-feed-seed-*`), served externally
 * via `raw.githubusercontent.com` (a stable, hermetic host reachable from the
 * Coolify pipeline container, requiring no new public route / no Vercel
 * Deployment Protection bypass — see bl-372 resolution notes). This keeps
 * the S415-recommended "real HTTP fetch → trafilatura clean → real content"
 * walk-proof coverage without depending on a URL we don't own.
 * `extraction_method = 'fetch'` (an allowed value of the
 * `feed_articles_extraction_method_check` constraint) marks the intended
 * fetch-then-clean path.
 *
 * **Target-parameterised (ID-127 S408 amendment).** Runs against EITHER Platform
 * DB — prod (`zjqbrdctesqvouboziae`) or staging (`rbwqewalexrzgxtvcqrh`) — via
 * `--target=prod|staging` (or `SEED_PLATFORM_TARGET`). Reuses the target
 * resolution + project-ref guard from `seed-platform-workspaces.ts`. One DB per
 * run; no "both at once".
 *
 * **Idempotency:** neither table has a unique constraint on the seed's natural
 * key, so convergence is lookup-then-insert. The `feed_sources` row is matched
 * by (`workspace_id`, `url`); the `feed_articles` row by (`workspace_id`,
 * `external_url`). A re-run leaves existing rows untouched (no duplicate).
 *
 * **Safety:** dry-run by default; a live write requires `--apply`. Reads/writes
 * go through `sb()` from `@/lib/supabase/safe`.
 *
 * Usage:
 *   bun run scripts/seed-platform-feed.ts --target=staging            # dry-run
 *   bun run scripts/seed-platform-feed.ts --target=prod --apply       # live
 *
 * Spec: specs/id-127-platform-pipeline/TECH.md §BI-4 Change B + Risks note.
 */
import { sb, type PostgrestLike } from '@/lib/supabase/safe';
import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import {
  PIPELINE_SYSTEM_USER_ID,
  parseSeedArgs,
  resolveTarget,
  type SeedDbClient,
} from '@/scripts/seed-platform-workspaces';

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * The Platform workspace the feed slice attaches to. The BI-8 seed creates one
 * workspace per application_type; the feed slice uses the **procurement**
 * workspace (the same workspace the BI-7 forms manifest references).
 */
export const FEED_WORKSPACE_NAME = 'Platform — Procurement';

/**
 * The seed feed_sources row. `url` is the stable idempotency key per
 * workspace — points at the hermetic Atom fixture
 * `scripts/fixtures/platform-feed-seed-feed.atom` (bl-372; see file header
 * comment there before moving/renaming it).
 */
export const FEED_SOURCE_SEED = {
  name: 'Platform synthetic feed (UK procurement policy)',
  url: 'https://raw.githubusercontent.com/ai-solution-hub/canonical/main/scripts/fixtures/platform-feed-seed-feed.atom',
  sourceType: 'rss' as const,
} as const;

/**
 * The seed feed_articles row. Points at the hermetic HTML fixture
 * `scripts/fixtures/platform-feed-seed-article.html` (bl-372) so a later
 * `/extract` produces real cleaned content without depending on a
 * third-party URL. `passed = true` so `FeedUrlSource` enumerates it.
 * `extraction_method = 'fetch'` is an allowed value of the
 * `feed_articles_extraction_method_check` constraint.
 */
export const FEED_ARTICLE_SEED = {
  externalUrl:
    'https://raw.githubusercontent.com/ai-solution-hub/canonical/main/scripts/fixtures/platform-feed-seed-article.html',
  title: 'UK SMB Procurement Frameworks: A Practical Guide',
  extractionMethod: 'fetch' as const,
} as const;

// ── Types ───────────────────────────────────────────────────────────────────

export type FeedSeedAction = 'created' | 'already-exists' | 'would-create';

export interface FeedSeedRowResult {
  readonly table: 'feed_sources' | 'feed_articles';
  readonly id: string | null;
  readonly action: FeedSeedAction;
}

export interface FeedSeedResult {
  readonly workspaceId: string;
  readonly rows: FeedSeedRowResult[];
}

// ── Lookups ─────────────────────────────────────────────────────────────────

/**
 * Resolve the Platform procurement workspace id. FAILS LOUD if absent — the
 * BI-8 workspace seed (`seed-platform-workspaces.ts`) must run first.
 */
export async function requireFeedWorkspaceId(
  client: SeedDbClient,
): Promise<string> {
  const row = await sb<{ id: string } | null>(
    client
      .from('workspaces')
      .select('id')
      .eq('name', FEED_WORKSPACE_NAME)
      .maybeSingle() as PostgrestLike<{ id: string } | null>,
    'seed-platform-feed.workspaces.byName',
  );
  if (!row) {
    throw new Error(
      `Seed aborted: the Platform workspace "${FEED_WORKSPACE_NAME}" is absent ` +
        'on the target DB. The feed slice depends on the BI-8 workspace seed — ' +
        'run seed-platform-workspaces.ts (same target) FIRST. This seed never ' +
        'creates a workspace.',
    );
  }
  return row.id;
}

async function findFeedSourceId(
  client: SeedDbClient,
  workspaceId: string,
): Promise<string | null> {
  const row = await sb<{ id: string } | null>(
    client
      .from('feed_sources')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('url', FEED_SOURCE_SEED.url)
      .maybeSingle() as PostgrestLike<{ id: string } | null>,
    'seed-platform-feed.feed_sources.byUrl',
  );
  return row?.id ?? null;
}

async function findFeedArticleId(
  client: SeedDbClient,
  workspaceId: string,
): Promise<string | null> {
  const row = await sb<{ id: string } | null>(
    client
      .from('feed_articles')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('external_url', FEED_ARTICLE_SEED.externalUrl)
      .maybeSingle() as PostgrestLike<{ id: string } | null>,
    'seed-platform-feed.feed_articles.byUrl',
  );
  return row?.id ?? null;
}

// ── Core seed logic (client-injected, testable) ─────────────────────────────

/**
 * Seed the Platform feed slice in strict FK order: assert the procurement
 * workspace → feed_sources → feed_articles. Idempotent (lookup-then-insert).
 * The article is `passed = true` with a real public URL and a NOT-NULL
 * `feed_source_id`/`workspace_id`.
 *
 * @param client   Service-role Platform DB client (RLS-bypassing).
 * @param dryRun   When true, plans the inserts but performs no write.
 */
export async function seedFeed(
  client: SeedDbClient,
  dryRun: boolean,
): Promise<FeedSeedResult> {
  const workspaceId = await requireFeedWorkspaceId(client);
  const rows: FeedSeedRowResult[] = [];

  // ── Step 1: feed_sources FIRST (the feed_articles FK target). ──
  let feedSourceId = await findFeedSourceId(client, workspaceId);
  if (feedSourceId) {
    rows.push({
      table: 'feed_sources',
      id: feedSourceId,
      action: 'already-exists',
    });
  } else if (dryRun) {
    rows.push({ table: 'feed_sources', id: null, action: 'would-create' });
  } else {
    const created = await sb<{ id: string }>(
      client
        .from('feed_sources')
        .insert({
          workspace_id: workspaceId,
          name: FEED_SOURCE_SEED.name,
          url: FEED_SOURCE_SEED.url,
          source_type: FEED_SOURCE_SEED.sourceType,
          created_by: PIPELINE_SYSTEM_USER_ID,
        })
        .select('id')
        .single() as PostgrestLike<{ id: string }>,
      'seed-platform-feed.feed_sources.insert',
    );
    feedSourceId = created.id;
    rows.push({ table: 'feed_sources', id: feedSourceId, action: 'created' });
  }

  // ── Step 2: feed_articles (NOT-NULL FK on the source above). ──
  const existingArticleId = await findFeedArticleId(client, workspaceId);
  if (existingArticleId) {
    rows.push({
      table: 'feed_articles',
      id: existingArticleId,
      action: 'already-exists',
    });
  } else if (dryRun || !feedSourceId) {
    // In dry-run the source id may be null (would-create) — do not invent an FK.
    rows.push({ table: 'feed_articles', id: null, action: 'would-create' });
  } else {
    const created = await sb<{ id: string }>(
      client
        .from('feed_articles')
        .insert({
          workspace_id: workspaceId,
          feed_source_id: feedSourceId,
          external_url: FEED_ARTICLE_SEED.externalUrl,
          title: FEED_ARTICLE_SEED.title,
          extraction_method: FEED_ARTICLE_SEED.extractionMethod,
          passed: true,
        })
        .select('id')
        .single() as PostgrestLike<{ id: string }>,
      'seed-platform-feed.feed_articles.insert',
    );
    rows.push({ table: 'feed_articles', id: created.id, action: 'created' });
  }

  return { workspaceId, rows };
}

// ── CLI bootstrap ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseSeedArgs(process.argv.slice(2));
  const resolved = resolveTarget(args.target, process.env);

  console.log(
    `🌱 Seeding Platform feed slice → ${resolved.target} ` +
      `(${resolved.projectRef})` +
      (args.dryRun ? ' [dry-run — no writes]' : ' [LIVE --apply]'),
  );

  const client = createScriptClient(resolved.url, resolved.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as SeedDbClient;

  const result = await seedFeed(client, args.dryRun);

  for (const r of result.rows) {
    const icon =
      r.action === 'created' ? '✨' : r.action === 'would-create' ? '·' : '➖';
    console.log(`  ${icon} ${r.table.padEnd(14)} → ${r.action}`);
  }
  console.log(`✅ feed slice seeded for workspace ${result.workspaceId}.`);
}

// Run only when invoked directly (never on import — tests import the functions).
if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].endsWith('seed-platform-feed.ts')
) {
  main().catch((err) => {
    console.error(
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
    process.exitCode = 1;
  });
}
