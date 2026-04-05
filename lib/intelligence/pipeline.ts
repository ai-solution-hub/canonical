// lib/intelligence/pipeline.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { pollFeed } from './feed-poller';
import {
  extractContent,
  normaliseUrl,
  checkFirecrawlApiKey,
} from './content-extractor';
import { embeddingPreFilter, scoreRelevance } from './relevance-scorer';
import { generateEmbedding } from '@/lib/ai/embed';
import { classifyContent } from '@/lib/ai/classify';
import type {
  CompanyContext,
  FeedProcessingResult,
  PipelineRunResult,
  PollResult,
} from './types';
import { PIPELINE_SYSTEM_USER_ID, SOURCES_PER_INVOCATION } from './types';

type Supabase = SupabaseClient<Database>;

interface FeedSource {
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

/** Query feed sources that are due for polling (respects polling_interval_minutes with exponential backoff) */
export async function getDueFeedSources(
  supabase: Supabase,
  limit: number = SOURCES_PER_INVOCATION,
): Promise<FeedSource[]> {
  const { data, error } = await supabase.rpc('get_due_feed_sources', {
    max_sources: limit,
  });

  if (error) {
    throw new Error(`Failed to query feed sources: ${error.message}`);
  }

  return (data ?? []) as FeedSource[];
}

/** Load company context for relevance scoring */
async function loadCompanyContext(
  supabase: Supabase,
  workspaceId: string,
): Promise<CompanyContext | null> {
  // Get workspace domain_metadata which may link to a company profile
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('domain_metadata')
    .eq('id', workspaceId)
    .single();

  const profileId = (workspace?.domain_metadata as Record<string, unknown>)
    ?.company_profile_id as string | undefined;
  if (!profileId) return null;

  const { data: profile } = await supabase
    .from('company_profiles')
    .select(
      'name, sectors, services, key_topics, target_customers, value_proposition',
    )
    .eq('id', profileId)
    .single();

  if (!profile) return null;

  return {
    name: profile.name,
    sectors: profile.sectors ?? [],
    services: profile.services ?? [],
    keyTopics: profile.key_topics ?? [],
    targetCustomers: profile.target_customers,
    valueProposition: profile.value_proposition,
  };
}

/** Check if an article URL already exists in feed_articles for this workspace */
async function isDuplicate(
  supabase: Supabase,
  workspaceId: string,
  url: string,
  guid: string | null,
): Promise<boolean> {
  // Normalise URL before checking
  const normalisedUrl = normaliseUrl(url);

  // Check by URL (unique index enforces this)
  const { data } = await supabase
    .from('feed_articles')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('external_url', normalisedUrl)
    .limit(1);

  if (data && data.length > 0) return true;

  // Also check by GUID if present
  if (guid) {
    const { data: guidMatch } = await supabase
      .from('feed_articles')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('external_id', guid)
      .limit(1);

    if (guidMatch && guidMatch.length > 0) return true;
  }

  return false;
}

/** Get the active feed prompt for a workspace (id + prompt_text for scoring) */
async function getActivePrompt(
  supabase: Supabase,
  workspaceId: string,
): Promise<{ id: string; promptText: string } | null> {
  const { data } = await supabase
    .from('feed_prompts')
    .select('id, prompt_text')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .limit(1);

  if (!data?.[0]) return null;
  return { id: data[0].id, promptText: data[0].prompt_text };
}

/** Process a single feed source: poll → extract → dedup → score → store */
export async function processFeedSource(
  supabase: Supabase,
  source: FeedSource,
  companyContext: CompanyContext | null,
  companyEmbedding: number[] | null,
  activePrompt?: { id: string; promptText: string } | null,
): Promise<FeedProcessingResult> {
  const startTime = Date.now();
  const result: FeedProcessingResult = {
    feedSourceId: source.id,
    feedSourceName: source.name,
    articlesFound: 0,
    articlesNew: 0,
    articlesPassed: 0,
    articlesFailed: 0,
    errors: [],
    durationMs: 0,
  };

  // 1. Poll the feed
  let pollResult: PollResult;
  try {
    pollResult = await pollFeed(source);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Poll failed: ${msg}`);
    await updateSourceAfterPoll(supabase, source, 'error', null, null, msg);
    result.durationMs = Date.now() - startTime;
    return result;
  }

  // Update source polling metadata (including etag and lastModified from response)
  await updateSourceAfterPoll(
    supabase,
    source,
    pollResult.status,
    pollResult.etag,
    pollResult.lastModified,
    pollResult.error,
  );

  if (pollResult.status !== 'success' || pollResult.items.length === 0) {
    result.durationMs = Date.now() - startTime;
    return result;
  }

  result.articlesFound = pollResult.items.length;

  // Use active prompt passed from runPipeline (fetched once per workspace)
  const promptVersionId = activePrompt?.id ?? null;

  // 2. Process each item
  for (const item of pollResult.items) {
    if (!item.url) continue;

    // Normalise URL for dedup and storage
    const normalisedUrl = normaliseUrl(item.url);

    // 2a. Dedup check
    const duplicate = await isDuplicate(
      supabase,
      source.workspace_id,
      normalisedUrl,
      item.guid,
    );
    if (duplicate) continue;

    result.articlesNew++;

    try {
      // 2b. Extract content
      const extraction = await extractContent(item);

      // 2b.5. Minimum content gate — skip scoring for very short content
      if (extraction.wordCount < 50) {
        console.warn(
          `[Pipeline] ${normalisedUrl} — content too short (${extraction.wordCount} words), skipping scoring`,
        );

        const { error: insertError } = await supabase
          .from('feed_articles')
          .insert({
            workspace_id: source.workspace_id,
            feed_source_id: source.id,
            external_url: normalisedUrl,
            external_id: item.guid,
            title: extraction.title ?? item.title,
            raw_content: extraction.content,
            relevance_score: 0,
            relevance_category: 'irrelevant' as const,
            relevance_reasoning:
              'Content too short for reliable scoring',
            matched_categories: [],
            ai_summary: null,
            prompt_version_id: promptVersionId,
            extraction_method: extraction.method,
            passed: false,
            published_at: item.publishedAt,
          });

        if (insertError && insertError.code !== '23505') {
          result.errors.push(
            `Insert failed for ${normalisedUrl}: ${insertError.message}`,
          );
          result.articlesFailed++;
        }
        continue;
      }

      // 2c. Relevance scoring — behaviour depends on company profile availability
      let passed = false;
      let relevanceScore = 0;
      let relevanceCategory: 'high' | 'medium' | 'low' | 'irrelevant' =
        'irrelevant';
      let relevanceReasoning = '';
      let matchedCategories: string[] = [];

      if (!companyContext) {
        // No company profile — do NOT pass articles to avoid KB pollution
        passed = false;
        relevanceReasoning = 'No company profile configured — scoring skipped';
      } else if (companyEmbedding) {
        // Stage 1: Embedding pre-filter
        const preFilter = await embeddingPreFilter(
          extraction.content,
          companyEmbedding,
        );

        if (!preFilter.passed) {
          // Failed pre-filter — store as filtered, skip LLM scoring
          passed = false;
          relevanceScore = preFilter.similarity;
          relevanceCategory = 'irrelevant';
          relevanceReasoning = `Failed embedding pre-filter (similarity: ${preFilter.similarity.toFixed(3)})`;
        } else {
          // Stage 2: LLM relevance scoring (with custom prompt text if available)
          const scoring = await scoreRelevance(
            item.title,
            extraction.content,
            companyContext,
            undefined, // use default threshold
            activePrompt?.promptText,
          );
          passed = scoring.passed;
          relevanceScore = scoring.score;
          relevanceCategory = scoring.category;
          relevanceReasoning = scoring.reasoning;
          matchedCategories = scoring.matchedCategories;
        }
      }

      // 2d. Store in feed_articles (all articles, passed and filtered)
      // Use relevance reasoning as ai_summary (lightweight, no extra API call)
      const { error: insertError } = await supabase
        .from('feed_articles')
        .insert({
          workspace_id: source.workspace_id,
          feed_source_id: source.id,
          external_url: normalisedUrl,
          external_id: item.guid,
          title: extraction.title ?? item.title,
          raw_content: extraction.content,
          relevance_score: relevanceScore,
          relevance_category: relevanceCategory,
          relevance_reasoning: relevanceReasoning,
          matched_categories: matchedCategories,
          ai_summary: relevanceReasoning || null,
          prompt_version_id: promptVersionId,
          extraction_method: extraction.method,
          passed,
          published_at: item.publishedAt,
        });

      if (insertError) {
        // Likely a unique constraint violation (race condition)
        if (insertError.code === '23505') continue;
        result.errors.push(
          `Insert failed for ${normalisedUrl}: ${insertError.message}`,
        );
        result.articlesFailed++;
        continue;
      }

      if (passed) {
        result.articlesPassed++;

        // 2e. For passed articles: create content_item + classify
        try {
          await storeAsContentItem(supabase, source, item, extraction);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(
            `Content item creation failed for ${normalisedUrl}: ${msg}`,
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Processing failed for ${normalisedUrl}: ${msg}`);
      result.articlesFailed++;
    }
  }

  // Update article_count on feed_sources
  if (result.articlesNew > 0) {
    await supabase
      .from('feed_sources')
      .update({ article_count: source.article_count + result.articlesNew })
      .eq('id', source.id);
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

/** Store a passed article as a content_item in the KB */
async function storeAsContentItem(
  supabase: Supabase,
  source: FeedSource,
  item: { title: string; url: string; publishedAt: string | null },
  extraction: {
    content: string;
    title: string | null;
    description: string | null;
    thumbnailUrl: string | null;
  },
): Promise<void> {
  // Create content item — no `status` column on content_items
  const { data: contentItem, error } = await supabase
    .from('content_items')
    .insert({
      title: extraction.title ?? item.title,
      content: extraction.content,
      content_type: 'article',
      source_url: item.url,
      metadata: {
        source: 'intelligence_pipeline',
        feed_source_id: source.id,
        feed_source_name: source.name,
        published_at: item.publishedAt,
        thumbnail_url: extraction.thumbnailUrl,
      },
    })
    .select('id')
    .single();

  if (error || !contentItem) return;

  // Update feed_article with content_item_id link
  await supabase
    .from('feed_articles')
    .update({ content_item_id: contentItem.id })
    .eq('workspace_id', source.workspace_id)
    .eq('external_url', item.url);

  // Classify the content item (adds taxonomy, entities, AND embeddings)
  // classifyContent already generates and stores embeddings — no separate embedding call needed
  try {
    await classifyContent({
      supabase,
      itemId: contentItem.id,
      force: true,
      userId: PIPELINE_SYSTEM_USER_ID,
    });
  } catch (err) {
    // Classification failure is non-fatal — item is still stored
    console.error(
      `[Pipeline] Classification failed for content item ${contentItem.id}:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // Assign to workspace via content_item_workspaces (NOT workspace_content)
  await supabase.from('content_item_workspaces').insert({
    workspace_id: source.workspace_id,
    content_item_id: contentItem.id,
  });
}

/** Update feed_sources after a poll attempt (including etag/lastModified for conditional requests) */
async function updateSourceAfterPoll(
  supabase: Supabase,
  source: FeedSource,
  status: string,
  etag: string | null,
  lastModified: string | null,
  error?: string,
): Promise<void> {
  const isSuccess = status === 'success' || status === 'not_modified';

  const updateData: Record<string, unknown> = {
    last_polled_at: new Date().toISOString(),
    last_polled_status: status as
      | 'success'
      | 'error'
      | 'timeout'
      | 'not_modified',
    last_polled_error: error ?? null,
    consecutive_failures: isSuccess ? 0 : source.consecutive_failures + 1,
  };

  // Store etag/lastModified from response headers for conditional requests
  if (etag !== null) {
    updateData.etag = etag;
  }
  if (lastModified !== null) {
    updateData.last_modified = lastModified;
  }

  await supabase.from('feed_sources').update(updateData).eq('id', source.id);
}

/** Run the full pipeline: query due sources, process each, track in queue */
export async function runPipeline(
  supabase: Supabase,
): Promise<PipelineRunResult> {
  const startedAt = new Date().toISOString();

  // Check for Firecrawl API key once at pipeline startup
  checkFirecrawlApiKey();

  // Concurrency guard: skip feeds that already have an in-progress queue entry
  const { data: inProgress } = await supabase
    .from('si_processing_queue')
    .select('feed_source_id')
    .eq('status', 'processing');

  const inProgressSourceIds = new Set(
    (inProgress ?? []).map((r) => r.feed_source_id),
  );

  const allSources = await getDueFeedSources(supabase);
  const sources = allSources.filter((s) => !inProgressSourceIds.has(s.id));

  const feedResults: FeedProcessingResult[] = [];
  const errors: string[] = [];

  for (const source of sources) {
    // Create queue entry
    const { data: queueEntry } = await supabase
      .from('si_processing_queue')
      .insert({
        workspace_id: source.workspace_id,
        feed_source_id: source.id,
        status: 'processing',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    // Load company context for this workspace
    const companyContext = await loadCompanyContext(
      supabase,
      source.workspace_id,
    );

    // Load active prompt for this workspace (fetched once, passed to all articles)
    const activePrompt = await getActivePrompt(supabase, source.workspace_id);

    // Generate company embedding for pre-filter (cached per workspace)
    let companyEmbedding: number[] | null = null;
    if (companyContext) {
      try {
        const profileText = [
          companyContext.name,
          ...companyContext.sectors,
          ...companyContext.keyTopics,
          companyContext.valueProposition ?? '',
        ].join('. ');
        companyEmbedding = await generateEmbedding(profileText);
      } catch (err) {
        // Pre-filter unavailable — skip it, still do LLM scoring
        console.error(
          `[Pipeline] Company embedding generation failed for workspace ${source.workspace_id}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // Process the feed
    const feedResult = await processFeedSource(
      supabase,
      source,
      companyContext,
      companyEmbedding,
      activePrompt,
    );
    feedResults.push(feedResult);
    errors.push(...feedResult.errors);

    // Update queue entry
    if (queueEntry) {
      await supabase
        .from('si_processing_queue')
        .update({
          status: feedResult.errors.length > 0 ? 'failed' : 'complete',
          completed_at: new Date().toISOString(),
          error_message:
            feedResult.errors.length > 0 ? feedResult.errors.join('; ') : null,
          articles_found: feedResult.articlesFound,
          articles_new: feedResult.articlesNew,
          articles_passed: feedResult.articlesPassed,
        })
        .eq('id', queueEntry.id);
    }
  }

  return {
    runId: crypto.randomUUID(),
    startedAt,
    completedAt: new Date().toISOString(),
    sourcesProcessed: sources.length,
    totalArticlesFound: feedResults.reduce(
      (sum, r) => sum + r.articlesFound,
      0,
    ),
    totalArticlesNew: feedResults.reduce((sum, r) => sum + r.articlesNew, 0),
    totalArticlesPassed: feedResults.reduce(
      (sum, r) => sum + r.articlesPassed,
      0,
    ),
    feedResults,
    errors,
  };
}
