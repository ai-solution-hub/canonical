import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { analyseVision } from '@/lib/ai/vision';
import { AIServiceError } from '@/lib/ai/errors';
import { parseBody } from '@/lib/validation';
import { VisionBodySchema } from '@/lib/validation/schemas';

export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase, user } = auth;

    const rl = checkRateLimit(`vision:${user.id}`, 10, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    const { id } = await params;

    // Parse optional prompt from request body
    let prompt: string | undefined;
    try {
      const body = await request.json();
      const parsed = parseBody(VisionBodySchema, body);
      if (parsed.success) {
        prompt = parsed.data.prompt;
      }
      // If validation fails, silently use default (body is optional)
    } catch {
      // No body or invalid JSON — use default prompt
    }

    const result = await analyseVision({
      supabase,
      itemId: id,
      prompt,
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
      { error: safeErrorMessage(err, 'Failed to perform visual analysis') },
      { status: 500 },
    );
  }
}
