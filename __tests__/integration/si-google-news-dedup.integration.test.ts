/**
 * Sector Intelligence — Google News Dedup Real-DB Integration Test (§2.1.7)
 *
 * TODO(S189-WP1): this test is SEMANTICALLY BROKEN after the S189 WP1
 * `source_url` Firecrawl fix. The test assumed `resolveGoogleNewsUrl()`
 * was the dedup mechanism for Google News wrapper URLs, and stubbed
 * `global.fetch` to return a canonical URL when the pipeline called the
 * function. Post-WP1, `resolveGoogleNewsUrl()` is no longer called by
 * the pipeline — Firecrawl's `metadata.sourceURL` is now the resolution
 * path, writing to `content_items.source_url`. `feed_articles.external_url`
 * still stores the raw RSS URL (for dedup), so the test's assertion at
 * line 404 (`expect(firstRows[0].external_url).toBe(CANONICAL_ARTICLE_URL)`)
 * would fail because both wrapper URLs now land in `feed_articles` as
 * distinct `external_url` values.
 *
 * This test is EXCLUDED from the default suite (`vitest.config.ts:13`)
 * so CI is unaffected. Rework plan: drop the `global.fetch` stub; assert
 * dedup happens at `content_items.source_url` via the mocked
 * `extractContent` returning the same `resolvedUrl` for both wrappers.
 * Pick up in a follow-up session alongside the `resolveGoogleNewsUrl`
 * removal.
 *
 * Proves that two feed sources in the same workspace, polling different
 * Google News search queries (e.g. "multi-academy trust" vs "MAT
 * safeguarding"), correctly dedup when both surface the same underlying
 * canonical article URL. Exercises `processFeedSource` against a real
 * Supabase database with both the application-side `isDuplicate()` check
 * and the DB-side UNIQUE INDEX on (workspace_id, external_url).
 *
 * Why real-DB (not mock-Supabase): per S155 WP1.5 audit F8, dedup is
 * enforced at two levels — application logic AND DB constraint. A
 * mock-Supabase test would miss the DB constraint safety net. The
 * constraint is the load-bearing piece; the test must hit a real DB.
 *
 * Prerequisites:
 *   - .env with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *   - Run with: INTEGRATION_INTELLIGENCE=1 bun run test \
 *               __tests__/integration/si-google-news-dedup.integration.test.ts
 *
 * Spec: docs/specs/si-hardening-google-news-dedup-test.md
 * Plan: docs/specs/si-hardening-implementation-plan-s154.md §2.1.7
 *
 * @vitest-environment node
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
  beforeEach,
} from 'vitest';
// service-client MUST be imported first — it loads dotenv for all env vars.
import { serviceClient } from './helpers/service-client';
import { sb } from '@/lib/supabase/safe';

// -----------------------------------------------------------------------
// Mocks — stub network layers but KEEP the real dedup / url-resolve paths
// -----------------------------------------------------------------------

// Stub the feed poller so we hand-craft the parsed items directly. This
// avoids needing a real RSS fixture and the per-domain rate limiter.
vi.mock('@/lib/intelligence/feed-poller', () => ({
  pollFeed: vi.fn(),
}));

// Partial mock of content-extractor. We keep `resolveGoogleNewsUrl`,
// `normaliseUrl`, and `isGoogleNewsUrl` real — those are what the spec
// requires we implicitly exercise. We stub `extractContent` (avoids
// hitting real article URLs + Firecrawl) and `checkFirecrawlApiKey`.
vi.mock('@/lib/intelligence/content-extractor', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/intelligence/content-extractor')
  >('@/lib/intelligence/content-extractor');
  return {
    ...actual,
    extractContent: vi.fn(),
    checkFirecrawlApiKey: vi.fn(),
  };
});

// classifyContent and generateEmbedding are never reached when
// companyContext is null (scoring skipped → passed=false → no content
// item creation → no classification). But guard anyway so a future
// refactor doesn't silently hit the real AI APIs from this test.
vi.mock('@/lib/ai/classify', () => ({
  classifyContent: vi.fn(),
}));
vi.mock('@/lib/ai/embed', () => ({
  MAX_EMBEDDING_CHARS: 24_000,
  getEmbeddingModel: vi.fn(() => 'text-embedding-3-large'),
  getEmbeddingDimensions: vi.fn(() => 1024),
  generateEmbedding: vi.fn(),
}));

// Import AFTER vi.mock so the mocked modules are picked up.
import { processFeedSource } from '@/lib/intelligence/pipeline';
import { pollFeed } from '@/lib/intelligence/feed-poller';
import { extractContent } from '@/lib/intelligence/content-extractor';

// -----------------------------------------------------------------------
// Env gating — match intelligence-golden-path convention
// -----------------------------------------------------------------------

const ENABLED = process.env.INTEGRATION_INTELLIGENCE === '1';

// -----------------------------------------------------------------------
// Test constants
// -----------------------------------------------------------------------

const TEST_PREFIX = `[SI-GNEWS-DEDUP-${Date.now()}]`;

// Canonical BBC News article URL that BOTH Google News wrappers resolve
// to. The dedup logic should see this as the external_url for both
// source inserts.
const CANONICAL_ARTICLE_URL =
  'https://www.bbc.co.uk/news/education-si-gnews-dedup-test-12345';

// Two different Google News RSS search-query URLs (different feeds).
const GNEWS_FEED_URL_1 =
  'https://news.google.com/rss/search?q=multi-academy+trust&hl=en-GB';
const GNEWS_FEED_URL_2 =
  'https://news.google.com/rss/search?q=MAT+safeguarding&hl=en-GB';

// Two different Google News wrapper URLs for the item returned by each
// feed. Real Google News wrappers look like
// https://news.google.com/articles/<opaque-base64>. We pick two
// distinct wrappers so dedup cannot "accidentally" work via raw-URL
// equality — it must go through resolveGoogleNewsUrl first.
const GNEWS_WRAPPER_URL_1 =
  'https://news.google.com/articles/CBMiAAAAAAAAAAAAAAAAAAA1';
const GNEWS_WRAPPER_URL_2 =
  'https://news.google.com/articles/CBMiAAAAAAAAAAAAAAAAAAA2';

// Article HTML content must be >= MIN_CONTENT_WORDS (100) and >= 50 so
// we take the normal path, not the "content too short" branch.
// We only need this referenced by the extractContent stub.
const ARTICLE_TITLE = `${TEST_PREFIX} Ofsted inspects new multi-academy trust`;
const ARTICLE_CONTENT = Array(150).fill('word').join(' ');

// -----------------------------------------------------------------------
// Shared state
// -----------------------------------------------------------------------

let workspaceId: string | null = null;
let feedSourceId1: string | null = null;
let feedSourceId2: string | null = null;

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/**
 * Build a FeedSource row the shape processFeedSource expects. The DB
 * insert returns more columns (polling_interval_minutes defaults to 30),
 * but processFeedSource only consumes these fields.
 */
interface PipelineFeedSource {
  id: string;
  workspace_id: string;
  name: string;
  url: string;
  etag: string | null;
  last_modified: string | null;
  polling_interval_minutes: number;
  consecutive_failures: number;
  article_count: number;
}

/** Stub pollFeed to return a single parsed item with the given wrapper URL. */
function stubPollFeedWith(
  feedSourceId: string,
  wrapperUrl: string,
  guid: string,
) {
  vi.mocked(pollFeed).mockResolvedValueOnce({
    feedSourceId,
    status: 'success',
    items: [
      {
        title: ARTICLE_TITLE,
        url: wrapperUrl,
        guid,
        publishedAt: '2026-04-09T10:00:00.000Z',
        summary: 'Stubbed summary for dedup test.',
        contentEncoded: null,
        categories: [],
      },
    ],
    etag: null,
    lastModified: null,
  });
}

/** Stub extractContent to return deterministic HTML content (> MIN_CONTENT_WORDS). */
function stubExtractContent() {
  vi.mocked(extractContent).mockResolvedValue({
    content: ARTICLE_CONTENT,
    method: 'fetch',
    title: ARTICLE_TITLE,
    description: 'Stub description',
    thumbnailUrl: null,
    wordCount: 150,
  });
}

/**
 * Stub global.fetch so that any HEAD/GET to a Google News wrapper URL
 * returns a Response-shaped object with `url` set to the canonical
 * article URL. This is what `resolveGoogleNewsUrl()` reads to detect
 * the redirect target.
 *
 * CRITICAL: we must NOT intercept fetch calls made by the Supabase JS
 * client — it uses `fetch()` internally for every query. We delegate
 * to the real fetch for any URL that is not a news.google.com URL.
 */
function stubGlobalFetchForGoogleNewsRedirect() {
  const realFetch = global.fetch.bind(global);
  vi.spyOn(global, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      // Only Google News wrapper URLs get the stubbed redirect. Every
      // other fetch (including Supabase REST calls) goes through the
      // real fetch implementation.
      if (url.startsWith('https://news.google.com/')) {
        return {
          url: CANONICAL_ARTICLE_URL,
          ok: true,
          status: 200,
          headers: new Headers(),
        } as unknown as Response;
      }
      return realFetch(input, init);
    },
  );
}

// -----------------------------------------------------------------------
// Cleanup — always runs, even when the suite is skipped (cheap no-op)
// -----------------------------------------------------------------------

async function cleanup() {
  if (!ENABLED) return;
  try {
    // feed_articles first (FK to feed_sources, but ON DELETE CASCADE
    // from feed_sources would also handle this; we do it explicitly).
    if (workspaceId) {
      await serviceClient
        .from('feed_articles')
        .delete()
        .eq('workspace_id', workspaceId);
    }
    if (feedSourceId1) {
      await serviceClient.from('feed_sources').delete().eq('id', feedSourceId1);
    }
    if (feedSourceId2) {
      await serviceClient.from('feed_sources').delete().eq('id', feedSourceId2);
    }
    if (workspaceId) {
      await serviceClient.from('workspaces').delete().eq('id', workspaceId);
    }
    // Prefix safety net for any stragglers.
    await serviceClient
      .from('workspaces')
      .delete()
      .like('name', `%${TEST_PREFIX}%`);
  } catch (err) {
    console.error('[si-google-news-dedup] cleanup failed:', err);
  }
}

// -----------------------------------------------------------------------
// Seed test workspace + two feed sources BEFORE the suite runs
// -----------------------------------------------------------------------

beforeAll(async () => {
  if (!ENABLED) return;

  // S246 WP2b T2 (P1): workspace discriminator is now application_type_id
  // FK, not `workspaces.type` text col. Look up the intelligence app type.
  const { data: appType, error: appTypeErr } = await serviceClient
    .from('application_types')
    .select('id')
    .eq('key', 'intelligence')
    .single();
  if (appTypeErr || !appType) {
    throw new Error(
      `application_types row for key='intelligence' not found — was the T2 seed step applied? Original error: ${appTypeErr?.message}`,
    );
  }
  const INTELLIGENCE_APP_TYPE_ID = appType.id;

  // 1. Intelligence workspace (use sb() so any failure surfaces loudly
  //    rather than silently producing a null id).
  const ws = await sb(
    serviceClient
      .from('workspaces')
      .insert({
        name: `${TEST_PREFIX} GNews Dedup Workspace`,
        application_type_id: INTELLIGENCE_APP_TYPE_ID,
      })
      .select('id')
      .single(),
    'test.si-gnews-dedup.seed-workspace',
  );
  workspaceId = ws.id;

  // 2. Feed source 1 — Google News search for "multi-academy trust"
  //    IMPORTANT: dedup key is (workspace_id, external_url). Both sources
  //    MUST live in the SAME workspace or dedup will not trigger (per
  //    S155 WP1.5 F18 — cross-workspace dedup is intentionally disabled).
  const src1 = await sb(
    serviceClient
      .from('feed_sources')
      .insert({
        workspace_id: workspaceId,
        name: `${TEST_PREFIX} GNews — multi-academy trust`,
        url: GNEWS_FEED_URL_1,
        source_type: 'rss',
        polling_interval_minutes: 60,
      })
      .select('id')
      .single(),
    'test.si-gnews-dedup.seed-feed-source-1',
  );
  feedSourceId1 = src1.id;

  // 3. Feed source 2 — Google News search for "MAT safeguarding"
  const src2 = await sb(
    serviceClient
      .from('feed_sources')
      .insert({
        workspace_id: workspaceId,
        name: `${TEST_PREFIX} GNews — MAT safeguarding`,
        url: GNEWS_FEED_URL_2,
        source_type: 'rss',
        polling_interval_minutes: 60,
      })
      .select('id')
      .single(),
    'test.si-gnews-dedup.seed-feed-source-2',
  );
  feedSourceId2 = src2.id;
});

afterAll(async () => {
  // Restore mocks BEFORE cleanup so the Supabase client sees the real
  // global.fetch (not the Google-News-redirect stub). The stub
  // delegates non-Google URLs to the real fetch, but restoring first
  // eliminates any chance of interference during cleanup.
  vi.restoreAllMocks();
  await cleanup();
});

// -----------------------------------------------------------------------
// The test — gated on INTEGRATION_INTELLIGENCE=1
// -----------------------------------------------------------------------

describe.skipIf(!ENABLED)(
  'SI — Google News dedup (real DB, pipeline-level)',
  () => {
    beforeEach(() => {
      // Clear call history but keep the spy/mock installed.
      vi.mocked(pollFeed).mockReset();
      vi.mocked(extractContent).mockReset();
      stubExtractContent();
      stubGlobalFetchForGoogleNewsRedirect();
    });

    it('two feeds producing the same canonical URL dedup to a single feed_articles row', async () => {
      expect(workspaceId).toBeTruthy();
      expect(feedSourceId1).toBeTruthy();
      expect(feedSourceId2).toBeTruthy();

      // Build the FeedSource shape processFeedSource expects for each.
      const source1: PipelineFeedSource = {
        id: feedSourceId1!,
        workspace_id: workspaceId!,
        name: `${TEST_PREFIX} GNews — multi-academy trust`,
        url: GNEWS_FEED_URL_1,
        etag: null,
        last_modified: null,
        polling_interval_minutes: 60,
        consecutive_failures: 0,
        article_count: 0,
      };
      const source2: PipelineFeedSource = {
        id: feedSourceId2!,
        workspace_id: workspaceId!,
        name: `${TEST_PREFIX} GNews — MAT safeguarding`,
        url: GNEWS_FEED_URL_2,
        etag: null,
        last_modified: null,
        polling_interval_minutes: 60,
        consecutive_failures: 0,
        article_count: 0,
      };

      // Queue pollFeed stubs — one item per feed, DIFFERENT wrapper URLs,
      // DIFFERENT guids, but both will resolve to CANONICAL_ARTICLE_URL.
      stubPollFeedWith(feedSourceId1!, GNEWS_WRAPPER_URL_1, 'guid-1');
      stubPollFeedWith(feedSourceId2!, GNEWS_WRAPPER_URL_2, 'guid-2');

      // Run the first feed through the pipeline. companyContext and
      // companyEmbedding are both null — this short-circuits relevance
      // scoring (pipeline.ts lines 410-413) so we never touch Claude or
      // OpenAI, and no content_item is created. The dedup path runs
      // BEFORE scoring, so we still exercise the full dedup flow.
      const result1 = await processFeedSource(
        serviceClient,
        source1,
        null, // companyContext
        null, // companyEmbedding
        null, // activePrompt
      );

      expect(result1.errors).toEqual([]);
      expect(result1.articlesFound).toBe(1);
      expect(result1.articlesNew).toBe(1);

      // Query feed_articles for this workspace. There should be exactly
      // one row, and its external_url should be the normalised canonical.
      const firstRows = await sb(
        serviceClient
          .from('feed_articles')
          .select('id, feed_source_id, external_url, external_id')
          .eq('workspace_id', workspaceId!),
        'test.si-gnews-dedup.read-after-first',
      );

      expect(firstRows).toHaveLength(1);
      expect(firstRows[0].external_url).toBe(CANONICAL_ARTICLE_URL);
      expect(firstRows[0].feed_source_id).toBe(feedSourceId1);
      const firstRowId = firstRows[0].id;

      // Run the SECOND feed through the pipeline. It returns a different
      // wrapper URL and different GUID, but resolveGoogleNewsUrl will
      // collapse both to the same CANONICAL_ARTICLE_URL. The dedup
      // check (application-side isDuplicate) must catch this BEFORE the
      // insert. As a belt-and-braces check, the UNIQUE INDEX on
      // (workspace_id, external_url) would also reject the insert at
      // the DB level.
      const result2 = await processFeedSource(
        serviceClient,
        source2,
        null,
        null,
        null,
      );

      expect(result2.errors).toEqual([]);
      expect(result2.articlesFound).toBe(1);
      // articlesNew is incremented BEFORE the dedup check returns false,
      // wait — check the pipeline again: the `continue` at line 358 is
      // AFTER `articlesNew++`? No, actually `articlesNew++` is at line
      // 360, AFTER `if (duplicate) continue;` at line 358. So on a
      // dedup hit, articlesNew should be 0 for the second call.
      expect(result2.articlesNew).toBe(0);

      // Re-query feed_articles — must still be exactly ONE row for the
      // canonical URL. The dedup worked.
      const secondRows = await sb(
        serviceClient
          .from('feed_articles')
          .select('id, feed_source_id, external_url')
          .eq('workspace_id', workspaceId!),
        'test.si-gnews-dedup.read-after-second',
      );

      expect(secondRows).toHaveLength(1);
      expect(secondRows[0].id).toBe(firstRowId);
      expect(secondRows[0].external_url).toBe(CANONICAL_ARTICLE_URL);
      // feed_source_id attribution stays with whichever source inserted
      // first (source 1 here).
      expect(secondRows[0].feed_source_id).toBe(feedSourceId1);
    });
  },
);
