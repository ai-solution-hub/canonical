import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { SummaryGenerateBodySchema } from '@/lib/validation/schemas';
import { generateSummary } from '@/lib/ai/summarise';
import { AIServiceError } from '@/lib/ai/errors';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const rl = checkRateLimit(`summaries:${user.id}`, 10, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    const raw = await request.json();
    const validated = parseBody(SummaryGenerateBodySchema, raw);
    if (!validated.success) return validated.response;

    const result = await generateSummary({
      supabase,
      itemId: validated.data.item_id,
      force: validated.data.force ?? false,
      userId: user.id,
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
      { error: safeErrorMessage(err, 'Failed to generate summary') },
      { status: 500 },
    );
  }
}
