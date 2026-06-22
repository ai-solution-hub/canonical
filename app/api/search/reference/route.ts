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
import { ReferenceSearchBodySchema } from '@/lib/validation/schemas';
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

      // Rate limit: 30 requests per minute (mirrors /api/search)
      const rl = checkRateLimit(`search:reference:${user.id}`, 30, 60_000);
      if (!rl.allowed) return rateLimitResponse(rl.resetAt);

      const raw = await request.json();
      const parsed = parseBody(ReferenceSearchBodySchema, raw);
      if (!parsed.success) return parsed.response;
      const { query, limit } = parsed.data;

      // 1. Generate embedding via shared helper (singleton OpenAI client)
      let embedding: number[];
      try {
        embedding = await generateEmbedding(query.trim());
      } catch (err) {
        logger.error(
          { err, op: 'search.reference_embed' },
          'OpenAI embedding error',
        );
        return NextResponse.json(
          {
            error: 'Search unavailable — please try again',
            code: 'EMBEDDING_FAILED',
          },
          { status: 503 },
        );
      }

      // 2. Reference-scoped search: the ID-71 shared RPC seam, called as-is.
      //    `p_query_embedding` is JSON-stringified for the pgvector param.
      const { data: results, error: rpcError } = await supabase.rpc(
        'reference_search',
        {
          p_query: query.trim(),
          p_query_embedding: JSON.stringify(embedding),
          p_limit: limit,
        },
      );

      if (rpcError) {
        logger.error(
          { err: rpcError, op: 'search.reference_rpc' },
          'Reference search RPC error',
        );
        // Surface a 500 — never a silent 200 with an empty array, which would
        // misrepresent an RPC failure as "no references match".
        return NextResponse.json(
          { error: 'Reference search query failed' },
          { status: 500 },
        );
      }

      const filtered = results ?? [];

      // Return the RPC rows verbatim, including the separate embedding_score /
      // fulltext_score columns (B-14 — the client decides any display blend).
      return NextResponse.json({
        results: filtered,
        count: filtered.length,
      });
    } catch (err) {
      logger.error({ err, op: 'search.reference' }, 'Reference search failed');
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Reference search failed') },
        { status: 500 },
      );
    }
  }),
);
