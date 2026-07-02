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
import { tryQuery } from '@/lib/supabase/safe';
import { parseBody } from '@/lib/validation';
import { SearchBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 60;

const SearchResponseSchema = z.object({
  // `hybrid_search` RPC rows — opaque Supabase Json result, not statically typed
  results: z.array(z.unknown()),
  count: z.number(),
});

export const POST = withRequestContext(
  defineRoute(SearchResponseSchema, async (request: NextRequest) => {
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
      const { query, threshold, limit, workspace_id } = parsed.data;

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

      // 1b. Derive the ranking profile (application_type) from the workspace
      // when supplied — join workspaces → application_types.key (§9 AC4).
      // Best-effort: any failure / unresolved workspace falls through to the
      // hybrid_search RPC default ('procurement'), so a degraded lookup never
      // fails the search.
      let applicationType: string | undefined;
      if (workspace_id) {
        const wsResult = await tryQuery(
          supabase
            .from('workspaces')
            .select('application_types!inner(key)')
            .eq('id', workspace_id)
            .maybeSingle(),
          'search.workspace_application_type',
        );
        if (wsResult.ok && wsResult.data) {
          const appTypes = wsResult.data.application_types as
            | { key: string }
            | { key: string }[]
            | null;
          const resolved = Array.isArray(appTypes)
            ? (appTypes[0] ?? null)
            : appTypes;
          applicationType = resolved?.key ?? undefined;
        }
      }

      // 2. Hybrid search: combines embedding similarity + keyword matching

      const { data: results, error: rpcError } = await supabase.rpc(
        'hybrid_search',
        {
          query_embedding: JSON.stringify(embedding),
          query_text: query.trim(),
          similarity_threshold: threshold,
          limit_count: limit,
          // Omitted (undefined) opts into the RPC default profile.
          application_type: applicationType,
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
