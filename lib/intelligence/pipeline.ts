// lib/intelligence/pipeline.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { sb } from '@/lib/supabase/safe';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import { getIntelligenceWorkspaceContext } from './workspace-context';
import { pollFeed, pollWebSource } from './feed-poller';
import {
  extractContent,
  checkFirecrawlApiKey,
  isGoogleNewsUrl,
  resolveGoogleNewsUrl,
} from './content-extractor';
import { normaliseUrl } from '@/lib/extraction/url-normalise';
import { embeddingPreFilter, scoreRelevance } from './relevance-scorer';
import { generateArticleSummary } from './article-summariser';
import { generateEmbedding } from '@/lib/ai/embed';
import type {
  CompanyContext,
  FeedProcessingResult,
  PipelineRunResult,
  PollResult,
} from './types';
import { SOURCES_PER_INVOCATION, DEFAULT_RELEVANCE_THRESHOLD } from './types';
import { RateLimitError } from './rate-limiter';
import { logger } from '@/lib/logger';

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
  source_type?: 'rss' | 'web' | 'api';
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

/** Result of loading workspace context including company profile and workspace-level settings */
interface WorkspaceContext {
  companyContext: CompanyContext | null;
  relevanceThreshold: number;
  profileId: string | null;
}

/** Load company context for relevance scoring and workspace-level settings */
async function loadWorkspaceContext(
  supabase: Supabase,
  workspaceId: string,
): Promise<WorkspaceContext> {
  // Canonical workspace context (pre-T2: helper reads JSONB; post-T2: reads
  // intelligence_workspaces satellite via JOIN — pipeline does not change).
  const context = await getIntelligenceWorkspaceContext(supabase, workspaceId);

  // SI-L5: pipeline behaviour gate — fall back to default when the
  // workspace-level threshold is unset or out of range. The helper returns
  // `null` for both cases.
  const relevanceThreshold =
    context.relevanceThreshold ?? DEFAULT_RELEVANCE_THRESHOLD;

  const profileId = context.companyProfileId;
  if (!profileId)
    return { companyContext: null, relevanceThreshold, profileId: null };

  const profile = await sb(
    supabase
      .from('company_profiles')
      .select(
        'name, sectors, services, key_topics, target_customers, value_proposition',
      )
      .eq('id', profileId)
      .maybeSingle(),
    'intelligence.pipeline.company-profile.load',
  );

  if (!profile)
    return { companyContext: null, relevanceThreshold, profileId: null };

  return {
    companyContext: {
      name: profile.name,
      sectors: profile.sectors ?? [],
      services: profile.services ?? [],
      keyTopics: profile.key_topics ?? [],
      targetCustomers: profile.target_customers,
      valueProposition: profile.value_proposition,
    },
    relevanceThreshold,
    profileId,
  };
}

// ID-131 {131.11} G-SEARCH residual (T4-OQ-1 MIGRATE): the cache lives in the
// polymorphic record_embeddings store (owner_kind='company_profile'), not the
// retired company_profiles.company_embedding TEXT column. Model literal
// matches the M5 search consumers' convention (lib/mcp/tools/search.ts,
// 20260702120000_id131_search_rpcs.sql) rather than lib/ai/embed.ts's
// getEmbeddingModel() — every record_embeddings row this pipeline reads or
// writes uses this fixed model string. Exported so the profile PATCH route
// (app/api/intelligence/profiles/[id]/route.ts) can invalidate the SAME
// (owner_kind, owner_id, model) row this cache reads/writes — a duplicated
// literal would silently drift if either side changed model.
export const COMPANY_PROFILE_EMBEDDING_MODEL = 'text-embedding-3-large';

/** Load cached company embedding, or generate and cache it */
async function loadOrGenerateCompanyEmbedding(
  supabase: Supabase,
  profileId: string,
  companyContext: CompanyContext,
): Promise<number[] | null> {
  // Check for cached embedding
  const cached = await sb(
    supabase
      .from('record_embeddings')
      .select('embedding')
      .eq('owner_kind', 'company_profile')
      .eq('owner_id', profileId)
      .eq('model', COMPANY_PROFILE_EMBEDDING_MODEL)
      .maybeSingle(),
    'intelligence.pipeline.company-embedding.load',
  );

  if (cached?.embedding) {
    try {
      const parsed =
        typeof cached.embedding === 'string'
          ? (JSON.parse(cached.embedding) as number[])
          : (cached.embedding as unknown as number[]);
      return parsed;
    } catch {
      // Invalid cached value — regenerate
    }
  }

  // Generate new embedding
  const profileText = [
    companyContext.name,
    ...companyContext.sectors,
    ...companyContext.keyTopics,
    companyContext.valueProposition ?? '',
  ].join('. ');

  const embedding = await generateEmbedding(profileText);

  // Cache the embedding — upsert on the M1b UNIQUE (owner_kind, owner_id,
  // model) so a re-generation replaces the prior row for this profile.
  // sb() fail-fasts on a Postgrest error (checked, not a bare unchecked
  // await) — the caller (runPipeline's per-workspace loop) already wraps
  // this whole call in a try/catch that degrades to companyEmbedding = null
  // + a best-effort warn for this workspace only, so a thrown cache-write
  // error is handled exactly like a failed generation.
  await sb(
    supabase.from('record_embeddings').upsert(
      {
        owner_kind: 'company_profile',
        owner_id: profileId,
        model: COMPANY_PROFILE_EMBEDDING_MODEL,
        embedding: JSON.stringify(embedding),
      },
      { onConflict: 'owner_kind,owner_id,model' },
    ),
    'intelligence.pipeline.company-embedding.cache',
  );

  return embedding;
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
  const urlMatches = await sb(
    supabase
      .from('feed_articles')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('external_url', normalisedUrl)
      .limit(1),
    'intelligence.pipeline.dedup.by-url',
  );

  if (urlMatches.length > 0) return true;

  // Also check by GUID if present
  if (guid) {
    const guidMatches = await sb(
      supabase
        .from('feed_articles')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('external_id', guid)
        .limit(1),
      'intelligence.pipeline.dedup.by-guid',
    );

    if (guidMatches.length > 0) return true;
  }

  return false;
}

/** Get the active feed prompt for a workspace (id + prompt_text for scoring) */
async function getActivePrompt(
  supabase: Supabase,
  workspaceId: string,
): Promise<{ id: string; promptText: string } | null> {
  const prompts = await sb(
    supabase
      .from('feed_prompts')
      .select('id, prompt_text')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .limit(1),
    'intelligence.pipeline.active-prompt.load',
  );

  if (!prompts[0]) return null;
  return { id: prompts[0].id, promptText: prompts[0].prompt_text };
}

/** Process a single feed source: poll → extract → dedup → score → store */
export async function processFeedSource(
  supabase: Supabase,
  source: FeedSource,
  companyContext: CompanyContext | null,
  companyEmbedding: number[] | null,
  activePrompt?: { id: string; promptText: string } | null,
  relevanceThreshold: number = DEFAULT_RELEVANCE_THRESHOLD,
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

  // 1. Poll the feed (branch on source_type for web vs RSS)
  let pollResult: PollResult;
  try {
    pollResult =
      source.source_type === 'web'
        ? await pollWebSource(source)
        : await pollFeed(source);
  } catch (err) {
    // Record rate-limit errors with a distinct status for monitoring
    if (err instanceof RateLimitError) {
      const msg = `Rate limited by ${err.hostname}`;
      result.errors.push(`Poll failed: ${msg}`);
      await updateSourceAfterPoll(supabase, source, 'error', null, null, msg);
      result.durationMs = Date.now() - startTime;
      return result;
    }
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

    // OPS-57: Resolve Google News redirect URLs to the canonical publisher URL
    // BEFORE dedup and feed_articles storage. Different Google News search
    // queries can wrap the same underlying article in different opaque
    // wrapper URLs (e.g. /articles/CBMi…1 vs /articles/CBMi…2 → both resolve
    // to https://www.bbc.co.uk/news/...). Without this resolution, dedup
    // misses cross-feed duplicates and feed_articles.external_url stores an
    // unstable wrapper URL. For non-Google-News URLs this is a cheap no-op
    // (resolveGoogleNewsUrl returns input unchanged when isGoogleNewsUrl is
    // false). On resolution failure, falls back to the raw URL — preserves
    // pre-OPS-57 behaviour rather than dropping the item.
    const resolvedItemUrl = isGoogleNewsUrl(item.url)
      ? await resolveGoogleNewsUrl(item.url)
      : item.url;
    const normalisedUrl = normaliseUrl(resolvedItemUrl);

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
        logger.warn(
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
            relevance_reasoning: 'Content too short for reliable scoring',
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
            relevanceThreshold,
            activePrompt?.promptText,
          );
          passed = scoring.passed;
          relevanceScore = scoring.score;
          relevanceCategory = scoring.category;
          relevanceReasoning = scoring.reasoning;
          matchedCategories = scoring.matchedCategories;
        }
      }

      // 2d. Generate AI summary for passed articles only (cost efficiency)
      let aiSummary: string | null = null;
      if (passed) {
        try {
          aiSummary = await generateArticleSummary(
            extraction.title ?? item.title,
            extraction.content,
          );
        } catch {
          // Summary generation failure is non-fatal — store without summary
        }
      }

      // 2e. Store in feed_articles (all articles, passed and filtered)
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
          ai_summary: aiSummary,
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
        // ID-75 WP-E (BI-11): the gate-passed feed_articles row IS the
        // landing record. The Python cocoindex walk enumerates passed rows
        // and lands them as reference_items — the legacy TS promotion into
        // content_items is retired. runPipeline nudges the worker after
        // the run (D-3).
        result.articlesPassed++;
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

  const updateData: Database['public']['Tables']['feed_sources']['Update'] = {
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

/** Short timeout for the fire-and-forget walk nudge (D-3). */
const COCOINDEX_NUDGE_TIMEOUT_MS = 5_000;

/**
 * ID-75 WP-E (D-3, ratified OQ-T2): fire-and-forget nudge to the cocoindex
 * worker after a pipeline run that passed at least one article. The
 * gate-passed feed_articles rows are the ledger the Python walk enumerates;
 * the nudge merely shortens the latency between gate pass and KB landing.
 * A failed or undeliverable nudge is a DELAY, not a loss — the standing
 * hourly walk bounds the latency, so failures are caught and logged, never
 * propagated to the run result.
 */
function nudgeCocoindexWalk(articlesPassed: number): void {
  const workerUrl = process.env.COCOINDEX_WORKER_URL;
  if (!workerUrl) {
    logger.warn(
      { articlesPassed },
      '[Pipeline] COCOINDEX_WORKER_URL unset — skipping walk nudge; passed articles will be picked up by the next scheduled walk',
    );
    return;
  }

  // ID-127.18 (S436 D1): prefer the dedicated PIPELINE_TRIGGER_SECRET once
  // the env rollout has set it; fall back to the legacy shared CRON_SECRET
  // so the nudge keeps firing before every pipeline Coolify app + Vercel
  // deployment has the new secret. server.py's /walk auth dual-accepts
  // both during the transition, so either value authenticates.
  const pipelineTriggerSecret =
    process.env.PIPELINE_TRIGGER_SECRET || process.env.CRON_SECRET;
  if (!pipelineTriggerSecret) {
    logger.warn(
      { articlesPassed },
      '[Pipeline] PIPELINE_TRIGGER_SECRET/CRON_SECRET unset — skipping walk nudge; passed articles will be picked up by the next scheduled walk',
    );
    return;
  }

  void fetch(`${workerUrl}/walk`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pipelineTriggerSecret}` },
    signal: AbortSignal.timeout(COCOINDEX_NUDGE_TIMEOUT_MS),
  })
    .then((res) => {
      if (!res.ok) {
        logger.warn(
          { status: res.status, articlesPassed },
          '[Pipeline] Walk nudge rejected by cocoindex worker — ingest delayed until the next scheduled walk',
        );
      }
    })
    .catch((err: unknown) => {
      logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          articlesPassed,
        },
        '[Pipeline] Walk nudge failed — ingest delayed until the next scheduled walk',
      );
    });
}

/** Run the full pipeline: query due sources, process each, track in queue */
export async function runPipeline(
  supabase: Supabase,
): Promise<PipelineRunResult> {
  const startedAt = new Date().toISOString();

  // Check for Firecrawl API key once at pipeline startup
  checkFirecrawlApiKey();

  // Concurrency guard: skip feeds that already have an in-progress queue entry
  const inProgress = await sb(
    supabase
      .from('si_processing_queue')
      .select('feed_source_id')
      .eq('status', 'processing'),
    'intelligence.pipeline.queue.in-progress',
  );

  const inProgressSourceIds = new Set(inProgress.map((r) => r.feed_source_id));

  const allSources = await getDueFeedSources(supabase);
  const sources = allSources.filter((s) => !inProgressSourceIds.has(s.id));

  const feedResults: FeedProcessingResult[] = [];
  const errors: string[] = [];

  // SI-M2 (§2.1.8): group sources by workspace_id so per-workspace context,
  // active prompt, and company embedding are loaded ONCE per workspace per
  // pipeline run instead of once per source. Map preserves insertion order, so
  // sources still process in source-list order — just grouped by workspace.
  const sourcesByWorkspace = new Map<string, FeedSource[]>();
  for (const source of sources) {
    const existing = sourcesByWorkspace.get(source.workspace_id) ?? [];
    existing.push(source);
    sourcesByWorkspace.set(source.workspace_id, existing);
  }

  // Outer loop: per workspace — load context/prompt/embedding once
  for (const [workspaceId, workspaceSources] of sourcesByWorkspace) {
    // Load company context and workspace settings for this workspace
    const { companyContext, relevanceThreshold, profileId } =
      await loadWorkspaceContext(supabase, workspaceId);

    // Load active prompt for this workspace (fetched once, passed to all articles)
    const activePrompt = await getActivePrompt(supabase, workspaceId);

    // Load or generate company embedding for pre-filter (cached in DB)
    let companyEmbedding: number[] | null = null;
    if (companyContext && profileId) {
      try {
        companyEmbedding = await loadOrGenerateCompanyEmbedding(
          supabase,
          profileId,
          companyContext,
        );
      } catch (err) {
        // Pre-filter unavailable — skip it, still do LLM scoring. Crucially,
        // do NOT short-circuit the workspace iteration: this workspace's
        // sources still process (with `companyEmbedding = null`) and other
        // workspaces are unaffected.
        companyEmbedding = null;
        logBestEffortWarn(
          'intelligence.pipeline.embedding.load',
          'Company embedding generation failed',
          {
            workspaceId,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }

    // Inner loop: per source within the workspace — reuse the hoisted loads
    for (const source of workspaceSources) {
      // Create queue entry (preserved at per-source level — see Gotchas in
      // docs/specs/si-hardening-company-embedding-hoist.md §Queue ordering)
      const queueEntry = await sb(
        supabase
          .from('si_processing_queue')
          .insert({
            workspace_id: source.workspace_id,
            feed_source_id: source.id,
            status: 'processing',
            started_at: new Date().toISOString(),
          })
          .select('id')
          .single(),
        'intelligence.pipeline.queue.insert',
      );

      // Process the feed
      const feedResult = await processFeedSource(
        supabase,
        source,
        companyContext,
        companyEmbedding,
        activePrompt,
        relevanceThreshold,
      );
      feedResults.push(feedResult);
      errors.push(...feedResult.errors);

      // Update queue entry
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

  const totalArticlesPassed = feedResults.reduce(
    (sum, r) => sum + r.articlesPassed,
    0,
  );

  // D-3 (ID-75 WP-E): one nudge per run, only when something passed the
  // gate — the walk has nothing to pick up otherwise.
  if (totalArticlesPassed > 0) {
    nudgeCocoindexWalk(totalArticlesPassed);
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
    totalArticlesPassed,
    feedResults,
    errors,
  };
}
