import {
  generateEmbedding,
  getEmbeddingDimensions,
  getEmbeddingModel,
} from '@/lib/ai/embed';
import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { EmbedBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 60;

// TODO(OPS-T1): author ResponseSchema
export const POST = defineRoute(z.unknown(), async (request: NextRequest) => {
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
      model: getEmbeddingModel(),
      dimensions: getEmbeddingDimensions(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to generate embedding') },
      { status: 500 },
    );
  }
});
