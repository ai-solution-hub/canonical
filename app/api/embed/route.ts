import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { EmbedBodySchema } from '@/lib/validation/schemas';
import { generateEmbedding, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from '@/lib/ai/embed';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    // Auth + role check
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user } = auth;

    // Rate limit: 30 requests per minute
    const rl = checkRateLimit(`embed:${user.id}`, 30, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    const raw = await request.json();
    const parsed = parseBody(EmbedBodySchema, raw);
    if (!parsed.success) return parsed.response;
    const { text } = parsed.data;

    const embedding = await generateEmbedding(text);

    return NextResponse.json({
      embedding,
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to generate embedding') },
      { status: 500 },
    );
  }
}
