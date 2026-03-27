import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { KBIntegrationBodySchema } from '@/lib/validation/schemas';
import { generateEmbedding } from '@/lib/ai/embed';
import { htmlToPlainText } from '@/lib/editor-utils';
import type { BidState } from '@/lib/bid/bid-state-machine';
import type { Json } from '@/supabase/types/database.types';

export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/bids/:id/outcome/integrate -- add winning responses to KB */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { allowed } = checkRateLimit(`bid-integrate:${user.id}`, 10, 60_000);
    if (!allowed) return rateLimitResponse();

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid bid ID -- must be a valid UUID' },
        { status: 400 },
      );
    }

    const raw = await request.json();
    const parsed = parseBody(KBIntegrationBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { integrations } = parsed.data;

    // Verify bid exists and is in won state
    const { data: bid, error: bidError } = await supabase
      .from('workspaces')
      .select('id, name, status, domain_metadata')
      .eq('id', id)
      .eq('type', 'bid')
      .single();

    if (bidError || !bid) {
      return NextResponse.json(
        { error: 'Bid not found' },
        { status: 404 },
      );
    }

    const bidMetadata = (bid.domain_metadata ?? {}) as Record<string, unknown>;
    const bidStatus = (bid.status as BidState) ?? 'draft';

    if (bidStatus !== 'won') {
      return NextResponse.json(
        {
          error: `KB integration is only available for won bids (current status: "${bidStatus}")`,
          current_status: bidStatus,
        },
        { status: 400 },
      );
    }

    // Fetch the questions and responses for integration
    const questionIds = integrations.map((i) => i.question_id);
    const { data: questions } = await supabase
      .from('bid_questions')
      .select('id, question_text')
      .eq('project_id', id)
      .in('id', questionIds);

    const questionMap = new Map(
      (questions ?? []).map((q) => [q.id, q.question_text]),
    );

    const { data: responses } = await supabase
      .from('bid_responses')
      .select('question_id, response_text')
      .in('question_id', questionIds);

    const responseMap = new Map(
      (responses ?? []).map((r) => [r.question_id, r.response_text]),
    );

    // Process each integration
    const items: Array<{
      question_id: string;
      content_item_id: string;
      action: 'created' | 'updated' | 'skipped';
    }> = [];

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const warnings: string[] = [];

    for (const integration of integrations) {
      if (integration.action === 'skip') {
        skipped++;
        items.push({
          question_id: integration.question_id,
          content_item_id: '',
          action: 'skipped',
        });
        continue;
      }

      const questionText = questionMap.get(integration.question_id) ?? '';
      const responseText = responseMap.get(integration.question_id) ?? '';
      const plainText = htmlToPlainText(responseText ?? '');

      if (!plainText) {
        skipped++;
        items.push({
          question_id: integration.question_id,
          content_item_id: '',
          action: 'skipped',
        });
        continue;
      }

      if (integration.action === 'new_entry') {
        // Generate embedding for the new entry
        const embeddingText = `${questionText}\n\n${plainText}`;
        const embedding = await generateEmbedding(embeddingText);

        const title = integration.title ?? questionText.slice(0, 200);
        const contentType = integration.content_type ?? 'q_a_pair';

        const { data: newItem, error: insertError } = await supabase
          .from('content_items')
          .insert({
            title,
            suggested_title: title,
            content: responseText ?? '',
            content_type: contentType,
            platform: 'extraction',
            source_url: null,
            embedding: JSON.stringify(embedding),
            primary_domain: (bidMetadata.domain as string) ?? null,
            ai_summary: `Response to bid question: ${questionText.slice(0, 200)}`,
            captured_date: new Date().toISOString(),
            created_by: user.id,
            metadata: {
              source_bid_id: id,
              source_bid_name: bid.name,
              source_question_id: integration.question_id,
              source_question_text: questionText,
              integrated_at: new Date().toISOString(),
            } as unknown as Json,
          })
          .select('id')
          .single();

        if (insertError) {
          console.error(`Failed to create KB entry for question ${integration.question_id}:`, insertError);
          skipped++;
          items.push({
            question_id: integration.question_id,
            content_item_id: '',
            action: 'skipped',
          });
          continue;
        }

        created++;
        items.push({
          question_id: integration.question_id,
          content_item_id: newItem?.id ?? '',
          action: 'created',
        });
      } else if (integration.action === 'update_existing' && integration.target_content_id) {
        // Update existing content item with winning response
        const { error: updateError } = await supabase
          .from('content_items')
          .update({
            content: responseText,
            ai_summary: `Updated from winning bid response: ${questionText.slice(0, 150)}`,
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', integration.target_content_id);

        if (updateError) {
          console.error(`Failed to update KB entry ${integration.target_content_id}:`, updateError);
          skipped++;
          items.push({
            question_id: integration.question_id,
            content_item_id: integration.target_content_id,
            action: 'skipped',
          });
          continue;
        }

        // Re-generate embedding for the updated content
        try {
          const embeddingText = `${questionText}\n\n${plainText}`;
          const embedding = await generateEmbedding(embeddingText);
          await supabase
            .from('content_items')
            .update({ embedding: JSON.stringify(embedding) })
            .eq('id', integration.target_content_id);
        } catch (embedErr) {
          console.error(`Re-embedding failed for ${integration.target_content_id}:`, embedErr);
          warnings.push(`Re-embedding failed for ${integration.target_content_id}: ${safeErrorMessage(embedErr, 'Unknown error')}`);
          // Item is still updated — embedding will be stale but content is correct
        }

        updated++;
        items.push({
          question_id: integration.question_id,
          content_item_id: integration.target_content_id,
          action: 'updated',
        });
      } else {
        skipped++;
        items.push({
          question_id: integration.question_id,
          content_item_id: '',
          action: 'skipped',
        });
      }
    }

    return NextResponse.json({
      created,
      updated,
      skipped,
      items,
      warnings,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to integrate responses to KB') },
      { status: 500 },
    );
  }
}
