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
import { logger } from '@/lib/logger';

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
 * Minimum content length (post-normalisation, pre-hash) before we apply
 * content-hash dedup. Short strings (e.g. a 20-word Q&A) collide too
 * easily after punctuation/whitespace stripping. Below the threshold
 * callers should fall through to title-norm or skip dedup entirely.
 * Reference: cross-system-dedup-spec.md §6 Risks.
 */
export const DEDUP_MIN_CONTENT_LENGTH = 50;

/** Outcome of the shared dedup gate used by every TS entry point. */
/** @public */
export interface ExactDuplicateCheck {
  isDuplicate: boolean;
  existingId?: string;
  existingTitle?: string;
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
 * Computes the hash client-side for the input text, then uses the find_exact_duplicates
 * RPC to match against the stored content_text_hash generated column.
 * No content text is transferred -- only the 32-char hex hash is sent to the DB.
 */
async function findExactDuplicates(
  supabase: SupabaseClient<Database>,
  contentText: string,
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const normalised = normaliseTextForHash(contentText);
  if (!normalised) return [];

  const crypto = await import('crypto');
  const hash = crypto.createHash('md5').update(normalised).digest('hex');

  const { data: results, error } = await supabase.rpc('find_exact_duplicates', {
    p_content_hash: hash,
    p_exclude_id: excludeId ?? undefined,
  });

  if (error || !results) {
    logger.error({ err: error }, 'Exact dedup query failed');
    return [];
  }

  return (results as Array<{ id: string; title: string }>).map((r) => ({
    id: r.id,
    title: r.title ?? 'Untitled',
    similarity: 1.0,
    match_type: 'exact' as const,
  }));
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
    logger.error({ err: error }, 'Near-duplicate search failed');
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
  const threshold =
    options.nearDuplicateThreshold ?? DEFAULT_NEAR_DUPLICATE_THRESHOLD;
  const allMatches: DuplicateMatch[] = [];

  // 1. Exact match check
  try {
    const exactMatches = await findExactDuplicates(
      supabase,
      contentText,
      options.excludeId,
    );
    allMatches.push(...exactMatches);
  } catch (err) {
    logger.error({ err }, 'Exact dedup check failed');
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
      logger.error({ err }, 'Near-duplicate check failed');
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
 * Shared dedup gate — returns the first exact-hash match (if any).
 *
 * Used by every TS entry point that inserts into `content_items` so
 * duplicate content is caught consistently. Soft-block contract:
 * callers should proceed with the insert and stamp
 * `dedup_status = 'suspected_duplicate'` when `isDuplicate` is true.
 * Admins can override via `skip_dedup=true` at the caller.
 *
 * Reference: docs/specs/cross-system-dedup-spec.md §3.1
 */
export async function checkExactDuplicate(
  supabase: SupabaseClient<Database>,
  contentText: string,
  options: { excludeId?: string } = {},
): Promise<ExactDuplicateCheck> {
  const normalised = normaliseTextForHash(contentText);
  if (!normalised || normalised.length < DEDUP_MIN_CONTENT_LENGTH) {
    return { isDuplicate: false };
  }
  const matches = await findExactDuplicates(
    supabase,
    contentText,
    options.excludeId,
  );
  const first = matches[0];
  if (!first) return { isDuplicate: false };
  return {
    isDuplicate: true,
    existingId: first.id,
    existingTitle: first.title,
  };
}

/**
 * Resolve dedup stamp fields for an insert/update payload.
 *
 * Soft-block contract (spec §6 D1): callers proceed with the write and
 * stamp `dedup_status='suspected_duplicate'` + record the existing item
 * id in `metadata.suspected_duplicate_of` when an exact-hash match is
 * found. Admin-only `skipDedup=true` silently bypasses the stamp.
 *
 * Usage:
 *   const exact = dedupResult.matches.find(m => m.match_type === 'exact');
 *   const { dedup_status, suspected_duplicate_of } =
 *     resolveDedupStamp(exact?.id, { skipDedup });
 *   // set insertData.dedup_status + merge suspected_duplicate_of into metadata
 *
 * Reference: docs/specs/cross-system-dedup-spec.md §6 D1, D2
 */
export function resolveDedupStamp(
  existingId: string | undefined,
  options: { skipDedup?: boolean } = {},
): {
  dedup_status: 'clean' | 'suspected_duplicate';
  suspected_duplicate_of?: string;
} {
  if (options.skipDedup || !existingId) {
    return { dedup_status: 'clean' };
  }
  return {
    dedup_status: 'suspected_duplicate',
    suspected_duplicate_of: existingId,
  };
}

/**
 * Format dedup matches into a human-readable warning string.
 */
export function formatDedupWarning(result: DedupResult): string | null {
  if (!result.has_duplicates) return null;

  const exactCount = result.matches.filter(
    (m) => m.match_type === 'exact',
  ).length;
  const nearCount = result.matches.filter(
    (m) => m.match_type === 'near_duplicate',
  ).length;

  const parts: string[] = [];
  if (exactCount > 0) {
    parts.push(
      `${exactCount} exact duplicate${exactCount > 1 ? 's' : ''} found`,
    );
  }
  if (nearCount > 0) {
    parts.push(`${nearCount} near-duplicate${nearCount > 1 ? 's' : ''} found`);
  }

  const titles = result.matches
    .slice(0, 3)
    .map((m) => `"${m.title}" (${(m.similarity * 100).toFixed(0)}%)`)
    .join(', ');

  return `Potential duplicates: ${parts.join(', ')}. Matches: ${titles}`;
}
