// app/api/q-a-pairs/batch/route.ts
//
// ID-131 {131.21} G-MANUAL-QA — manual Q&A batch-authoring write rebind.
//
// S440 owner-ratified narrowing: the "Batch Q&A" tab (app/item/new/batch/
// batch-create-client.tsx, via hooks/use-batch-create.ts) is the shipped
// manual Q&A editor surviving the {131.18} "Write content" removal. It
// previously wrote `content_items` rows (content_type='q_a_pair') through
// POST /api/items/batch. This route replaces that write target: manually
// authored pairs land in the TYPED `q_a_pairs` table instead, never
// `content_items`.
//
// Field map:
//   question_text    <- item.question_text
//   answer_standard  <- item.answer_standard
//   answer_advanced  <- item.answer_advanced (optional)
//   origin_kind      <- 'manually_authored' (the value {131.9}'s
//                       id131_sd_classification_cols migration added to
//                       q_a_pairs_origin_kind_check specifically for this
//                       Subtask — see that migration's D3 note)
//   source_document_id <- the optional body field, else NULL (nullable,
//                       FK-LESS — supabase/migrations/20260621105625)
//
// Deliberately NOT ported from the old content_items batch route: the
// AI pipeline steps (embed / classify / summarise / layer-inference /
// topic-suggestion / quality-score) and the pipeline_runs progress-tracking
// row. None of those columns exist on q_a_pairs — the corpus-side embedding
// path for q_a_pairs is `lib/q-a-pairs/promote-corpus.ts` (record_embeddings
// dual-write, {131.21} HIGH-priority item), which this manual-authoring path
// does not currently populate (out of scope here; richer per-pair viewer +
// bulk-actions parity is deferred to id-135 {135.22}).
//
// Auth/RLS: mirrors the promote route's precedent
// (app/api/q-a-pairs/promote/route.ts) — the authorised, RLS-scoped cookie
// client is used for the INSERT; no service-role escalation.
import crypto from 'crypto';
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { tryQuery } from '@/lib/supabase/safe';
import { parseBody } from '@/lib/validation';
import { BatchCreateResultSchema } from '@/lib/validation/schemas';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const QAPairBatchItemSchema = z.object({
  question_text: z.string().trim().min(1, 'Question is required').max(2000),
  answer_standard: z.string().trim().min(1, 'Answer is required').max(500_000),
  answer_advanced: z.string().max(500_000).optional(),
});

const QAPairsBatchCreateBodySchema = z.object({
  items: z
    .array(QAPairBatchItemSchema)
    .min(1, 'At least one item is required')
    .max(100),
  /** Optional corpus-document provenance link. Nullable on the row when omitted. */
  source_document_id: z
    .string()
    .uuid('source_document_id must be a valid UUID')
    .optional(),
});

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export const POST = defineRoute(
  BatchCreateResultSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const raw = await request.json().catch((_err) => null);
      const parsedResult = parseBody(QAPairsBatchCreateBodySchema, raw);
      if (!parsedResult.success) return parsedResult.response;
      const { items, source_document_id } = parsedResult.data;

      const createdItems: Array<{
        id: string;
        title: string;
        status: 'created' | 'failed';
        error?: string;
      }> = [];
      let failedCount = 0;

      for (const item of items) {
        const insertPayload: Database['public']['Tables']['q_a_pairs']['Insert'] =
          {
            question_text: item.question_text,
            answer_standard: item.answer_standard,
            origin_kind: 'manually_authored',
            ...(item.answer_advanced && {
              answer_advanced: item.answer_advanced,
            }),
            ...(source_document_id && { source_document_id }),
          };

        const insertResult = await tryQuery(
          supabase
            .from('q_a_pairs')
            .insert(insertPayload)
            .select('id')
            .single(),
          'q_a_pairs.manualBatchCreate',
        );

        if (!insertResult.ok) {
          failedCount++;
          createdItems.push({
            id: '',
            title: item.question_text,
            status: 'failed',
            error: safeErrorMessage(
              insertResult.error,
              'Failed to create Q&A pair',
            ),
          });
          continue;
        }

        createdItems.push({
          id: (insertResult.data as { id: string }).id,
          title: item.question_text,
          status: 'created',
        });
      }

      return NextResponse.json(
        {
          created: createdItems.filter((i) => i.status === 'created').length,
          failed: failedCount,
          items: createdItems,
          // No pipeline_runs row — this path has no async AI pipeline to track.
          pipeline_run_id: null,
          batch_id: crypto.randomUUID(),
        },
        { status: 201 },
      );
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Batch Q&A creation failed') },
        { status: 500 },
      );
    }
  },
);
