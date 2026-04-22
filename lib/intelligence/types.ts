// lib/intelligence/types.ts

/** Result of parsing a single RSS feed */
export interface ParsedFeedItem {
  title: string;
  url: string;
  guid: string | null;
  publishedAt: string | null;
  summary: string | null;
  contentEncoded: string | null;
  categories: string[];
}

/** Result of polling a single feed source */
export interface PollResult {
  feedSourceId: string;
  status: 'success' | 'not_modified' | 'error' | 'timeout';
  error?: string;
  items: ParsedFeedItem[];
  /** ETag from response headers — stored on feed_sources for conditional requests */
  etag: string | null;
  /** Last-Modified from response headers — stored on feed_sources for conditional requests */
  lastModified: string | null;
}

/** Result of content extraction for a single article */
export interface ExtractionResult {
  content: string;
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  method: 'rss_content' | 'fetch' | 'jina_reader' | 'firecrawl' | 'summary_fallback';
  wordCount: number;
  /** Publisher URL resolved by Firecrawl (via metadata.sourceURL). Present only
   *  when extraction reaches the Firecrawl tier and the response includes a
   *  sourceURL that differs from the input URL. Used by the pipeline to prefer
   *  the real publisher URL over opaque redirect URLs (e.g. Google News). */
  resolvedUrl?: string;
}

/** Result of relevance scoring */
export interface RelevanceResult {
  score: number;
  category: 'high' | 'medium' | 'low' | 'irrelevant';
  reasoning: string;
  matchedCategories: string[];
  passed: boolean;
}

/** Embedding pre-filter result */
export interface PreFilterResult {
  similarity: number;
  passed: boolean;
}

/** Pipeline run summary for a single feed source */
export interface FeedProcessingResult {
  feedSourceId: string;
  feedSourceName: string;
  articlesFound: number;
  articlesNew: number;
  articlesPassed: number;
  articlesFailed: number;
  errors: string[];
  durationMs: number;
}

/** Full pipeline run summary */
export interface PipelineRunResult {
  runId: string;
  startedAt: string;
  completedAt: string;
  sourcesProcessed: number;
  totalArticlesFound: number;
  totalArticlesNew: number;
  totalArticlesPassed: number;
  feedResults: FeedProcessingResult[];
  errors: string[];
}

/** Company profile context for relevance scoring */
export interface CompanyContext {
  name: string;
  sectors: string[];
  services: string[];
  keyTopics: string[];
  targetCustomers: string | null;
  valueProposition: string | null;
}

// ── Constants ──

/** System user ID for pipeline operations (classifyContent requires a userId).
 *  This is a real service account in auth.users (email: pipeline@system.knowledge-hub.internal). */
export const PIPELINE_SYSTEM_USER_ID = 'a0000000-0000-4000-8000-000000000001';

/** Minimum word count to accept extracted content (below this, escalate to Firecrawl) */
export const MIN_CONTENT_WORDS = 100;

/** Embedding similarity threshold for pre-filter (deliberately low for high recall) */
export const EMBEDDING_PRE_FILTER_THRESHOLD = 0.25;

/** Default relevance score threshold for pass/fail */
export const DEFAULT_RELEVANCE_THRESHOLD = 0.5;

/** Maximum consecutive failures before a feed source is excluded from polling */
export const MAX_CONSECUTIVE_FAILURES = 10;

/** Maximum number of feed sources to process per cron invocation */
export const SOURCES_PER_INVOCATION = 10;

/** HTTP timeout for RSS feed fetching (ms) */
export const FEED_FETCH_TIMEOUT_MS = 30_000;

/** HTTP timeout for content extraction (ms) */
export const EXTRACTION_TIMEOUT_MS = 45_000;
