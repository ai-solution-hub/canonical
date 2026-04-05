/**
 * Sector Intelligence Golden Path Real DB Integration Tests
 *
 * Verifies the complete SI pipeline end-to-end against the real Supabase database:
 *   Create workspace -> Add feed source -> Ingest articles (simulated)
 *     -> Create content items for passed articles -> Classify (real AI)
 *       -> Link to workspace via junction -> Summary aggregation
 *
 * These tests call real AI APIs (Claude for classification, OpenAI for embeddings)
 * and write to the real Supabase database. No mocks.
 *
 * Prerequisites:
 *   - .env with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY
 *   - Run: INTEGRATION_INTELLIGENCE=1 bun run test __tests__/integration/intelligence-golden-path
 *
 * Spec: docs/specs/si-integration-tests-spec.md
 *
 * @vitest-environment node
 */

import { describe, it, expect, afterAll } from 'vitest';
// service-client MUST be imported first -- it loads dotenv for all env vars
import { serviceClient } from './helpers/service-client';
import { classifyContent } from '@/lib/ai/classify';
import { fetchIntelligenceSummary } from '@/lib/intelligence/summary';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Env var gating
// ---------------------------------------------------------------------------

const ENABLED = process.env.INTEGRATION_INTELLIGENCE === '1';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_PREFIX = `[SI-GOLDEN-${Date.now()}]`;

// Test user 1 (admin) -- must exist in auth.users and user_roles tables
const TEST_USER_ID = 'e21179e9-1946-43be-94a9-d566046da279';

// ---------------------------------------------------------------------------
// Shared state across sequential tests
// ---------------------------------------------------------------------------

let workspaceId: string | null = null;
let feedSourceId: string | null = null;
let feedArticleIds: string[] = [];
let contentItemIds: string[] = [];
let contentItemWorkspaceIds: string[] = [];

// Edge case test data to clean up
let edgeCaseWorkspaceIds: string[] = [];
let edgeCaseContentItemIds: string[] = [];
let cascadeTestContentItemIds: string[] = [];

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(async () => {
  if (!ENABLED) return;

  try {
    // 1. content_item_workspaces junction rows (CASCADE from both sides,
    //    but clean explicitly for safety)
    if (workspaceId) {
      await serviceClient
        .from('content_item_workspaces')
        .delete()
        .eq('workspace_id', workspaceId);
    }

    // 2. feed_articles (references feed_sources and content_items)
    for (const articleId of feedArticleIds) {
      await serviceClient.from('feed_articles').delete().eq('id', articleId);
    }

    // 3. feed_sources (references workspaces)
    if (feedSourceId) {
      await serviceClient
        .from('feed_sources')
        .delete()
        .eq('id', feedSourceId);
    }

    // 4. Entity data for content items (CASCADE from content_item deletion,
    //    but clean explicitly in case of partial failures)
    for (const itemId of contentItemIds) {
      await serviceClient
        .from('entity_relationships')
        .delete()
        .eq('source_item_id', itemId);
      await serviceClient
        .from('entity_mentions')
        .delete()
        .eq('content_item_id', itemId);
      await serviceClient
        .from('content_history')
        .delete()
        .eq('content_item_id', itemId);
    }

    // 5. Content items
    for (const itemId of contentItemIds) {
      await serviceClient.from('content_items').delete().eq('id', itemId);
    }

    // 6. Main workspace (cascade should handle remaining FKs)
    if (workspaceId) {
      await serviceClient.from('workspaces').delete().eq('id', workspaceId);
    }

    // 7. Edge case workspaces
    for (const wsId of edgeCaseWorkspaceIds) {
      await serviceClient.from('workspaces').delete().eq('id', wsId);
    }

    // 8. Edge case content items (survive workspace deletion)
    for (const itemId of edgeCaseContentItemIds) {
      await serviceClient
        .from('entity_relationships')
        .delete()
        .eq('source_item_id', itemId);
      await serviceClient
        .from('entity_mentions')
        .delete()
        .eq('content_item_id', itemId);
      await serviceClient
        .from('content_history')
        .delete()
        .eq('content_item_id', itemId);
      await serviceClient.from('content_items').delete().eq('id', itemId);
    }

    // 9. Cascade test content items
    for (const itemId of cascadeTestContentItemIds) {
      await serviceClient
        .from('entity_mentions')
        .delete()
        .eq('content_item_id', itemId);
      await serviceClient
        .from('entity_relationships')
        .delete()
        .eq('source_item_id', itemId);
      await serviceClient
        .from('content_history')
        .delete()
        .eq('content_item_id', itemId);
      await serviceClient.from('content_items').delete().eq('id', itemId);
    }

    // 10. Safety net: prefix-based cleanup for any stragglers
    await serviceClient
      .from('content_items')
      .delete()
      .like('title', `%${TEST_PREFIX}%`);

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

describe.skipIf(!ENABLED)(
  'SI Golden Path Real DB Integration',
  () => {
    // -----------------------------------------------------------------------
    // Step 1: Create intelligence workspace
    // -----------------------------------------------------------------------
    it('Step 1: Create intelligence workspace', async () => {
      const { data, error } = await serviceClient
        .from('workspaces')
        .insert({
          name: `${TEST_PREFIX} Test Intelligence Workspace`,
          type: 'intelligence',
          domain_metadata: {},
        })
        .select('id')
        .single();

      expect(error).toBeNull();
      expect(data).toBeTruthy();
      expect(data!.id).toBeTruthy();

      workspaceId = data!.id;

      // Re-query to confirm workspace exists with correct type
      const { data: verify, error: verifyErr } = await serviceClient
        .from('workspaces')
        .select('id, name, type')
        .eq('id', workspaceId)
        .single();

      expect(verifyErr).toBeNull();
      expect(verify?.type).toBe('intelligence');
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
        .select('id, workspace_id, consecutive_failures, article_count, is_active')
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

      const articles = [
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
          relevance_category: 'high' as const,
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
          relevance_category: 'medium' as const,
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
          raw_content: 'A new restaurant has opened in central London serving modern British cuisine.',
          relevance_score: 0.05,
          relevance_category: 'irrelevant' as const,
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
    // Step 4: Create content items for passed articles
    // -----------------------------------------------------------------------
    it('Step 4: Create content items for passed articles', async () => {
      expect(feedArticleIds.length).toBe(3);

      // Query passed articles
      const { data: passedArticles } = await serviceClient
        .from('feed_articles')
        .select('id, title, raw_content, external_url, published_at')
        .eq('workspace_id', workspaceId!)
        .eq('passed', true);

      expect(passedArticles).toBeTruthy();
      expect(passedArticles!.length).toBe(2);

      for (const article of passedArticles!) {
        // Create content item
        const { data: contentItem, error } = await serviceClient
          .from('content_items')
          .insert({
            title: article.title,
            content: article.raw_content,
            content_type: 'article',
            source_url: article.external_url,
            metadata: {
              source: 'intelligence_pipeline',
              feed_source_id: feedSourceId,
              feed_source_name: `${TEST_PREFIX} Test RSS Feed`,
              published_at: article.published_at,
            },
          })
          .select('id')
          .single();

        expect(error).toBeNull();
        expect(contentItem).toBeTruthy();
        contentItemIds.push(contentItem!.id);

        // Link back to feed_article
        const { error: updateErr } = await serviceClient
          .from('feed_articles')
          .update({ content_item_id: contentItem!.id })
          .eq('id', article.id);

        expect(updateErr).toBeNull();
      }

      expect(contentItemIds.length).toBe(2);

      // Verify content items have correct metadata
      for (const itemId of contentItemIds) {
        const { data: item } = await serviceClient
          .from('content_items')
          .select('content_type, source_url, metadata')
          .eq('id', itemId)
          .single();

        expect(item).toBeTruthy();
        expect(item!.content_type).toBe('article');
        const meta = item!.metadata as Record<string, unknown>;
        expect(meta?.source).toBe('intelligence_pipeline');
      }
    });

    // -----------------------------------------------------------------------
    // Step 5: Classify content items (real AI API call)
    // -----------------------------------------------------------------------
    it(
      'Step 5: Classify content items',
      async () => {
        expect(contentItemIds.length).toBe(2);

        for (const itemId of contentItemIds) {
          const result = await classifyContent({
            supabase: serviceClient,
            itemId,
            force: true,
            userId: TEST_USER_ID,
          });

          // AI is non-deterministic -- use flexible assertions
          expect(result.primary_domain).toBeTruthy();
          expect(result.primary_subtopic).toBeTruthy();
          expect(result.classification_confidence).toBeGreaterThan(0);

          // Verify the DB was updated
          const { data: classified } = await serviceClient
            .from('content_items')
            .select('primary_domain, primary_subtopic, classified_at, embedding')
            .eq('id', itemId)
            .single();

          expect(classified?.primary_domain).toBeTruthy();
          expect(classified?.primary_subtopic).toBeTruthy();
          expect(classified?.classified_at).toBeTruthy();
          expect(classified?.embedding).toBeTruthy();
        }
      },
      90_000,
    );

    // -----------------------------------------------------------------------
    // Step 6: Link content items to workspace via junction table
    // -----------------------------------------------------------------------
    it('Step 6: Link content items to workspace via junction table', async () => {
      expect(workspaceId).toBeTruthy();
      expect(contentItemIds.length).toBe(2);

      for (const itemId of contentItemIds) {
        const { data, error } = await serviceClient
          .from('content_item_workspaces')
          .insert({
            workspace_id: workspaceId!,
            content_item_id: itemId,
          })
          .select('id')
          .single();

        expect(error).toBeNull();
        expect(data).toBeTruthy();
        contentItemWorkspaceIds.push(data!.id);
      }

      // Verify both junction rows exist
      const { data: junctionRows } = await serviceClient
        .from('content_item_workspaces')
        .select('content_item_id')
        .eq('workspace_id', workspaceId!);

      expect(junctionRows).toBeTruthy();
      expect(junctionRows!.length).toBe(2);

      const linkedIds = junctionRows!.map((r) => r.content_item_id);
      for (const itemId of contentItemIds) {
        expect(linkedIds).toContain(itemId);
      }
    });

    // -----------------------------------------------------------------------
    // Step 7: Verify workspace-scoped article query
    // -----------------------------------------------------------------------
    it('Step 7: Verify workspace-scoped article query', async () => {
      expect(workspaceId).toBeTruthy();

      const { data: allArticles, error: allErr } = await serviceClient
        .from('feed_articles')
        .select('id, title, passed, relevance_score, content_item_id')
        .eq('workspace_id', workspaceId!);

      expect(allErr).toBeNull();
      expect(allArticles).toBeTruthy();
      expect(allArticles!.length).toBe(3);

      const { data: passedArticles, error: passedErr } = await serviceClient
        .from('feed_articles')
        .select('id, title, content_item_id')
        .eq('workspace_id', workspaceId!)
        .eq('passed', true);

      expect(passedErr).toBeNull();
      expect(passedArticles).toBeTruthy();
      expect(passedArticles!.length).toBe(2);

      // All passed articles have content_item_id set
      for (const article of passedArticles!) {
        expect(article.content_item_id).toBeTruthy();
      }

      // The filtered article has no content_item_id
      const { data: filteredArticles } = await serviceClient
        .from('feed_articles')
        .select('id, content_item_id')
        .eq('workspace_id', workspaceId!)
        .eq('passed', false);

      expect(filteredArticles).toBeTruthy();
      expect(filteredArticles!.length).toBe(1);
      expect(filteredArticles![0].content_item_id).toBeNull();
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
    // Step 9: Verify workspace-scoped content item query
    // -----------------------------------------------------------------------
    it('Step 9: Verify workspace-scoped content item query via junction', async () => {
      expect(workspaceId).toBeTruthy();

      const { data: workspaceItems, error } = await serviceClient
        .from('content_item_workspaces')
        .select('content_item_id')
        .eq('workspace_id', workspaceId!);

      expect(error).toBeNull();
      expect(workspaceItems).toBeTruthy();
      expect(workspaceItems!.length).toBe(2);

      const itemIds = workspaceItems!.map((r) => r.content_item_id);
      for (const id of contentItemIds) {
        expect(itemIds).toContain(id);
      }
    });

    // -----------------------------------------------------------------------
    // Step 10: Full chain verification
    // -----------------------------------------------------------------------
    it('Step 10: Full chain verification', async () => {
      expect(workspaceId).toBeTruthy();

      // Workspace exists with correct type
      const { data: ws } = await serviceClient
        .from('workspaces')
        .select('id, type')
        .eq('id', workspaceId!)
        .single();
      expect(ws).toBeTruthy();
      expect(ws!.type).toBe('intelligence');

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

      // 2 content items with classification data
      for (const itemId of contentItemIds) {
        const { data: item } = await serviceClient
          .from('content_items')
          .select('id, primary_domain, primary_subtopic, embedding, classified_at')
          .eq('id', itemId)
          .single();
        expect(item).toBeTruthy();
        expect(item!.primary_domain).toBeTruthy();
        expect(item!.primary_subtopic).toBeTruthy();
        expect(item!.classified_at).toBeTruthy();
        expect(item!.embedding).toBeTruthy();
      }

      // 2 junction rows
      const { data: junctions } = await serviceClient
        .from('content_item_workspaces')
        .select('content_item_id')
        .eq('workspace_id', workspaceId!);
      expect(junctions!.length).toBe(2);

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
  },
);

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
        type: 'intelligence',
        domain_metadata: {},
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
        type: 'intelligence',
        domain_metadata: {},
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

  // -------------------------------------------------------------------------
  // 4.5 Workspace deletion cascade
  // -------------------------------------------------------------------------
  it('Workspace deletion cascades to sources and articles but not content items', async () => {
    // Create a dedicated cascade test workspace
    const { data: cascadeWs } = await serviceClient
      .from('workspaces')
      .insert({
        name: `${TEST_PREFIX} Cascade Test Workspace`,
        type: 'intelligence',
        domain_metadata: {},
      })
      .select('id')
      .single();

    expect(cascadeWs).toBeTruthy();

    // Create a feed source
    const { data: cascadeSource } = await serviceClient
      .from('feed_sources')
      .insert({
        workspace_id: cascadeWs!.id,
        name: `${TEST_PREFIX} Cascade Feed`,
        url: 'https://example.com/cascade-feed.xml',
        source_type: 'rss',
      })
      .select('id')
      .single();

    expect(cascadeSource).toBeTruthy();

    // Create a feed article
    const { data: cascadeArticle } = await serviceClient
      .from('feed_articles')
      .insert({
        workspace_id: cascadeWs!.id,
        feed_source_id: cascadeSource!.id,
        external_url: `https://example.com/${TEST_PREFIX}/cascade-article`,
        title: `${TEST_PREFIX} Cascade Test Article`,
        passed: true,
      })
      .select('id')
      .single();

    expect(cascadeArticle).toBeTruthy();

    // Create a content item and link it
    const { data: cascadeItem } = await serviceClient
      .from('content_items')
      .insert({
        title: `${TEST_PREFIX} Cascade Content Item`,
        content: 'Test content for cascade verification.',
        content_type: 'article',
      })
      .select('id')
      .single();

    expect(cascadeItem).toBeTruthy();
    cascadeTestContentItemIds.push(cascadeItem!.id);

    // Link via junction
    await serviceClient.from('content_item_workspaces').insert({
      workspace_id: cascadeWs!.id,
      content_item_id: cascadeItem!.id,
    });

    // Link article to content item
    await serviceClient
      .from('feed_articles')
      .update({ content_item_id: cascadeItem!.id })
      .eq('id', cascadeArticle!.id);

    // Now delete the workspace
    const { error: deleteErr } = await serviceClient
      .from('workspaces')
      .delete()
      .eq('id', cascadeWs!.id);

    expect(deleteErr).toBeNull();

    // Verify: feed_sources deleted
    const { data: remainingSources } = await serviceClient
      .from('feed_sources')
      .select('id')
      .eq('id', cascadeSource!.id);
    expect(remainingSources).toEqual([]);

    // Verify: feed_articles deleted
    const { data: remainingArticles } = await serviceClient
      .from('feed_articles')
      .select('id')
      .eq('id', cascadeArticle!.id);
    expect(remainingArticles).toEqual([]);

    // Verify: content_item_workspaces junction deleted
    const { data: remainingJunctions } = await serviceClient
      .from('content_item_workspaces')
      .select('id')
      .eq('workspace_id', cascadeWs!.id);
    expect(remainingJunctions).toEqual([]);

    // Verify: content item SURVIVES (not cascade-deleted)
    const { data: survivingItem } = await serviceClient
      .from('content_items')
      .select('id')
      .eq('id', cascadeItem!.id)
      .single();
    expect(survivingItem).toBeTruthy();
  });
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

  // -------------------------------------------------------------------------
  // 5.2 Content item source metadata
  // -------------------------------------------------------------------------
  it('Content items from pipeline have correct source metadata', async () => {
    expect(contentItemIds.length).toBe(2);

    for (const itemId of contentItemIds) {
      const { data: item } = await serviceClient
        .from('content_items')
        .select('content_type, source_url, metadata')
        .eq('id', itemId)
        .single();

      expect(item).toBeTruthy();
      expect(item!.content_type).toBe('article');

      const meta = item!.metadata as Record<string, unknown>;
      expect(meta.source).toBe('intelligence_pipeline');
      expect(meta.feed_source_id).toBe(feedSourceId);
      expect(meta.feed_source_name).toBeTruthy();
      expect(typeof meta.feed_source_name).toBe('string');

      // source_url should match the article's external_url
      expect(item!.source_url).toBeTruthy();
      expect(item!.source_url).toContain('example.com');
    }
  });

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
    let viewerClient: ReturnType<typeof createClient>;

    it('Authenticate as viewer', async () => {
      viewerClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
      });

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
        .update({ passed: false })
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
