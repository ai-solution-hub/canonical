import { generateEmbedding } from '@/lib/ai/embed';
import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { resolveContentOwnerId } from '@/lib/auth/owner-default';
import { stripMarkdown } from '@/lib/content/strip-markdown';
import { safeErrorMessage } from '@/lib/error';
import { logger, updateRequestContext, withRequestContext } from '@/lib/logger';
import { recordPipelineRun } from '@/lib/pipeline/record-run';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { ItemCreateBodySchema, normaliseTag } from '@/lib/validation/schemas';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const ItemsCreateResponseSchema = z.object({
  id: z.string(),
  // content_items.{title,content_type,created_at} are nullable in the
  // generated Row type (projected via .select(...).single()).
  title: z.string().nullable(),
  content_type: z.string().nullable(),
  created_at: z.string().nullable(),
  warnings: z.array(z.string()),
  dedup_status: z.enum(['clean', 'suspected_duplicate']),
  // Conditional keys — spread only when present on the 201 body.
  suspected_duplicate_of: z.string().optional(),
  duplicate_matches: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        similarity: z.number(),
        match_type: z.string(),
      }),
    )
    .optional(),
  suggested_layer: z
    .object({
      suggestedLayer: z.string(),
      reason: z.string(),
      confidence: z.string(),
    })
    .optional(),
  topic_suggestion: z
    .object({ topicId: z.string(), reason: z.string() })
    .optional(),
  // mirrors GuideSectionMatch from @/lib/guide-section-mapping
  guide_section_suggestions: z
    .array(
      z.object({
        guideId: z.string(),
        guideName: z.string(),
        guideSlug: z.string(),
        sectionId: z.string(),
        sectionName: z.string(),
        sectionOrder: z.number(),
        isRequired: z.boolean(),
        matchStrength: z.enum(['exact', 'partial', 'domain_only']),
        matchReason: z.string(),
      }),
    )
    .optional(),
});

export const POST = withRequestContext(
  defineRoute(ItemsCreateResponseSchema, async (request: NextRequest) => {
    try {
      // Auth + role check
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase, role } = auth;

      // Upgrade the request scope with the resolved user so subsequent
      // log lines + any Sentry events carry userId/userRole.
      updateRequestContext({ userId: user.id, userRole: role });

      // Rate limit: 20 requests per minute
      const { allowed } = checkRateLimit(
        `items:create:${user.id}`,
        20,
        60 * 1000,
      );
      if (!allowed) return rateLimitResponse();

      const raw = await request.json();
      const parsed = parseBody(ItemCreateBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const {
        title,
        content,
        content_type,
        primary_domain,
        primary_subtopic,
        secondary_domain,
        secondary_subtopic,
        priority,
        user_tags,
        ai_keywords,
        author_name,
        source_url,
        brief,
        detail,
        reference,
        auto_classify,
        auto_summarise,
        auto_embed,
        governance_review_status,
        publication_status,
        ingestion_source,
        source_document_id,
        skip_dedup,
        content_owner_id,
      } = parsed.data;

      // Admin-only dedup override (spec §6 D2). Silent-ignore for
      // non-admin — do not 403 a legitimate write.
      const skipDedup = skip_dedup === true && role === 'admin';

      // S206 WP-A Phase 2 (AC3.1) — resolve content owner. Admin caller may
      // supply an explicit owner UUID; non-admins are silent-forced to
      // themselves via the helper. Always returns a valid UUID string.
      const ownerId = resolveContentOwnerId({
        explicit: content_owner_id,
        role,
        userId: user.id,
      });

      // Generate embedding synchronously before INSERT (fast, ~200ms)
      let embeddingValue: string | undefined;
      let embeddingArray: number[] | undefined;
      if (auto_embed) {
        try {
          const plainText = stripMarkdown(content);
          const embeddingText = `${title}\n\n${plainText}`;
          embeddingArray = await generateEmbedding(embeddingText);
          embeddingValue = JSON.stringify(embeddingArray);
        } catch (embedErr) {
          logger.warn(
            { err: embedErr, op: 'items.create.embed' },
            'Embedding generation failed',
          );
          // Continue without embedding -- item is still usable
        }
      }

      // Deduplication — soft-block per spec §6 D1. Exact-hash match
      // stamps `dedup_status='suspected_duplicate'` and records the
      // existing id in `metadata.suspected_duplicate_of`. Near-duplicate
      // matches remain informational warnings. Admin override via
      // `skip_dedup=true` bypasses the stamp (silent-ignore for non-admin).
      const warnings: string[] = [];
      let dedupMatches: Array<{
        id: string;
        title: string;
        similarity: number;
        match_type: string;
      }> = [];
      let dedupStamp: {
        dedup_status: 'clean' | 'suspected_duplicate';
        suspected_duplicate_of?: string;
      } = { dedup_status: 'clean' };
      try {
        const { checkForDuplicates, formatDedupWarning, resolveDedupStamp } =
          await import('@/lib/dedup/content-dedup');
        const plainText = stripMarkdown(content);
        const dedupResult = await checkForDuplicates(
          supabase,
          plainText,
          embeddingArray,
        );
        if (dedupResult.has_duplicates) {
          dedupMatches = dedupResult.matches;
          const warning = formatDedupWarning(dedupResult);
          if (warning) warnings.push(warning);
        }
        const exactMatch = dedupResult.matches.find(
          (m) => m.match_type === 'exact',
        );
        dedupStamp = resolveDedupStamp(exactMatch?.id, { skipDedup });
      } catch (dedupErr) {
        logger.warn(
          { err: dedupErr, op: 'items.create.dedup' },
          'Dedup check failed',
        );
        // Non-fatal — continue with creation
      }

      // Normalise ai_keywords at the write boundary (spec ss6.6 EP3).
      // Ensures web-form-submitted keywords match classify-time canonicalisation.
      const normalisedAiKeywords = ai_keywords?.length
        ? [
            ...new Set(
              ai_keywords.map(normaliseTag).filter((k) => k.length > 0),
            ),
          ]
        : undefined;

      // Build the insert payload.
      const insertData = {
        title,
        content,
        content_type,
        suggested_title: title,
        platform: 'manual',
        captured_date: new Date().toISOString(),
        created_by: user.id,
        content_owner_id: ownerId,
        // Typed provenance column. Preserves overrideability via the
        // `ingestion_source` body field per spec §5.5 Phase 2 (mirrors
        // metadata.ingestion_source semantic). Read by
        // ensure_v1_history_at_commit() trigger.
        ingestion_source: ingestion_source ?? 'manual',
        metadata: {
          ingestion_source: ingestion_source ?? 'manual',
          ...(dedupStamp.suspected_duplicate_of && {
            suspected_duplicate_of: dedupStamp.suspected_duplicate_of,
          }),
        },
        dedup_status: dedupStamp.dedup_status,
        ...(primary_domain && { primary_domain }),
        ...(primary_subtopic && { primary_subtopic }),
        ...(secondary_domain && { secondary_domain }),
        ...(secondary_subtopic && { secondary_subtopic }),
        ...(priority && { priority }),
        ...(user_tags?.length && { user_tags }),
        ...(normalisedAiKeywords?.length && {
          ai_keywords: normalisedAiKeywords,
        }),
        ...(author_name && { author_name }),
        ...(source_url && { source_url }),
        ...(brief && { brief }),
        ...(detail && { detail }),
        ...(reference && { reference }),
        ...(embeddingValue && { embedding: embeddingValue }),
        ...(governance_review_status && { governance_review_status }),
        // S202 §5.2 Phase 2.5 (T8b) — accept publication_status from the
        // create body so the T8a UI rewire (web form sets
        // publication_status='draft') actually persists. Per spec §4.2.3
        // the canonical save-as-draft writer is publication_status='draft'.
        ...(publication_status && { publication_status }),
        ...(source_document_id && { source_document_id }),
        // P0-BM Phase 3 spec ss4.6 Path 1: populate answer_standard for q_a_pair
        // so first PATCH edit does not destroy creation content (bug B2 fix).
        ...(content_type === 'q_a_pair' && content
          ? { answer_standard: content }
          : {}),
      } satisfies Record<
        string,
        unknown
      > as Database['public']['Tables']['content_items']['Insert'];

      // Single INSERT with embedding included
      const { data: newItem, error: insertError } = await supabase
        .from('content_items')
        .insert(insertData)
        .select('id, title, content_type, created_at')
        .single();

      if (insertError || !newItem) {
        logger.error(
          { err: insertError, op: 'items.create.insert' },
          'Failed to create content item',
        );
        return NextResponse.json(
          { error: 'Failed to create content item' },
          { status: 500 },
        );
      }

      // S207 WP-A4 Task 3.4: app-level v1 content_history insert removed —
      // the deferred trigger `trg_content_items_ensure_v1_history` is now the
      // single authority for v1 history rows. See spec
      // docs/specs/ingest-path-consistency-spec.md §3.4 AC4.3.

      // Chunking removed (ID-56.11): cocoindex is the sole content_chunks writer
      // and re-ingests the corpus natively (TECH §1 single-path). No app-side
      // chunk regeneration on item creation; the draft-skip guard is no longer
      // needed.

      // AI processing — awaited before response to avoid serverless truncation
      if (auto_embed && embeddingValue) {
        // Embedding already generated above
      } else if (auto_embed) {
        warnings.push('Embedding generation failed');
      }

      if (auto_classify) {
        try {
          await classifyInBackground(newItem.id, user.id);
        } catch (err) {
          logger.warn(
            { err, op: 'items.create.classify' },
            'Classification failed during item creation',
          );
          warnings.push('Classification failed');
        }
      }

      if (auto_summarise) {
        try {
          await summariseInBackground(newItem.id, user.id);
        } catch (err) {
          logger.warn(
            { err, op: 'items.create.summarise' },
            'Summary generation failed during item creation',
          );
          warnings.push('Summary generation failed');
        }
      }

      // Layer inference — suggest and store a layer if not explicitly provided
      let suggestedLayer:
        | { suggestedLayer: string; reason: string; confidence: string }
        | undefined;
      try {
        const { inferLayer } = await import('@/lib/layer-inference');
        const plainTextForLayer = stripMarkdown(content);
        const effectiveSource = (ingestion_source ?? 'manual') as
          | 'manual'
          | 'url_import'
          | 'upload'
          | 'bid_library';
        const suggestion = inferLayer({
          contentType: content_type,
          contentLength: plainTextForLayer.length,
          ingestionSource: effectiveSource,
          hasBrief: !!brief,
          hasDetail: !!detail,
          hasReference: !!reference,
          isBidDiscovered: false,
          title,
        });
        suggestedLayer = suggestion;

        // Store the suggested layer in the dedicated column
        const { createServiceClient } = await import('@/lib/supabase/server');
        const serviceClient = createServiceClient();
        await serviceClient
          .from('content_items')
          .update({ layer: suggestion.suggestedLayer })
          .eq('id', newItem.id);
      } catch (layerErr) {
        logger.warn(
          { err: layerErr, op: 'items.create.layer_inference' },
          'Layer inference failed',
        );
        // Non-fatal — item is still usable without a layer suggestion
      }

      // Quality score — calculate and store after AI processing
      try {
        const { calculateAndRoundQualityScore } =
          await import('@/lib/quality/quality-score');
        const { createServiceClient } = await import('@/lib/supabase/server');
        const serviceClient = createServiceClient();

        // Fetch the latest item state (classification may have updated fields)
        const { data: latestItem } = await serviceClient
          .from('content_items')
          .select(
            'freshness, classification_confidence, brief, detail, reference, summary, citation_count',
          )
          .eq('id', newItem.id)
          .single();

        if (latestItem) {
          const score = calculateAndRoundQualityScore({
            freshness: latestItem.freshness,
            classification_confidence: latestItem.classification_confidence,
            brief: latestItem.brief,
            detail: latestItem.detail,
            reference: latestItem.reference,
            summary: latestItem.summary,
            citation_count: latestItem.citation_count ?? 0,
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
        logger.warn(
          { err: qualityErr, op: 'items.create.quality_score' },
          'Quality score calculation failed',
        );
        // Non-fatal — item is still usable without a stored quality score
      }

      // Topic suggestion — after layer inference (uses layer for matching)
      let topicSuggestion: { topicId: string; reason: string } | undefined;
      try {
        const { suggestTopic } = await import('@/lib/topic-inference');
        const { createServiceClient } = await import('@/lib/supabase/server');
        const serviceClient = createServiceClient();

        const effectiveDomain = primary_domain || '';
        const effectiveSubtopic = primary_subtopic || '';

        if (effectiveDomain && effectiveSubtopic) {
          const suggestion = await suggestTopic(serviceClient, {
            primaryDomain: effectiveDomain,
            primarySubtopic: effectiveSubtopic,
            title,
            suggestedLayer: suggestedLayer?.suggestedLayer || '',
            embeddingArray,
          });

          if (suggestion) {
            topicSuggestion = {
              topicId: suggestion.topicId,
              reason: suggestion.reason,
            };
            await serviceClient.rpc('merge_item_metadata', {
              p_item_id: newItem.id,
              p_new_data: { topic_id: suggestion.topicId },
            });
          }
        }
      } catch (topicErr) {
        logger.warn(
          { err: topicErr, op: 'items.create.topic_suggestion' },
          'Topic suggestion failed',
        );
        // Non-fatal — item is still usable without a topic suggestion
      }

      // Guide section suggestion — after topic suggestion
      let guideSectionSuggestions:
        | import('@/lib/guide-section-mapping').GuideSectionMatch[]
        | undefined;
      {
        const effectiveDomain = primary_domain || '';
        const effectiveSubtopic = primary_subtopic || '';
        if (effectiveDomain) {
          try {
            const { suggestGuideSections } =
              await import('@/lib/guide-section-mapping');
            const { createServiceClient } =
              await import('@/lib/supabase/server');
            const serviceClient = createServiceClient();
            const matches = await suggestGuideSections(serviceClient, {
              primaryDomain: effectiveDomain,
              primarySubtopic: effectiveSubtopic,
              secondaryDomain: secondary_domain || undefined,
              secondarySubtopic: secondary_subtopic || undefined,
              layer: suggestedLayer?.suggestedLayer,
              contentType: content_type,
            });
            if (matches.length > 0) {
              guideSectionSuggestions = matches;
            }
          } catch (guideErr) {
            logger.warn(
              { err: guideErr, op: 'items.create.guide_section_suggestion' },
              'Guide section suggestion failed',
            );
            // Non-fatal — item is still usable without guide section suggestions
          }
        }
      }

      return NextResponse.json(
        {
          id: newItem.id,
          title: newItem.title,
          content_type: newItem.content_type,
          created_at: newItem.created_at,
          warnings,
          dedup_status: dedupStamp.dedup_status,
          ...(dedupStamp.suspected_duplicate_of && {
            suspected_duplicate_of: dedupStamp.suspected_duplicate_of,
          }),
          ...(dedupMatches.length > 0 && { duplicate_matches: dedupMatches }),
          ...(suggestedLayer && { suggested_layer: suggestedLayer }),
          ...(topicSuggestion && { topic_suggestion: topicSuggestion }),
          ...(guideSectionSuggestions && {
            guide_section_suggestions: guideSectionSuggestions,
          }),
        },
        { status: 201 },
      );
    } catch (err) {
      logger.error(
        { err, op: 'items.create' },
        'Failed to create content item',
      );
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to create content item') },
        { status: 500 },
      );
    }
  }),
);

/**
 * Awaited classification step.
 * Delegates to the shared classifyContent() service and logs to pipeline_runs.
 */
async function classifyInBackground(
  itemId: string,
  userId: string,
): Promise<void> {
  const { createServiceClient } = await import('@/lib/supabase/server');
  const supabase = createServiceClient();
  let status: 'completed' | 'failed' = 'completed';
  let errorMessage: string | null = null;

  let caughtError: unknown = null;

  try {
    const { classifyContent } = await import('@/lib/ai/classify');
    await classifyContent({ supabase, itemId, force: true, userId });
  } catch (err) {
    status = 'failed';
    errorMessage =
      err instanceof Error ? err.message : 'Unknown classification error';
    logger.error(
      { err, op: 'items.background_classify', itemId },
      'Background classification failed',
    );
    caughtError = err;
  }

  await recordPipelineRun({
    supabase,
    pipelineName: 'background_classify',
    status,
    itemsProcessed: 1,
    errorMessage,
  });

  if (caughtError) throw caughtError;
}

/**
 * Awaited summary generation step.
 * Delegates to the shared generateSummary() service and logs to pipeline_runs.
 */
async function summariseInBackground(
  itemId: string,
  userId: string,
): Promise<void> {
  const { createServiceClient } = await import('@/lib/supabase/server');
  const supabase = createServiceClient();
  let status: 'completed' | 'failed' = 'completed';
  let errorMessage: string | null = null;

  let caughtError: unknown = null;

  try {
    const { generateSummary } = await import('@/lib/ai/summarise');
    await generateSummary({ supabase, itemId, force: true, userId });
  } catch (err) {
    status = 'failed';
    errorMessage = err instanceof Error ? err.message : 'Unknown summary error';
    logger.error(
      { err, op: 'items.background_summarise', itemId },
      'Background summary failed',
    );
    caughtError = err;
  }

  await recordPipelineRun({
    supabase,
    pipelineName: 'background_summarise',
    status,
    itemsProcessed: 1,
    errorMessage,
  });

  if (caughtError) throw caughtError;
}
