import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { ClassifyBodySchema } from '@/lib/validation/schemas';
import { classifyContent } from '@/lib/ai/classify';
import { AIServiceError } from '@/lib/ai/errors';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/items/:id/classify -- on-demand AI classification */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { allowed } = checkRateLimit(`classify:${user.id}`, 10, 60 * 1000);
    if (!allowed) return rateLimitResponse();

    const { id } = await params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid item ID -- must be a valid UUID' },
        { status: 400 },
      );
    }

    const raw = await request.json();
    const parsed = parseBody(ClassifyBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const result = await classifyContent({
      supabase,
      itemId: id,
      force: parsed.data.force,
      userId: user.id,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AIServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to classify content item') },
      { status: 500 },
    );
  }
}
