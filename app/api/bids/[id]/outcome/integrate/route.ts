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
    const { user, supabase, role } = auth;

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

    const { integrations, skip_dedup } = parsed.data;

    // Admin-only dedup override (spec §6 D2). Silent-ignore for non-admin.
    const skipDedup = skip_dedup === true && role === 'admin';
    const { checkExactDuplicate } = await import('@/lib/dedup');

    // Verify bid exists and is in won state
    const { data: bid, error: bidError } = await supabase
      .from('workspaces')
      .select('id, name, status, domain_metadata')
      .eq('id', id)
      .eq('type', 'bid')
      .single();

    if (bidError || !bid) {
      return NextResponse.json({ error: 'Bid not found' }, { status: 404 });
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
    const { data: questions, error: questionsError } = await supabase
      .from('bid_questions')
      .select('id, question_text')
      .eq('project_id', id)
      .in('id', questionIds);

    if (questionsError) {
      // S151 WP4 (C4): without the questions map, the integration loop
      // would write KB items with empty `question_text` — silent KB
      // pollution on the won-bid happy path. Fail loudly.
      return NextResponse.json(
        {
          error: 'Failed to fetch bid questions for integration',
          details: questionsError.message,
        },
        { status: 500 },
      );
    }

    const questionMap = new Map(
      (questions ?? []).map((q) => [q.id, q.question_text]),
    );

    const { data: responses, error: responsesError } = await supabase
      .from('bid_responses')
      .select('question_id, response_text')
      .in('question_id', questionIds);

    if (responsesError) {
      // S151 WP4 (C4): same risk as the questions branch — without the
      // responses map, KB writes would have empty bodies.
      return NextResponse.json(
        {
          error: 'Failed to fetch bid responses for integration',
          details: responsesError.message,
        },
        { status: 500 },
      );
    }

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
        // Dedup — spec §6 D1 variant for bid-outcome: exact-hash match
        // is skip-and-log (not stamp). Bid-outcome is a post-won admin
        // workflow where duplicate content is almost certainly the
        // response already present in the KB. Skipping prevents double
        // entry; admin can review the log. Admins may `skip_dedup=true`
        // to force-insert anyway.
        if (!skipDedup) {
          try {
            const dedupCheck = await checkExactDuplicate(supabase, plainText);
            if (dedupCheck.isDuplicate) {
              skipped++;
              warnings.push(
                `Skipped bid integration for question ${integration.question_id} — response matches existing KB item ${dedupCheck.existingId}${dedupCheck.existingTitle ? ` ("${dedupCheck.existingTitle}")` : ''}`,
              );
              items.push({
                question_id: integration.question_id,
                content_item_id: dedupCheck.existingId ?? '',
                action: 'skipped',
              });
              continue;
            }
          } catch (dedupErr) {
            console.error(
              `Bid-outcome dedup check failed for question ${integration.question_id}:`,
              dedupErr,
            );
            // Non-fatal — proceed with insert as clean
          }
        }

        // Generate embedding for the new entry
        const embeddingText = `${questionText}\n\n${plainText}`;
        const embedding = await generateEmbedding(embeddingText);

        const title = integration.title ?? questionText.slice(0, 200);
        const contentType = integration.content_type ?? 'q_a_pair';

        const insertContent = responseText ?? '';
        const { data: newItem, error: insertError } = await supabase
          .from('content_items')
          .insert({
            title,
            suggested_title: title,
            content: insertContent,
            content_type: contentType,
            platform: 'extraction',
            source_url: null,
            embedding: JSON.stringify(embedding),
            primary_domain: (bidMetadata.domain as string) ?? null,
            summary: `Response to bid question: ${questionText.slice(0, 200)}`,
            captured_date: new Date().toISOString(),
            created_by: user.id,
            // P0-BM Phase 3 spec ss4.6 Path 3: populate answer_standard for
            // q_a_pair so first PATCH edit does not destroy creation content
            // (bug B2 fix).
            ...(contentType === 'q_a_pair' && insertContent
              ? { answer_standard: insertContent }
              : {}),
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
          console.error(
            `Failed to create KB entry for question ${integration.question_id}:`,
            insertError,
          );
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
      } else if (
        integration.action === 'update_existing' &&
        integration.target_content_id
      ) {
        // Update existing content item with winning response
        const { error: updateError } = await supabase
          .from('content_items')
          .update({
            content: responseText,
            summary: `Updated from winning bid response: ${questionText.slice(0, 150)}`,
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', integration.target_content_id);

        if (updateError) {
          console.error(
            `Failed to update KB entry ${integration.target_content_id}:`,
            updateError,
          );
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
          console.error(
            `Re-embedding failed for ${integration.target_content_id}:`,
            embedErr,
          );
          warnings.push(
            `Re-embedding failed for ${integration.target_content_id}: ${safeErrorMessage(embedErr, 'Unknown error')}`,
          );
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
