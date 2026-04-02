import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { ClassifyBodySchema } from '@/lib/validation/schemas';
import { classifyContent } from '@/lib/ai/classify';
import { AIServiceError } from '@/lib/ai/errors';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/items/:id/classify -- on-demand AI classification */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

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
        const { data: item } = await supabase
          .from('content_items')
          .select('title, layer')
          .eq('id', id)
          .single();

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
        console.error(
          'Topic suggestion after classification failed:',
          topicErr,
        );
        // Non-fatal — classification result is still valid
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AIServiceError) {
      return NextResponse.json(
        { error: safeErrorMessage(err, err.message) },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to classify content item') },
      { status: 500 },
    );
  }
}
