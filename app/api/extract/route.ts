import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  forbiddenResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { ExtractBodySchema } from '@/lib/validation/schemas';
import { extractStructuredContent } from '@/lib/ai/extract-content';
import { AIServiceError } from '@/lib/ai/errors';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth) return forbiddenResponse();
    const { supabase, user } = auth;

    const { allowed } = checkRateLimit(`extract:${user.id}`, 5, 60_000);
    if (!allowed) return rateLimitResponse();

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
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to extract structured data') },
      { status: 500 },
    );
  }
}
