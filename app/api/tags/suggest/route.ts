import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { TagSuggestParamsSchema } from '@/lib/validation/schemas';

export const maxDuration = 30;

/**
 * GET /api/tags/suggest?prefix=foo&type=user — tag autocomplete.
 * Returns up to 10 tags matching the prefix, ordered by frequency.
 * Auth: any authenticated user.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { allowed } = checkRateLimit(`tags:suggest:${user.id}`, 60, 60_000);
    if (!allowed) return rateLimitResponse();

    const { searchParams } = request.nextUrl;
    const validated = parseSearchParams(TagSuggestParamsSchema, searchParams);
    if (!validated.success) return validated.response;

    const { prefix, type } = validated.data;

    const { data, error } = await supabase.rpc('suggest_tags', {
      p_prefix: prefix,
      p_type: type,
    });

    if (error) {
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to fetch tag suggestions') },
        { status: 500 },
      );
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch tag suggestions') },
      { status: 500 },
    );
  }
}
