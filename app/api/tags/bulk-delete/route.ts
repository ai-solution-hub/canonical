import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { TagBulkDeleteBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// TODO(OPS-T1): author ResponseSchema
export const POST = defineRoute(z.unknown(), async (request: NextRequest) => {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { allowed } = checkRateLimit(
      `tags:bulk-delete:${user.id}`,
      5,
      60_000,
    );
    if (!allowed) return rateLimitResponse();

    const raw = await request.json();
    const parsed = parseBody(TagBulkDeleteBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { tags, type } = parsed.data;

    const { data, error } = await supabase.rpc('bulk_delete_tags', {
      p_tags: tags,
      p_type: type,
    });

    if (error) {
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to bulk delete tags') },
        { status: 500 },
      );
    }

    return NextResponse.json({ affected: data ?? 0 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to bulk delete tags') },
      { status: 500 },
    );
  }
});
