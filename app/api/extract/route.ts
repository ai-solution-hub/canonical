import { AIServiceError } from '@/lib/ai/errors';
import { extractStructuredContent } from '@/lib/ai/extract-content';
import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { ExtractBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 60;

// TODO(OPS-T1): author ResponseSchema
export const POST = defineRoute(z.unknown(), async (request: NextRequest) => {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase, user } = auth;

    const rl = checkRateLimit(`extract:${user.id}`, 10, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    const raw = await request.json();
    const parsed = parseBody(ExtractBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const result = await extractStructuredContent({
      supabase,
      itemId: parsed.data.itemId,
      schema: parsed.data.schema,
      prompt: parsed.data.prompt,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AIServiceError) {
      return NextResponse.json(
        { error: safeErrorMessage(err, err.message) },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to extract structured data') },
      { status: 500 },
    );
  }
});
