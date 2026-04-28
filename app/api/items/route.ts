import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { ItemCreateBodySchema, normaliseTag } from '@/lib/validation/schemas';
import { resolveContentOwnerId } from '@/lib/auth/owner-default';
import { generateEmbedding } from '@/lib/ai/embed';
import { stripMarkdown } from '@/lib/content/strip-markdown';
import { recordPipelineRun } from '@/lib/pipeline/record-run';
import type { Database } from '@/supabase/types/database.types';

export const maxDuration = 30;

/** POST /api/items -- create new content item */
export async function POST(request: NextRequest) {
  try {
    // Auth + role check
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase, role } = auth;

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
        console.error('Embedding generation failed:', embedErr);
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
        await import('@/lib/dedup');
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
      console.error('Dedup check failed:', dedupErr);
      // Non-fatal — continue with creation
    }

    // Normalise ai_keywords at the write boundary (spec ss6.6 EP3).
    // Ensures web-form-submitted keywords match classify-time canonicalisation.
    const normalisedAiKeywords = ai_keywords?.length
      ? [...new Set(ai_keywords.map(normaliseTag).filter((k) => k.length > 0))]
      : undefined;

    // Build the insert payload
    const insertData: Database['public']['Tables']['content_items']['Insert'] =
      {
        title,
        content,
        content_type,
        suggested_title: title,
        platform: 'manual',
        captured_date: new Date().toISOString(),
        created_by: user.id,
        content_owner_id: ownerId,
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
      };

    // Single INSERT with embedding included
    const { data: newItem, error: insertError } = await supabase
      .from('content_items')
      .insert(insertData)
      .select('id, title, content_type, created_at')
      .single();

    if (insertError || !newItem) {
      console.error('Failed to create content item:', insertError);
      return NextResponse.json(
        { error: 'Failed to create content item' },
        { status: 500 },
      );
    }

    // Create version 1 entry in content_history (best-effort)
    try {
      await supabase.from('content_history').insert({
        content_item_id: newItem.id,
        version: 1,
        title,
        content,
        brief: brief ?? null,
        detail: detail ?? null,
        reference: reference ?? null,
        change_summary: 'Initial creation',
        // S152B WP3 / S153: canonical change_reason for manual item creation
        // via the items API. See supabase/migrations/20260407220000_*.sql
        // COMMENT for the full enum list.
        change_reason: 'initial_ingest',
        change_type: 'create',
        created_by: user.id,
      });
    } catch (historyErr) {
      console.error('Failed to create initial version history:', historyErr);
    }

    // Chunking — split markdown into heading-based chunks with embeddings.
    // Skips drafts (drafts stay private; chunks become searchable once published).
    // Uses service client because the chunks insert needs RLS bypass.
    // S202 §5.2 Phase 2.5 / T8b: read both columns for back-compat during the
    // rewire window. publication_status is the new canonical column; the
    // legacy governance_review_status='draft' read remains until Phase 1f
    // NULLs the legacy column.
    const isDraft =
      publication_status === 'draft' || governance_review_status === 'draft';
    if (!isDraft) {
      try {
        const { regenerateChunks } = await import('@/lib/content/chunk-store');
        const { createServiceClient } = await import('@/lib/supabase/server');
        const chunkServiceClient = createServiceClient();
        const chunkResult = await regenerateChunks(
          chunkServiceClient,
          newItem.id,
          content,
        );
        if (chunkResult.errors.length > 0) {
          warnings.push(`Chunking: ${chunkResult.errors.length} error(s)`);
        }
      } catch (chunkErr) {
        console.error(`Chunking failed for ${newItem.id}:`, chunkErr);
        warnings.push('Content chunking failed');
      }
    }

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
        console.error('Classification failed during item creation:', err);
        warnings.push('Classification failed');
      }
    }

    if (auto_summarise) {
      try {
        await summariseInBackground(newItem.id, user.id);
      } catch (err) {
        console.error('Summary generation failed during item creation:', err);
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
      console.error('Layer inference failed:', layerErr);
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
      console.error('Quality score calculation failed:', qualityErr);
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
      console.error('Topic suggestion failed:', topicErr);
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
          const { createServiceClient } = await import('@/lib/supabase/server');
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
          console.error('Guide section suggestion failed:', guideErr);
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
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create content item') },
      { status: 500 },
    );
  }
}

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
    console.error(`Background classification failed for ${itemId}:`, err);
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
    console.error(`Background summary failed for ${itemId}:`, err);
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
