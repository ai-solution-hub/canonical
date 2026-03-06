import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  forbiddenResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { TagSuggestParamsSchema } from '@/lib/validation/schemas';

/**
 * GET /api/tags/suggest?prefix=foo&type=user — tag autocomplete.
 * Returns up to 10 tags matching the prefix, ordered by frequency.
 * Auth: any authenticated user.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient();
    if (!auth) return forbiddenResponse();
    const { user, supabase } = auth;

    const { allowed } = checkRateLimit(`tags:suggest:${user.id}`, 60, 60_000);
    if (!allowed) return rateLimitResponse();

    const { searchParams } = request.nextUrl;
    const validated = parseSearchParams(TagSuggestParamsSchema, searchParams);
    if (!validated.success) return validated.response;

    const { prefix, type } = validated.data;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC added in migration, types not yet regenerated
    const { data, error } = await (supabase.rpc as any)('suggest_tags', {
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
