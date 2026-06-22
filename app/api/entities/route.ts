import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { EntityListParamsSchema } from '@/lib/validation/schemas';

export const maxDuration = 30;

/**
 * GET /api/entities — list entities with counts, variants, and relationship counts.
 * Auth: admin only.
 *
 * All aggregation, filtering, and pagination is performed server-side via the
 * `get_entity_list_aggregated` RPC function, replacing the previous 10K-row
 * JS aggregation pattern.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { allowed } = checkRateLimit(`entities:list:${user.id}`, 30, 60_000);
    if (!allowed) return rateLimitResponse();

    const parsed = parseSearchParams(
      EntityListParamsSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;

    const { type, search, variants_only, type_conflicts, limit, offset } =
      parsed.data;

    const { data, error } = await supabase.rpc('get_entity_list_aggregated', {
      p_type: type,
      p_search: search,
      p_variants_only: variants_only ?? false,
      p_type_conflicts: type_conflicts ?? false,
      p_limit: limit,
      p_offset: offset,
    });

    if (error) {
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to list entities') },
        { status: 500 },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to list entities') },
      { status: 500 },
    );
  }
}
