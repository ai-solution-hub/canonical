import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  authFailureResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { EntityCoOccurrenceParamsSchema } from '@/lib/validation/schemas';

export const maxDuration = 30;

/**
 * GET /api/entities/co-occurrence — find entities that frequently appear
 * together in the same content items.
 *
 * Query params:
 *   limit  — max pairs to return (default 20, max 50)
 *   min    — minimum shared item count (default 2)
 *   type   — filter one or both entities to this entity_type
 *
 * Auth: any authenticated user (read-only).
 *
 * All computation is performed server-side via the `get_entity_co_occurrence`
 * RPC function, replacing the previous O(n^2) JS self-join pattern.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const parsed = parseSearchParams(
      EntityCoOccurrenceParamsSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;
    const { limit, min: minShared, type: entityType } = parsed.data;

    const { data: pairs, error } = await supabase.rpc(
      'get_entity_co_occurrence',
      {
        p_limit: limit,
        p_min_count: minShared,
        p_entity_type: entityType,
      },
    );

    if (error) {
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to compute co-occurrence') },
        { status: 500 },
      );
    }

    return NextResponse.json({ pairs: pairs ?? [], total: pairs?.length ?? 0 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to compute co-occurrence') },
      { status: 500 },
    );
  }
}
