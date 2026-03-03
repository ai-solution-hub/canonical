import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import {
  getAuthenticatedClient,
  unauthorisedResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { EmbedBodySchema } from '@/lib/validation/schemas';

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { user } = auth;

    // Rate limit: 30 requests per minute
    const { allowed } = checkRateLimit(`embed:${user.id}`, 30, 60 * 1000);
    if (!allowed) return rateLimitResponse();

    const raw = await request.json();
    const parsed = parseBody(EmbedBodySchema, raw);
    if (!parsed.success) return parsed.response;
    const { text } = parsed.data;

    const openai = new OpenAI();
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: text,
      dimensions: 1024,
    });

    return NextResponse.json({
      embedding: response.data[0].embedding,
      model: 'text-embedding-3-large',
      dimensions: 1024,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to generate embedding') },
      { status: 500 },
    );
  }
}
