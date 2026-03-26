import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  unauthorisedResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { SearchBodySchema } from '@/lib/validation/schemas';
import { generateEmbedding } from '@/lib/ai/embed';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { user, supabase } = auth;

    // Rate limit: 30 requests per minute
    const rl = checkRateLimit(`search:${user.id}`, 30, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    const raw = await request.json();
    const parsed = parseBody(SearchBodySchema, raw);
    if (!parsed.success) return parsed.response;
    const { query, threshold, limit, layer } = parsed.data;

    // 1. Generate embedding via shared helper (singleton OpenAI client)
    let embedding: number[];
    try {
      embedding = await generateEmbedding(query.trim());
    } catch (err) {
      console.error('OpenAI embedding error:', err);
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
      console.error('Search RPC error:', rpcError);
      return NextResponse.json(
        { error: 'Search query failed' },
        { status: 500 },
      );
    }

    // Post-filter by content layer if specified
    const allResults = results ?? [];
    const filtered = layer
      ? allResults.filter((r) => {
          return (r as Record<string, unknown>).layer === layer;
        })
      : allResults;

    return NextResponse.json({
      results: filtered,
      count: filtered.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Search failed') },
      { status: 500 },
    );
  }
}
