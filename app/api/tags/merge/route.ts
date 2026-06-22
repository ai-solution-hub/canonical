import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import {
  MutationResultSchema,
  TagMergeBodySchema,
} from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

export const POST = defineRoute(
  MutationResultSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      const { allowed } = checkRateLimit(`tags:merge:${user.id}`, 10, 60_000);
      if (!allowed) return rateLimitResponse();

      const raw = await request.json();
      const parsed = parseBody(TagMergeBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const { source, target, type } = parsed.data;

      if (source === target) {
        return NextResponse.json(
          { error: 'Source and target tags must be different' },
          { status: 400 },
        );
      }

      const { data, error } = await supabase.rpc('merge_tags', {
        p_source: source,
        p_target: target,
        p_type: type,
      });

      if (error) {
        return NextResponse.json(
          { error: safeErrorMessage(error, 'Failed to merge tags') },
          { status: 500 },
        );
      }

      return NextResponse.json({ affected: data ?? 0 });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to merge tags') },
        { status: 500 },
      );
    }
  },
);
