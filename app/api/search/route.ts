import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  rateLimitResponse,
  authFailureResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { SearchBodySchema } from '@/lib/validation/schemas';
import { generateEmbedding } from '@/lib/ai/embed';
import { logger, updateRequestContext, withRequestContext } from '@/lib/logger';

export const maxDuration = 60;

/**
 * POST /api/search — hybrid (embedding + keyword) semantic search.
 *
 * Phase 2 (S15 WP1): wrapped with `withRequestContext` so every log line
 * and any Sentry event raised from inside the handler carries the shared
 * `requestId` minted upstream by `proxy.ts`. Highest-traffic read path.
 */
export const POST = withRequestContext(async (request: NextRequest) => {
  try {
    // Auth check
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    // Upgrade the request scope with the resolved user so subsequent
    // log lines + any Sentry events carry userId.
    updateRequestContext({ userId: user.id });

    // Rate limit: 30 requests per minute
    const rl = checkRateLimit(`search:${user.id}`, 30, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    const raw = await request.json();
    const parsed = parseBody(SearchBodySchema, raw);
    if (!parsed.success) return parsed.response;
    // TODO(backlog): `layer` filter is accepted by SearchBodySchema but
    // `hybrid_search` RPC does not return a `layer` column, so the filter
    // has never functioned. Either remove from the schema or extend the RPC
    // to return + filter by `layer`. Tracked in product-backlog.json.
    const { query, threshold, limit, layer: _layer } = parsed.data;

    // 1. Generate embedding via shared helper (singleton OpenAI client)
    let embedding: number[];
    try {
      embedding = await generateEmbedding(query.trim());
    } catch (err) {
      logger.error({ err, op: 'search.embed' }, 'OpenAI embedding error');
      return NextResponse.json(
        {
          error: 'Search unavailable — please try again',
          code: 'EMBEDDING_FAILED',
        },
        { status: 503 },
      );
    }

    // 2. Hybrid search: combines embedding similarity + keyword matching

    const { data: results, error: rpcError } = await supabase.rpc(
      'hybrid_search',
      {
        query_embedding: JSON.stringify(embedding),
        query_text: query.trim(),
        similarity_threshold: threshold,
        limit_count: limit,
      },
    );

    if (rpcError) {
      logger.error(
        { err: rpcError, op: 'search.hybrid_rpc' },
        'Search RPC error',
      );
      return NextResponse.json(
        { error: 'Search query failed' },
        { status: 500 },
      );
    }

    // Post-filter by content layer if specified.
    // NOTE: hybrid_search does not return a `layer` column; this filter has
    // no effect at present. The `layer` param is accepted for API stability
    // but silently ignored until the RPC is updated to include the column.
    const filtered = results ?? [];

    return NextResponse.json({
      results: filtered,
      count: filtered.length,
    });
  } catch (err) {
    logger.error({ err, op: 'search' }, 'Search failed');
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Search failed') },
      { status: 500 },
    );
  }
});
