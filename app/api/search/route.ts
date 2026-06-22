import { generateEmbedding } from '@/lib/ai/embed';
import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthenticatedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger, updateRequestContext, withRequestContext } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { SearchBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 60;

// TODO(OPS-T1): author ResponseSchema
export const POST = withRequestContext(
  defineRoute(z.unknown(), async (request: NextRequest) => {
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
      const { query, threshold, limit } = parsed.data;

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
  }),
);
