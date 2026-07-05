/**
 * Sector Intelligence Golden Path Real DB Integration Tests
 *
 * Verifies the live SI pipeline end-to-end against the real Supabase database:
 *   Create workspace -> Add feed source -> Ingest articles (simulated)
 *     -> Verify workspace-scoped article query -> Summary aggregation
 *
 * The pipeline previously continued past ingestion into "create content items
 * for passed articles -> classify (real AI) -> link to workspace via junction
 * table" -- that TS-side content-item-promotion step was already retired in
 * production before M6 (see `lib/intelligence/pipeline.ts` ID-75 WP-E (BI-11):
 * the gate-passed `feed_articles` row IS the landing record now, and the
 * Python cocoindex walk enumerates passed rows and lands them as
 * `reference_items`). ID-131.19 (M6, S450 GO tail) then separately DROPPED
 * the `content_items`, `content_item_workspaces`, `content_history`, and
 * `read_marks` tables/views outright. This Subtask removed the test steps
 * that exercised the already-dead promotion flow (they were testing an
 * architecture production had already stopped running); the steps that
 * exercise the still-live `feed_articles`/`feed_sources`/`workspaces`
 * ingestion + summary-aggregation path are unchanged.
 *
 * These tests call real AI APIs (Claude for classification, OpenAI for embeddings)
 * and write to the real Supabase database. No mocks.
 *
 * Prerequisites:
 *   - .env with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY
 *   - Run: INTEGRATION_INTELLIGENCE=1 bun run test __tests__/integration/intelligence-golden-path
 *
 * Spec: docs/specs/si-integration-tests-spec.md
 *
 * @vitest-environment node
 */
// ID-131.19 M6 retirement (S450 GO tail): Steps 4/5/6/9 (+ the content_items-shaped
// edge-case/validation `it()` blocks below) were removed -- they tested a TS-side
// content-item-promotion architecture already retired at ID-75 WP-E, independent of
// M6's table drop. See docstring above for the full rationale.

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
// service-client MUST be imported first -- it loads dotenv for all env vars
import { serviceClient } from './helpers/service-client';
import { fetchIntelligenceSummary } from '@/lib/intelligence/summary';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { DB_OPTION } from '@/lib/supabase/schema';

// ---------------------------------------------------------------------------
// Env var gating
// ---------------------------------------------------------------------------

const ENABLED = process.env.INTEGRATION_INTELLIGENCE === '1';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_PREFIX = `[SI-GOLDEN-${Date.now()}]`;

// Intelligence application_type id — resolved at beforeAll from the seeded
// `application_types` table (S246 WP2b T2 — discriminator is now
// application_type_id FK, not workspaces.type text col).
let INTELLIGENCE_APP_TYPE_ID: string = '';

beforeAll(async () => {
  const { data: appType, error: appTypeErr } = await serviceClient
    .from('application_types')
    .select('id')
    .eq('key', 'intelligence')
    .single();
  if (appTypeErr || !appType) {
    throw new Error(
      `application_types row for key='intelligence' not found — was the T2 seed step (sub-task 1.2) applied? Original error: ${appTypeErr?.message}`,
    );
  }
  INTELLIGENCE_APP_TYPE_ID = appType.id;
});

// ---------------------------------------------------------------------------
// Shared state across sequential tests
// ---------------------------------------------------------------------------

let workspaceId: string | null = null;
let feedSourceId: string | null = null;
const feedArticleIds: string[] = [];

// Edge case test data to clean up
const edgeCaseWorkspaceIds: string[] = [];

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(async () => {
  if (!ENABLED) return;

  try {
    // 1. feed_articles (references feed_sources)
    for (const articleId of feedArticleIds) {
      await serviceClient.from('feed_articles').delete().eq('id', articleId);
    }

    // 2. feed_sources (references workspaces)
    if (feedSourceId) {
      await serviceClient.from('feed_sources').delete().eq('id', feedSourceId);
    }

    // 3. Main workspace (cascade should handle remaining FKs)
    if (workspaceId) {
      await serviceClient.from('workspaces').delete().eq('id', workspaceId);
    }

    // 4. Edge case workspaces
    for (const wsId of edgeCaseWorkspaceIds) {
      await serviceClient.from('workspaces').delete().eq('id', wsId);
    }

    // 5. Safety net: prefix-based cleanup for any stragglers
    await serviceClient
      .from('workspaces')
      .delete()
      .like('name', `%${TEST_PREFIX}%`);
  } catch (err) {
    console.error('Cleanup failed:', err);
  }
});

// ---------------------------------------------------------------------------
// Golden Path Sequential Test Suite
// ---------------------------------------------------------------------------

describe.skipIf(!ENABLED)('SI Golden Path Real DB Integration', () => {
  // -----------------------------------------------------------------------
  // Step 1: Create intelligence workspace
  // -----------------------------------------------------------------------
  it('Step 1: Create intelligence workspace', async () => {
    const { data, error } = await serviceClient
      .from('workspaces')
      .insert({
        name: `${TEST_PREFIX} Test Intelligence Workspace`,
        application_type_id: INTELLIGENCE_APP_TYPE_ID,
      })
      .select('id')
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.id).toBeTruthy();

    workspaceId = data!.id;

    // Re-query to confirm workspace exists and resolves as intelligence type
    // via the application_types JOIN (post-T2 discriminator).
    const { data: verify, error: verifyErr } = await serviceClient
      .from('workspaces')
      .select('id, name, application_types!inner(key)')
      .eq('id', workspaceId)
      .eq('application_types.key', 'intelligence')
      .single();

    expect(verifyErr).toBeNull();
    expect(verify).toBeTruthy();
    expect(verify?.name).toContain(TEST_PREFIX);
  });

  // -----------------------------------------------------------------------
  // Step 2: Add feed source
  // -----------------------------------------------------------------------
  it('Step 2: Add feed source linked to workspace', async () => {
    expect(workspaceId).toBeTruthy();

    const { data, error } = await serviceClient
      .from('feed_sources')
      .insert({
        workspace_id: workspaceId!,
        name: `${TEST_PREFIX} Test RSS Feed`,
        url: 'https://example.com/test-feed.xml',
        source_type: 'rss',
        polling_interval_minutes: 60,
      })
      .select(
        'id, workspace_id, consecutive_failures, article_count, is_active',
      )
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.id).toBeTruthy();

    feedSourceId = data!.id;

    // Verify defaults
    expect(data!.workspace_id).toBe(workspaceId);
    expect(data!.consecutive_failures).toBe(0);
    expect(data!.article_count).toBe(0);
    expect(data!.is_active).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Step 3: Simulate article ingestion (direct insert)
  // -----------------------------------------------------------------------
  it('Step 3: Insert 3 feed articles (2 passed, 1 filtered)', async () => {
    expect(workspaceId).toBeTruthy();
    expect(feedSourceId).toBeTruthy();

    const articles: Array<{
      workspace_id: string;
      feed_source_id: string;
      external_url: string;
      title: string;
      raw_content: string;
      relevance_score: number;
      relevance_category: string;
      relevance_reasoning: string;
      matched_categories: string[];
      passed: boolean;
      published_at: string;
    }> = [
      {
        workspace_id: workspaceId!,
        feed_source_id: feedSourceId!,
        external_url: `https://example.com/${TEST_PREFIX}/article-1`,
        title: `${TEST_PREFIX} UK Government Cyber Security Strategy 2026`,
        raw_content:
          'The UK Government has published its updated Cyber Security Strategy for 2026. ' +
          'The strategy outlines new requirements for public sector organisations to achieve ' +
          'Cyber Essentials Plus certification by March 2027.',
        relevance_score: 0.85,
        relevance_category: 'high',
        relevance_reasoning: 'Directly relevant to security sector',
        matched_categories: ['cyber security', 'government policy'],
        passed: true,
        published_at: new Date().toISOString(),
      },
      {
        workspace_id: workspaceId!,
        feed_source_id: feedSourceId!,
        external_url: `https://example.com/${TEST_PREFIX}/article-2`,
        title: `${TEST_PREFIX} NHS Digital Transformation Programme Update`,
        raw_content:
          'NHS England has announced new procurement frameworks for digital health services. ' +
          'The programme includes a focus on interoperability standards and data sharing agreements ' +
          'between trusts.',
        relevance_score: 0.62,
        relevance_category: 'medium',
        relevance_reasoning: 'Related to healthcare IT procurement',
        matched_categories: ['healthcare', 'procurement'],
        passed: true,
        published_at: new Date().toISOString(),
      },
      {
        workspace_id: workspaceId!,
        feed_source_id: feedSourceId!,
        external_url: `https://example.com/${TEST_PREFIX}/article-3`,
        title: `${TEST_PREFIX} Celebrity Chef Opens New Restaurant`,
        raw_content:
          'A new restaurant has opened in central London serving modern British cuisine.',
        relevance_score: 0.05,
        relevance_category: 'irrelevant',
        relevance_reasoning: 'No connection to company interests',
        matched_categories: [],
        passed: false,
        published_at: new Date().toISOString(),
      },
    ];

    for (const article of articles) {
      const { data, error } = await serviceClient
        .from('feed_articles')
        .insert(article)
        .select('id')
        .single();

      expect(error).toBeNull();
      expect(data).toBeTruthy();
      feedArticleIds.push(data!.id);
    }

    // Re-query by workspace_id to confirm all 3 articles
    const { data: allArticles, error: queryErr } = await serviceClient
      .from('feed_articles')
      .select('id, passed')
      .eq('workspace_id', workspaceId!);

    expect(queryErr).toBeNull();
    expect(allArticles).toBeTruthy();
    expect(allArticles!.length).toBe(3);

    // Article 3 (last) has passed = false
    const filteredArticles = allArticles!.filter((a) => !a.passed);
    expect(filteredArticles.length).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Step 7: Verify workspace-scoped article query
  //
  // ID-131.19 M6 retirement: this step previously also asserted on
  // `feed_articles.content_item_id` (set by the now-deleted Step 4/6
  // content-item promotion + junction link). That column no longer exists
  // on `feed_articles` -- it was replaced by `reference_item_id`, which is
  // populated asynchronously by the Python cocoindex walk (ID-75 WP-E), not
  // by this test's synchronous TS insert, so there is no honest equivalent
  // assertion to make here. Only the still-live count/shape assertions
  // survive.
  // -----------------------------------------------------------------------
  it('Step 7: Verify workspace-scoped article query', async () => {
    expect(workspaceId).toBeTruthy();

    const { data: allArticles, error: allErr } = await serviceClient
      .from('feed_articles')
      .select('id, title, passed, relevance_score')
      .eq('workspace_id', workspaceId!);

    expect(allErr).toBeNull();
    expect(allArticles).toBeTruthy();
    expect(allArticles!.length).toBe(3);

    const { data: passedArticles, error: passedErr } = await serviceClient
      .from('feed_articles')
      .select('id, title')
      .eq('workspace_id', workspaceId!)
      .eq('passed', true);

    expect(passedErr).toBeNull();
    expect(passedArticles).toBeTruthy();
    expect(passedArticles!.length).toBe(2);

    const { data: filteredArticles } = await serviceClient
      .from('feed_articles')
      .select('id')
      .eq('workspace_id', workspaceId!)
      .eq('passed', false);

    expect(filteredArticles).toBeTruthy();
    expect(filteredArticles!.length).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Step 8: Verify intelligence summary aggregation
  // -----------------------------------------------------------------------
  it('Step 8: Verify intelligence summary aggregation', async () => {
    expect(workspaceId).toBeTruthy();

    const summary = await fetchIntelligenceSummary(
      serviceClient,
      workspaceId!,
      '30d',
      10,
    );

    expect(summary.workspace_id).toBe(workspaceId);
    expect(summary.workspace_name).toContain(TEST_PREFIX);
    expect(summary.total_ingested).toBe(3);
    expect(summary.total_passed).toBe(2);
    expect(summary.total_filtered).toBe(1);

    // filter_ratio = 1/3 ~= 0.333
    expect(summary.filter_ratio).toBeCloseTo(1 / 3, 2);

    // by_source should have exactly 1 entry (our single feed source)
    expect(summary.by_source.length).toBe(1);
    expect(summary.by_source[0].article_count).toBe(3);

    // top_articles should only contain passed articles (2)
    expect(summary.top_articles.length).toBe(2);

    // Sorted by relevance descending
    expect(summary.top_articles[0].relevance_score).toBeGreaterThanOrEqual(
      summary.top_articles[1].relevance_score,
    );
  });

  // -----------------------------------------------------------------------
  // Step 10: Full chain verification
  //
  // ID-131.19 M6 retirement: previously also verified "2 content items with
  // classification data" (queried the dropped `content_items` table) and
  // "2 junction rows" (queried the dropped `content_item_workspaces` table).
  // Both asserted on the retired TS-side content-item-promotion flow; the
  // still-live workspace/feed-source/feed-article/summary assertions
  // survive unchanged.
  // -----------------------------------------------------------------------
  it('Step 10: Full chain verification', async () => {
    expect(workspaceId).toBeTruthy();

    // Workspace exists and is an intelligence workspace (post-T2 discriminator
    // is the application_types JOIN, not workspaces.type text col).
    const { data: ws } = await serviceClient
      .from('workspaces')
      .select('id, application_types!inner(key)')
      .eq('id', workspaceId!)
      .eq('application_types.key', 'intelligence')
      .single();
    expect(ws).toBeTruthy();

    // Feed source linked to workspace
    const { data: source } = await serviceClient
      .from('feed_sources')
      .select('id, workspace_id')
      .eq('id', feedSourceId!)
      .single();
    expect(source).toBeTruthy();
    expect(source!.workspace_id).toBe(workspaceId);

    // 3 feed articles (2 passed, 1 filtered)
    const { data: articles } = await serviceClient
      .from('feed_articles')
      .select('id, passed')
      .eq('workspace_id', workspaceId!);
    expect(articles!.length).toBe(3);
    expect(articles!.filter((a) => a.passed).length).toBe(2);
    expect(articles!.filter((a) => !a.passed).length).toBe(1);

    // Summary aggregation works
    const summary = await fetchIntelligenceSummary(
      serviceClient,
      workspaceId!,
      '30d',
      10,
    );
    expect(summary.total_ingested).toBe(3);
    expect(summary.total_passed).toBe(2);
    expect(summary.total_filtered).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Edge Case Tests
// ---------------------------------------------------------------------------

describe.skipIf(!ENABLED)('SI Edge Cases', () => {
  // -------------------------------------------------------------------------
  // 4.1 Duplicate article (same URL within workspace)
  // -------------------------------------------------------------------------
  it('Duplicate article URL within same workspace fails with unique constraint', async () => {
    expect(workspaceId).toBeTruthy();
    expect(feedSourceId).toBeTruthy();

    const { error } = await serviceClient.from('feed_articles').insert({
      workspace_id: workspaceId!,
      feed_source_id: feedSourceId!,
      external_url: `https://example.com/${TEST_PREFIX}/article-1`, // Same as existing
      title: `${TEST_PREFIX} Duplicate Article`,
    });

    expect(error).toBeTruthy();
    expect(error!.code).toBe('23505'); // unique_violation
  });

  // -------------------------------------------------------------------------
  // 4.2 Duplicate URL across workspaces (allowed)
  // -------------------------------------------------------------------------
  it('Duplicate article URL across different workspaces is allowed', async () => {
    // Create a second workspace
    const { data: ws2, error: wsErr } = await serviceClient
      .from('workspaces')
      .insert({
        name: `${TEST_PREFIX} Second Workspace`,
        application_type_id: INTELLIGENCE_APP_TYPE_ID,
      })
      .select('id')
      .single();

    expect(wsErr).toBeNull();
    expect(ws2).toBeTruthy();
    edgeCaseWorkspaceIds.push(ws2!.id);

    // Create a feed source in the second workspace
    const { data: source2 } = await serviceClient
      .from('feed_sources')
      .insert({
        workspace_id: ws2!.id,
        name: `${TEST_PREFIX} Second Feed`,
        url: 'https://example.com/second-feed.xml',
        source_type: 'rss',
      })
      .select('id')
      .single();

    expect(source2).toBeTruthy();

    // Insert article with same URL as article-1 but different workspace
    const { data: article, error } = await serviceClient
      .from('feed_articles')
      .insert({
        workspace_id: ws2!.id,
        feed_source_id: source2!.id,
        external_url: `https://example.com/${TEST_PREFIX}/article-1`, // Same URL
        title: `${TEST_PREFIX} Cross-Workspace Duplicate`,
        passed: true,
      })
      .select('id')
      .single();

    expect(error).toBeNull();
    expect(article).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // 4.3 Filtered article behaviour (explicit)
  // -------------------------------------------------------------------------
  it('Filtered article is not in top_articles but is counted in totals', async () => {
    expect(workspaceId).toBeTruthy();

    const summary = await fetchIntelligenceSummary(
      serviceClient,
      workspaceId!,
      '30d',
      10,
    );

    // Filtered article IS counted in total_ingested and total_filtered
    expect(summary.total_ingested).toBe(3);
    expect(summary.total_filtered).toBe(1);

    // Filtered article is NOT in top_articles (only passed articles appear)
    const filteredInTop = summary.top_articles.filter((a) =>
      a.title.includes('Celebrity Chef'),
    );
    expect(filteredInTop.length).toBe(0);

    // Passed articles ARE in top_articles
    expect(summary.top_articles.length).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 4.4 Empty workspace summary
  // -------------------------------------------------------------------------
  it('Empty workspace returns zero-state summary', async () => {
    // Create an empty workspace
    const { data: emptyWs, error: wsErr } = await serviceClient
      .from('workspaces')
      .insert({
        name: `${TEST_PREFIX} Empty Workspace`,
        application_type_id: INTELLIGENCE_APP_TYPE_ID,
      })
      .select('id')
      .single();

    expect(wsErr).toBeNull();
    expect(emptyWs).toBeTruthy();
    edgeCaseWorkspaceIds.push(emptyWs!.id);

    const summary = await fetchIntelligenceSummary(
      serviceClient,
      emptyWs!.id,
      '30d',
      10,
    );

    expect(summary.total_ingested).toBe(0);
    expect(summary.total_passed).toBe(0);
    expect(summary.total_filtered).toBe(0);
    expect(summary.filter_ratio).toBe(0);
    expect(summary.top_articles).toEqual([]);
    expect(summary.by_source).toEqual([]);
  });

  // ID-131.19 M6 retirement: removed "Workspace deletion cascades to sources
  // and articles but not content items" -- it existed solely to prove
  // content_items rows survive workspace-cascade deletion via the
  // content_item_workspaces junction. Both tables are dropped at M6, so
  // there is no surviving subject for this assertion.
});

// ---------------------------------------------------------------------------
// Data Validation Tests
// ---------------------------------------------------------------------------

describe.skipIf(!ENABLED)('SI Data Validation', () => {
  // -------------------------------------------------------------------------
  // 5.1 Column type and constraint enforcement
  // -------------------------------------------------------------------------
  it('Rejects relevance_score > 1.0 with CHECK constraint', async () => {
    expect(workspaceId).toBeTruthy();
    expect(feedSourceId).toBeTruthy();

    const { error } = await serviceClient.from('feed_articles').insert({
      workspace_id: workspaceId!,
      feed_source_id: feedSourceId!,
      external_url: `https://example.com/${TEST_PREFIX}/constraint-test-1`,
      title: `${TEST_PREFIX} Constraint Test High Score`,
      relevance_score: 1.5, // Above CHECK constraint
    });

    expect(error).toBeTruthy();
    expect(error!.code).toBe('23514'); // check_violation
  });

  it('Rejects invalid relevance_category', async () => {
    expect(workspaceId).toBeTruthy();
    expect(feedSourceId).toBeTruthy();

    const { error } = await serviceClient.from('feed_articles').insert({
      workspace_id: workspaceId!,
      feed_source_id: feedSourceId!,
      external_url: `https://example.com/${TEST_PREFIX}/constraint-test-2`,
      title: `${TEST_PREFIX} Constraint Test Invalid Category`,
      relevance_category: 'invalid_category' as never,
    });

    expect(error).toBeTruthy();
  });

  // ID-131.19 M6 retirement: removed "Content items from pipeline have
  // correct source metadata" -- asserted on `content_items` rows created by
  // the retired TS-side promotion step (deleted Step 4); no equivalent
  // content_items-shaped destination exists post-M6.

  // -------------------------------------------------------------------------
  // 5.3 Feed source article_count tracking
  // -------------------------------------------------------------------------
  it('Feed source article_count can be updated', async () => {
    expect(feedSourceId).toBeTruthy();

    await serviceClient
      .from('feed_sources')
      .update({ article_count: 3 })
      .eq('id', feedSourceId!);

    const { data } = await serviceClient
      .from('feed_sources')
      .select('article_count')
      .eq('id', feedSourceId!)
      .single();

    expect(data).toBeTruthy();
    expect(data!.article_count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// RLS Verification Tests
// ---------------------------------------------------------------------------

const hasViewerCredentials =
  !!process.env.TEST_USER_3_EMAIL && !!process.env.TEST_USER_3_PASSWORD;

describe.skipIf(!ENABLED || !hasViewerCredentials)(
  'SI RLS Verification (Viewer Role)',
  () => {
    let viewerClient: SupabaseClient<Database>;

    it('Authenticate as viewer', async () => {
      // ID-115 (S9): route to the exposed api schema
      viewerClient = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        { ...DB_OPTION },
      );

      const { error } = await viewerClient.auth.signInWithPassword({
        email: process.env.TEST_USER_3_EMAIL!,
        password: process.env.TEST_USER_3_PASSWORD!,
      });

      expect(error).toBeNull();
    });

    it('Viewer can read feed_sources', async () => {
      expect(workspaceId).toBeTruthy();

      const { data, error } = await viewerClient
        .from('feed_sources')
        .select('id, name')
        .eq('workspace_id', workspaceId!);

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it('Viewer cannot insert feed_sources', async () => {
      expect(workspaceId).toBeTruthy();

      const { error } = await viewerClient.from('feed_sources').insert({
        workspace_id: workspaceId!,
        name: 'Rogue Source',
        url: 'https://evil.com',
        source_type: 'rss',
      } as never);

      expect(error).toBeTruthy();
    });

    it('Viewer can read feed_articles', async () => {
      expect(workspaceId).toBeTruthy();

      const { data, error } = await viewerClient
        .from('feed_articles')
        .select('id, title')
        .eq('workspace_id', workspaceId!);

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it('Viewer cannot update feed_articles', async () => {
      expect(feedArticleIds.length).toBeGreaterThan(0);

      const { error } = await viewerClient
        .from('feed_articles')
        .update({ passed: false } as never)
        .eq('id', feedArticleIds[0]);

      // RLS blocks updates -- either error or 0 rows affected
      // Supabase returns 200 with 0 rows for RLS-blocked updates
      // so we check data rather than error
      if (!error) {
        const { data: check } = await serviceClient
          .from('feed_articles')
          .select('passed')
          .eq('id', feedArticleIds[0])
          .single();
        // The article should still be passed (viewer update was blocked)
        expect(check!.passed).toBe(true);
      } else {
        expect(error).toBeTruthy();
      }
    });

    it('Viewer cannot delete workspaces', async () => {
      expect(workspaceId).toBeTruthy();

      const { error } = await viewerClient
        .from('workspaces')
        .delete()
        .eq('id', workspaceId!);

      // RLS blocks deletes -- either error or silent no-op
      if (!error) {
        // Workspace should still exist
        const { data: check } = await serviceClient
          .from('workspaces')
          .select('id')
          .eq('id', workspaceId!)
          .single();
        expect(check).toBeTruthy();
      } else {
        expect(error).toBeTruthy();
      }
    });
  },
);
