import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import {
  EntityCoOccurrenceParamsSchema,
  EntityCoOccurrenceResponseSchema,
} from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

export const GET = defineRoute(
  EntityCoOccurrenceResponseSchema,
  async (request: NextRequest) => {
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

      return NextResponse.json({
        pairs: pairs ?? [],
        total: pairs?.length ?? 0,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to compute co-occurrence') },
        { status: 500 },
      );
    }
  },
);
