import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getAuthorisedClient,
  authFailureResponse,
} from '@/lib/auth';
import { parseBody } from '@/lib/validation';
import { safeErrorMessage } from '@/lib/error';
import crypto from 'crypto';
import type { Database, Json } from '@/supabase/types/database.types';

export const maxDuration = 120;

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

/**
 * Schema for a single Q&A pair in the batch request.
 *
 * Each item must have at minimum a title (question) and body text (answer).
 * Additional fields are optional for metadata enrichment.
 */
const BatchItemSchema = z.object({
  /** Title — the question text (truncated at word boundary to 120 chars). */
  title: z.string().trim().min(1, 'Title is required').max(500),
  /** Body — formatted as "Q: {question}\n\nA: {answer}". */
  content: z.string().min(1, 'Content is required').max(500_000),
  /** Content type — should be 'q_a_pair'. */
  contentType: z.enum(['q_a_pair']).default('q_a_pair'),
  /** Section name from document headings, if detected. */
  sectionName: z.string().max(500).optional().default(''),
  /** Advanced answer text, if present. */
  answerAdvanced: z.string().max(500_000).optional().default(''),
  /** Detection source (table, list, heading, text). */
  source: z.enum(['table', 'list', 'heading', 'text']).optional(),
  /** Detection confidence. */
  confidence: z.enum(['high', 'medium', 'low']).optional(),
});

/**
 * Schema for the batch creation request body.
 */
const BatchCreateBodySchema = z.object({
  /** Array of Q&A pairs to create. */
  items: z.array(BatchItemSchema).min(1, 'At least one item is required').max(100),
  /** Source document UUID to link all created items to. */
  source_document_id: z.string().uuid('source_document_id must be a valid UUID').optional(),
  /** Single-use batch token to prevent duplicate submissions. */
  batch_token: z.string().min(1).max(500).optional(),
});

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * POST /api/items/batch — Batch create Q&A pair content items.
 *
 * Creates multiple content items sequentially (not in parallel) to avoid
 * race conditions on dedup checks. Each item runs through the full AI
 * processing pipeline: embed, classify, summarise, layer-infer, topic-suggest.
 *
 * Auth: editor or admin role required.
 * Rate limit: not applied per-item (the batch is one request).
 *
 * Tracks progress in `pipeline_runs` with `pipeline_name: 'qa_autosplit'`.
 */
export async function POST(request: NextRequest) {
  let pipelineRunId: string | null = null;

  try {
    // Auth + role check
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user } = auth;

    // Parse and validate request body
    const raw = await request.json();
    const parsed = parseBody(BatchCreateBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { items, source_document_id, batch_token } = parsed.data;

    // Service client for pipeline_runs and item creation (bypasses RLS)
    const { createServiceClient } = await import('@/lib/supabase/server');
    const serviceClient = createServiceClient();

    // -----------------------------------------------------------------------
    // Single-use batch token enforcement
    // -----------------------------------------------------------------------
    let tokenHash: string | null = null;
    if (batch_token) {
      tokenHash = crypto.createHash('sha256').update(batch_token).digest('hex');

      // Check for existing pipeline_runs row with this token hash
      const { data: existingRuns } = await serviceClient
        .from('pipeline_runs')
        .select('id')
        .eq('pipeline_name', 'qa_autosplit')
        .contains('progress', { batch_token_hash: tokenHash });

      if (existingRuns && existingRuns.length > 0) {
        return NextResponse.json(
          { error: 'Batch token already used. This batch has already been processed.' },
          { status: 409 },
        );
      }
    }

    // -----------------------------------------------------------------------
    // Create pipeline_runs record to track batch progress
    // -----------------------------------------------------------------------
    const autosplitBatchId = crypto.randomUUID();

    const { data: pipelineRun } = await serviceClient
      .from('pipeline_runs')
      .insert({
        pipeline_name: 'qa_autosplit',
        status: 'running',
        created_by: user.id,
        items_created: [],
        items_processed: 0,
        progress: {
          step: 'creating',
          steps_completed: 0,
          steps_total: items.length,
          detail: `Creating 0 of ${items.length} items...`,
          ...(tokenHash ? { batch_token_hash: tokenHash } : {}),
          autosplit_batch_id: autosplitBatchId,
        },
      })
      .select('id')
      .single();

    pipelineRunId = pipelineRun?.id ?? null;

    // -----------------------------------------------------------------------
    // Sequential item creation
    // -----------------------------------------------------------------------
    const createdItems: Array<{ id: string; title: string; status: 'created' | 'failed'; error?: string }> = [];
    const createdIds: string[] = [];
    let failedCount = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      try {
        // Build the insert payload
        const metadata: Record<string, Json> = {
          ingestion_source: 'upload_autosplit',
          autosplit_batch_id: autosplitBatchId,
        };
        if (item.sectionName) {
          metadata.section_name = item.sectionName;
        }
        if (item.source) {
          metadata.detection_source = item.source;
        }
        if (item.confidence) {
          metadata.detection_confidence = item.confidence;
        }

        const insertData: Database['public']['Tables']['content_items']['Insert'] = {
          title: item.title,
          content: item.content,
          content_type: 'q_a_pair',
          platform: 'extraction',
          suggested_title: item.title,
          captured_date: new Date().toISOString(),
          created_by: user.id,
          metadata,
          ...(source_document_id ? { source_document_id } : {}),
          ...(item.answerAdvanced ? { answer_advanced: item.answerAdvanced } : {}),
        };

        // Insert the content item
        const { data: newItem, error: insertError } = await serviceClient
          .from('content_items')
          .insert(insertData)
          .select('id, title')
          .single();

        if (insertError || !newItem) {
          throw new Error(insertError?.message ?? 'Insert returned no data');
        }

        createdIds.push(newItem.id);

        // Create initial version in content_history (best-effort)
        try {
          await serviceClient.from('content_history').insert({
            content_item_id: newItem.id,
            version: 1,
            title: item.title,
            content: item.content,
            change_type: 'create',
            change_summary: 'Batch creation via Q&A auto-split',
            created_by: user.id,
          });
        } catch {
          // Non-fatal — continue without history entry
        }

        // -------------------------------------------------------------------
        // AI processing pipeline (per item)
        // -------------------------------------------------------------------

        // 1. Generate embedding
        try {
          const { generateEmbedding } = await import('@/lib/ai/embed');
          const { htmlToPlainText } = await import('@/lib/editor-utils');
          const plainText = htmlToPlainText(item.content);
          const embeddingText = `${item.title}\n\n${plainText}`;
          const embedding = await generateEmbedding(embeddingText);
          await serviceClient
            .from('content_items')
            .update({ embedding: JSON.stringify(embedding) })
            .eq('id', newItem.id);
        } catch (embedErr) {
          console.error(`Embedding failed for batch item ${i}:`, embedErr);
        }

        // 2. Classify
        try {
          const { classifyContent } = await import('@/lib/ai/classify');
          await classifyContent({ supabase: serviceClient, itemId: newItem.id, force: true, userId: user.id });
        } catch (classifyErr) {
          console.error(`Classification failed for batch item ${i}:`, classifyErr);
        }

        // 3. Generate AI summary
        try {
          const { generateSummary } = await import('@/lib/ai/summarise');
          await generateSummary({ supabase: serviceClient, itemId: newItem.id, force: true, userId: user.id });
        } catch (summaryErr) {
          console.error(`Summary generation failed for batch item ${i}:`, summaryErr);
        }

        // 4. Layer inference
        try {
          const { inferLayer } = await import('@/lib/layer-inference');
          const { htmlToPlainText } = await import('@/lib/editor-utils');
          const plainText = htmlToPlainText(item.content);
          const suggestion = inferLayer({
            contentType: 'q_a_pair',
            contentLength: plainText.length,
            ingestionSource: 'upload',
            hasBrief: false,
            hasDetail: false,
            hasReference: false,
            isBidDiscovered: false,
            title: item.title,
          });

          await serviceClient.rpc('merge_item_metadata', {
            p_item_id: newItem.id,
            p_new_data: { layer: suggestion.suggestedLayer },
          });
        } catch (layerErr) {
          console.error(`Layer inference failed for batch item ${i}:`, layerErr);
        }

        // 5. Topic suggestion
        try {
          const { suggestTopic } = await import('@/lib/topic-inference');

          const { data: classified } = await serviceClient
            .from('content_items')
            .select('primary_domain, primary_subtopic')
            .eq('id', newItem.id)
            .single();

          const domain = classified?.primary_domain || '';
          const subtopic = classified?.primary_subtopic || '';

          if (domain && subtopic) {
            const suggestion = await suggestTopic(serviceClient, {
              primaryDomain: domain,
              primarySubtopic: subtopic,
              title: item.title,
              suggestedLayer: '',
            });

            if (suggestion) {
              await serviceClient.rpc('merge_item_metadata', {
                p_item_id: newItem.id,
                p_new_data: { topic_id: suggestion.topicId },
              });
            }
          }
        } catch (topicErr) {
          console.error(`Topic suggestion failed for batch item ${i}:`, topicErr);
        }

        // 6. Quality score
        try {
          const { calculateAndRoundQualityScore } = await import('@/lib/quality-score');

          const { data: latestItem } = await serviceClient
            .from('content_items')
            .select('freshness, classification_confidence, brief, detail, reference, ai_summary, metadata')
            .eq('id', newItem.id)
            .single();

          if (latestItem) {
            const meta = latestItem.metadata as Record<string, unknown> | null;
            const score = calculateAndRoundQualityScore({
              freshness: latestItem.freshness,
              classification_confidence: latestItem.classification_confidence,
              brief: latestItem.brief,
              detail: latestItem.detail,
              reference: latestItem.reference,
              ai_summary: latestItem.ai_summary,
              citation_count: typeof meta?.citation_count === 'number' ? meta.citation_count : 0,
            });

            await serviceClient
              .from('content_items')
              .update({
                quality_score: score,
                quality_score_updated_at: new Date().toISOString(),
              })
              .eq('id', newItem.id);
          }
        } catch (qualityErr) {
          console.error(`Quality score failed for batch item ${i}:`, qualityErr);
        }

        createdItems.push({ id: newItem.id, title: newItem.title, status: 'created' });

      } catch (itemErr) {
        failedCount++;
        const errorMsg = itemErr instanceof Error ? itemErr.message : 'Unknown error';
        console.error(`Batch item ${i} failed:`, itemErr);
        createdItems.push({ id: '', title: item.title, status: 'failed', error: errorMsg });
      }

      // Update pipeline progress after each item
      if (pipelineRunId) {
        try {
          await serviceClient
            .from('pipeline_runs')
            .update({
              items_created: createdIds,
              items_processed: i + 1,
              progress: {
                step: 'creating',
                steps_completed: i + 1,
                steps_total: items.length,
                detail: `Created ${i + 1} of ${items.length} items...`,
                ...(tokenHash ? { batch_token_hash: tokenHash } : {}),
                autosplit_batch_id: autosplitBatchId,
              },
            })
            .eq('id', pipelineRunId);
        } catch {
          // Non-fatal — progress tracking failure should not disrupt creation
        }
      }
    }

    // -----------------------------------------------------------------------
    // Mark pipeline run as completed
    // -----------------------------------------------------------------------
    if (pipelineRunId) {
      try {
        await serviceClient
          .from('pipeline_runs')
          .update({
            status: failedCount === items.length ? 'failed' : 'completed',
            items_created: createdIds,
            items_processed: items.length,
            completed_at: new Date().toISOString(),
            progress: {
              step: 'complete',
              steps_completed: items.length,
              steps_total: items.length,
              detail: failedCount > 0
                ? `Completed with ${failedCount} failure(s). ${createdIds.length} items created.`
                : `All ${items.length} items created successfully.`,
              ...(tokenHash ? { batch_token_hash: tokenHash } : {}),
              autosplit_batch_id: autosplitBatchId,
            },
            ...(failedCount === items.length ? { error_message: 'All items failed to create' } : {}),
          })
          .eq('id', pipelineRunId);
      } catch {
        // Non-fatal
      }
    }

    return NextResponse.json(
      {
        created: createdIds.length,
        failed: failedCount,
        items: createdItems,
        pipeline_run_id: pipelineRunId,
        batch_id: autosplitBatchId,
      },
      { status: 201 },
    );
  } catch (err) {
    // Mark pipeline run as failed if it exists
    if (pipelineRunId) {
      try {
        const { createServiceClient } = await import('@/lib/supabase/server');
        const serviceClient = createServiceClient();
        await serviceClient
          .from('pipeline_runs')
          .update({
            status: 'failed',
            error_message: err instanceof Error ? err.message : 'Unknown error',
            completed_at: new Date().toISOString(),
          })
          .eq('id', pipelineRunId);
      } catch {
        // Double-fault — nothing more we can do
      }
    }

    return NextResponse.json(
      { error: safeErrorMessage(err, 'Batch creation failed') },
      { status: 500 },
    );
  }
}
