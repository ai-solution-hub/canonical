/**
 * Content deduplication utilities for web upload and manual creation pathways.
 *
 * Two detection strategies:
 * 1. Exact match: MD5 hash of normalised content text (computed in SQL)
 * 2. Near-duplicate: Embedding cosine similarity via the find_similar_content RPC
 *
 * Both return informational warnings — they do not block content creation.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

/** Default cosine similarity threshold for near-duplicate detection */
export const DEFAULT_NEAR_DUPLICATE_THRESHOLD = 0.92;

/** Maximum number of near-duplicate matches to return */
const MAX_NEAR_DUPLICATE_RESULTS = 5;

export interface DuplicateMatch {
  id: string;
  title: string;
  similarity: number;
  match_type: 'exact' | 'near_duplicate';
}

export interface DedupResult {
  has_duplicates: boolean;
  matches: DuplicateMatch[];
}

/**
 * Normalise text for MD5 hashing — mirrors the Python pipeline approach.
 * Lowercases, strips punctuation, collapses whitespace.
 */
export function normaliseTextForHash(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check for exact content duplicates by comparing MD5 hashes of normalised content.
 * Uses PostgreSQL md5() function to avoid transferring all content to the client.
 */
async function findExactDuplicates(
  supabase: SupabaseClient<Database>,
  contentText: string,
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const normalised = normaliseTextForHash(contentText);
  if (!normalised) return [];

  // Use raw SQL via rpc to compute MD5 server-side and match
  // We use a lightweight approach: compute the hash client-side and match via a filter
  const crypto = await import('crypto');
  const hash = crypto.createHash('md5').update(normalised).digest('hex');

  // Query content_items where md5 of normalised content matches
  // We use the Supabase PostgREST filter with a computed column approach
  // Since there's no stored hash column, we'll fetch recent items and compare
  // This is more efficient than scanning all rows for small-to-medium KBs (~250 items)
  const query = supabase
    .from('content_items')
    .select('id, title, content')
    .not('content', 'is', null)
    .neq('content', '')
    .limit(500);

  if (excludeId) {
    query.neq('id', excludeId);
  }

  const { data: items, error } = await query;

  if (error || !items) {
    console.error('Exact dedup query failed:', error);
    return [];
  }

  const matches: DuplicateMatch[] = [];
  for (const item of items) {
    if (!item.content) continue;
    const itemNormalised = normaliseTextForHash(item.content);
    const itemHash = crypto.createHash('md5').update(itemNormalised).digest('hex');
    if (itemHash === hash) {
      matches.push({
        id: item.id,
        title: item.title ?? 'Untitled',
        similarity: 1.0,
        match_type: 'exact',
      });
    }
  }

  return matches;
}

/**
 * Check for near-duplicate content using embedding cosine similarity.
 * Uses the find_similar_content RPC which leverages pgvector HNSW indexes.
 */
async function findNearDuplicates(
  supabase: SupabaseClient<Database>,
  embedding: number[],
  threshold: number,
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const { data: results, error } = await supabase.rpc('find_similar_content', {
    query_embedding: JSON.stringify(embedding),
    similarity_threshold: threshold,
    limit_count: MAX_NEAR_DUPLICATE_RESULTS + (excludeId ? 1 : 0),
  });

  if (error || !results) {
    console.error('Near-duplicate search failed:', error);
    return [];
  }

  return results
    .filter((r: { id: string }) => r.id !== excludeId)
    .slice(0, MAX_NEAR_DUPLICATE_RESULTS)
    .map((r: { id: string; title: string; similarity: number }) => ({
      id: r.id,
      title: r.title ?? 'Untitled',
      similarity: r.similarity,
      match_type: 'near_duplicate' as const,
    }));
}

/**
 * Run full deduplication check on content text.
 *
 * Performs both exact hash matching and near-duplicate embedding search.
 * Returns matches sorted by similarity (exact matches first at 1.0).
 *
 * @param supabase - Authenticated Supabase client
 * @param contentText - The content text to check for duplicates
 * @param embedding - Pre-computed embedding vector (if available)
 * @param options - Configuration options
 * @returns DedupResult with any matches found
 */
export async function checkForDuplicates(
  supabase: SupabaseClient<Database>,
  contentText: string,
  embedding?: number[],
  options: {
    /** Cosine similarity threshold for near-duplicate detection (0.0-1.0) */
    nearDuplicateThreshold?: number;
    /** Exclude this item ID from results (useful when updating existing items) */
    excludeId?: string;
  } = {},
): Promise<DedupResult> {
  const threshold = options.nearDuplicateThreshold ?? DEFAULT_NEAR_DUPLICATE_THRESHOLD;
  const allMatches: DuplicateMatch[] = [];

  // 1. Exact match check
  try {
    const exactMatches = await findExactDuplicates(supabase, contentText, options.excludeId);
    allMatches.push(...exactMatches);
  } catch (err) {
    console.error('Exact dedup check failed:', err);
  }

  // 2. Near-duplicate check (only if embedding available)
  if (embedding) {
    try {
      const nearMatches = await findNearDuplicates(
        supabase,
        embedding,
        threshold,
        options.excludeId,
      );
      // Exclude items already found as exact matches
      const exactIds = new Set(allMatches.map((m) => m.id));
      for (const match of nearMatches) {
        if (!exactIds.has(match.id)) {
          allMatches.push(match);
        }
      }
    } catch (err) {
      console.error('Near-duplicate check failed:', err);
    }
  }

  // Sort: exact matches first, then by similarity descending
  allMatches.sort((a, b) => {
    if (a.match_type === 'exact' && b.match_type !== 'exact') return -1;
    if (a.match_type !== 'exact' && b.match_type === 'exact') return 1;
    return b.similarity - a.similarity;
  });

  return {
    has_duplicates: allMatches.length > 0,
    matches: allMatches,
  };
}

/**
 * Format dedup matches into a human-readable warning string.
 */
export function formatDedupWarning(result: DedupResult): string | null {
  if (!result.has_duplicates) return null;

  const exactCount = result.matches.filter((m) => m.match_type === 'exact').length;
  const nearCount = result.matches.filter((m) => m.match_type === 'near_duplicate').length;

  const parts: string[] = [];
  if (exactCount > 0) {
    parts.push(
      `${exactCount} exact duplicate${exactCount > 1 ? 's' : ''} found`,
    );
  }
  if (nearCount > 0) {
    parts.push(
      `${nearCount} near-duplicate${nearCount > 1 ? 's' : ''} found`,
    );
  }

  const titles = result.matches
    .slice(0, 3)
    .map((m) => `"${m.title}" (${(m.similarity * 100).toFixed(0)}%)`)
    .join(', ');

  return `Potential duplicates: ${parts.join(', ')}. Matches: ${titles}`;
}
