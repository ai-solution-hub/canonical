import { classifyContent } from '@/lib/ai/classify';
import { AIServiceError } from '@/lib/ai/errors';
import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { logger, updateRequestContext, withRequestContext } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { tryQuery } from '@/lib/supabase/safe';
import { parseBody } from '@/lib/validation';
import { ClassifyBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// TODO(OPS-T1): author ResponseSchema
export const POST = withRequestContext(
  defineRoute(
    z.unknown(),
    async (
      request: NextRequest,
      { params }: { params: Promise<{ id: string }> },
    ) => {
      try {
        const auth = await getAuthorisedClient(['admin', 'editor']);
        if (!auth.success) return authFailureResponse(auth);
        const { user, supabase } = auth;

        // Upgrade the request scope with the resolved user so subsequent
        // log lines + any Sentry events carry userId/userRole.
        updateRequestContext({ userId: user.id });

        const rl = checkRateLimit(`classify:${user.id}`, 20, 60_000);
        if (!rl.allowed) return rateLimitResponse(rl.resetAt);

        const { id } = await params;

        if (!UUID_RE.test(id)) {
          return NextResponse.json(
            { error: 'Invalid item ID -- must be a valid UUID' },
            { status: 400 },
          );
        }

        const raw = await request.json();
        const parsed = parseBody(ClassifyBodySchema, raw);
        if (!parsed.success) return parsed.response;

        const result = await classifyContent({
          supabase,
          itemId: id,
          force: parsed.data.force,
          userId: user.id,
        });

        // Non-blocking topic inference — mirrors the upload route pattern
        if (result.primary_domain && result.primary_subtopic) {
          try {
            const { suggestTopic } = await import('@/lib/topic-inference');
            const itemResult = await tryQuery(
              supabase
                .from('content_items')
                .select('title, layer')
                .eq('id', id)
                .single(),
              'content_items.titleLayer',
            );
            const item = itemResult.ok ? itemResult.data : null;

            if (item) {
              const suggestion = await suggestTopic(supabase, {
                primaryDomain: result.primary_domain,
                primarySubtopic: result.primary_subtopic,
                title: item.title || '',
                suggestedLayer: item.layer || '',
              });

              if (suggestion) {
                await supabase.rpc('merge_item_metadata', {
                  p_item_id: id,
                  p_new_data: { topic_id: suggestion.topicId },
                });
              }
            }
          } catch (topicErr) {
            logger.warn(
              {
                err: topicErr,
                op: 'classify.topic_suggestion',
                itemId: id,
              },
              'Topic suggestion after classification failed',
            );
            // Non-fatal — classification result is still valid
          }
        }

        return NextResponse.json(result);
      } catch (err) {
        if (err instanceof AIServiceError) {
          logger.error(
            { err, op: 'classify.ai_service' },
            'AIServiceError while classifying content item',
          );
          return NextResponse.json(
            { error: safeErrorMessage(err, err.message) },
            { status: err.status },
          );
        }
        logger.error(
          { err, op: 'classify' },
          'Failed to classify content item',
        );
        return NextResponse.json(
          { error: safeErrorMessage(err, 'Failed to classify content item') },
          { status: 500 },
        );
      }
    },
  ),
);
