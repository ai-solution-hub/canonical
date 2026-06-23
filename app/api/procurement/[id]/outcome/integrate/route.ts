import { generateEmbedding } from '@/lib/ai/embed';
import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { htmlToPlainText } from '@/lib/editor-utils';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import type { ProcurementWorkflowState } from '@/lib/domains/procurement/procurement-workflow';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { KBIntegrationBodySchema } from '@/lib/validation/schemas';
import type { Json } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase, role } = auth;

      const { allowed } = checkRateLimit(
        `bid-integrate:${user.id}`,
        10,
        60_000,
      );
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
      const { checkExactDuplicate } = await import('@/lib/dedup/content-dedup');

      // Verify bid exists and is in won state.
      // Post-T2: discriminator via application_types JOIN.
      const { data: bid, error: procurementError } = await supabase
        .from('workspaces')
        .select(
          'id, name, status, domain_metadata, application_types!inner(key)',
        )
        .eq('id', id)
        .eq('application_types.key', 'procurement')
        .single();

      if (procurementError || !bid) {
        return NextResponse.json(
          { error: 'Procurement not found' },
          { status: 404 },
        );
      }

      const procurementMetadata = (bid.domain_metadata ?? {}) as Record<
        string,
        unknown
      >;
      const procurementStatus =
        (bid.status as ProcurementWorkflowState) ?? 'draft';

      if (procurementStatus !== 'won') {
        return NextResponse.json(
          {
            error: `KB integration is only available for won bids (current status: "${procurementStatus}")`,
            current_status: procurementStatus,
          },
          { status: 400 },
        );
      }

      // Fetch the questions and responses for integration.
      // Post-T2: `form_questions.workspace_id` → `workspace_id`.
      const questionIds = integrations.map((i) => i.question_id);
      const { data: questions, error: questionsError } = await supabase
        .from('form_questions')
        .select('id, question_text')
        .eq('workspace_id', id)
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
        .from('form_responses')
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
          // is skip-and-log (not stamp). Procurement-outcome is a post-won admin
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
              logger.error(
                { err: dedupErr },
                `Procurement-outcome dedup check failed for question ${integration.question_id}`,
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
              primary_domain: (procurementMetadata.domain as string) ?? null,
              summary: `Response to bid question: ${questionText.slice(0, 200)}`,
              captured_date: new Date().toISOString(),
              created_by: user.id,
              // S206 WP-A Phase 2 (AC3.7) — content owner peer to created_by.
              // EP10 has NO admin-override semantics (per OQ-EP10-OWNER-OVERRIDE
              // default): the caller is always the owner of integrated KB items.
              content_owner_id: user.id,
              // Typed provenance column. Read by
              // ensure_v1_history_at_commit() to set
              // content_history.change_reason='initial_ingest'.
              ingestion_source: 'bid_outcome_integration',
              // P0-BM Phase 3 spec ss4.6 Path 3: populate answer_standard for
              // q_a_pair so first PATCH edit does not destroy creation content
              // (bug B2 fix).
              ...(contentType === 'q_a_pair' && insertContent
                ? { answer_standard: insertContent }
                : {}),
              metadata: {
                // source_bid_* JSONB keys intentionally not renamed — zero readers (TS/Python/SQL); historical key-drift harmless until a reader is added (ID-61 strategy §2 Item 4)
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
            logger.error(
              { err: insertError },
              `Failed to create KB entry for question ${integration.question_id}`,
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
            logger.error(
              { err: updateError },
              `Failed to update KB entry ${integration.target_content_id}`,
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
            logger.error(
              { err: embedErr },
              `Re-embedding failed for ${integration.target_content_id}`,
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
  },
);
