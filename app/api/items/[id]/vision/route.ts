import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { analyseVision } from '@/lib/ai/vision';
import { AIServiceError } from '@/lib/ai/errors';

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
      if (body.prompt && typeof body.prompt === 'string') {
        prompt = body.prompt;
      }
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
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to perform visual analysis') },
      { status: 500 },
    );
  }
}
