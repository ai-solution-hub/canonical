import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseBody } from '@/lib/validation';
import { BatchReviewResponseSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const BatchReviewBodySchema = z.object({
  item_ids: z
    .array(z.string().uuid('Each item_id must be a valid UUID'))
    .min(1, 'item_ids must contain at least one ID')
    .max(100, 'item_ids must contain at most 100 IDs'),
  status: z.literal('pending'),
});

export const POST = defineRoute(
  BatchReviewResponseSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const raw = await request.json();
      const parsed = parseBody(BatchReviewBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const { item_ids, status } = parsed.data;

      const { data, error } = await supabase
        .from('content_items')
        .update({ governance_review_status: status })
        .in('id', item_ids)
        .select('id');

      if (error) {
        logger.error(
          { err: error },
          'Failed to batch update governance review status',
        );
        return NextResponse.json(
          { error: 'Failed to update governance review status' },
          { status: 500 },
        );
      }

      return NextResponse.json({ updated: data?.length ?? 0 });
    } catch (err) {
      return NextResponse.json(
        {
          error: safeErrorMessage(
            err,
            'Failed to update governance review status',
          ),
        },
        { status: 500 },
      );
    }
  },
);
