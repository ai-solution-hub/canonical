import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  forbiddenResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { TagDuplicatesParamsSchema } from '@/lib/validation/schemas';

/**
 * GET /api/tags/duplicates — returns duplicate tag groups (case/plural).
 * Auth: any authenticated user.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient();
    if (!auth) return forbiddenResponse();
    const { user, supabase } = auth;

    const { allowed } = checkRateLimit(`tags:duplicates:${user.id}`, 20, 60_000);
    if (!allowed) return rateLimitResponse();

    const parsed = parseSearchParams(
      TagDuplicatesParamsSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;

    const { type } = parsed.data;

    const { data, error } = await supabase.rpc('find_duplicate_tags', {
      p_type: type,
    });

    if (error) {
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to fetch duplicate tags') },
        { status: 500 },
      );
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch duplicate tags') },
      { status: 500 },
    );
  }
}
