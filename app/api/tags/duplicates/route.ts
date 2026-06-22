import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseSearchParams } from '@/lib/validation';
import { TagDuplicatesParamsSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// TODO(OPS-T1): author ResponseSchema
export const GET = defineRoute(z.unknown(), async (request: NextRequest) => {
  try {
    const auth = await getAuthorisedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { allowed } = checkRateLimit(
      `tags:duplicates:${user.id}`,
      20,
      60_000,
    );
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
});
