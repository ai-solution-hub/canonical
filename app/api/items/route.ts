import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { ItemCreateBodySchema } from '@/lib/validation/schemas';
import { generateEmbedding } from '@/lib/ai/embed';
import { htmlToPlainText } from '@/lib/editor-utils';
import type { Database } from '@/supabase/types/database.types';

export const maxDuration = 30;

/** POST /api/items -- create new content item */
export async function POST(request: NextRequest) {
  try {
    // Auth + role check
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    // Rate limit: 20 requests per minute
    const { allowed } = checkRateLimit(`items:create:${user.id}`, 20, 60 * 1000);
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
      ingestion_source,
      source_document_id,
    } = parsed.data;

    // Generate embedding synchronously before INSERT (fast, ~200ms)
    let embeddingValue: string | undefined;
    let embeddingArray: number[] | undefined;
    if (auto_embed) {
      try {
        const plainText = htmlToPlainText(content);
        const embeddingText = `${title}\n\n${plainText}`;
        embeddingArray = await generateEmbedding(embeddingText);
        embeddingValue = JSON.stringify(embeddingArray);
      } catch (embedErr) {
        console.error('Embedding generation failed:', embedErr);
        // Continue without embedding -- item is still usable
      }
    }

    // Deduplication check (informational — does not block creation)
    const warnings: string[] = [];
    let dedupMatches: Array<{ id: string; title: string; similarity: number; match_type: string }> = [];
    try {
      const { checkForDuplicates, formatDedupWarning } = await import('@/lib/dedup');
      const plainText = htmlToPlainText(content);
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
    } catch (dedupErr) {
      console.error('Dedup check failed:', dedupErr);
      // Non-fatal — continue with creation
    }

    // Build the insert payload
    const insertData: Database['public']['Tables']['content_items']['Insert'] = {
      title,
      content,
      content_type,
      suggested_title: title,
      platform: 'manual',
      captured_date: new Date().toISOString(),
      created_by: user.id,
      metadata: { ingestion_source: ingestion_source ?? 'manual' },
      ...(primary_domain && { primary_domain }),
      ...(primary_subtopic && { primary_subtopic }),
      ...(secondary_domain && { secondary_domain }),
      ...(secondary_subtopic && { secondary_subtopic }),
      ...(priority && { priority }),
      ...(user_tags?.length && { user_tags }),
      ...(ai_keywords?.length && { ai_keywords }),
      ...(author_name && { author_name }),
      ...(source_url && { source_url }),
      ...(brief && { brief }),
      ...(detail && { detail }),
      ...(reference && { reference }),
      ...(embeddingValue && { embedding: embeddingValue }),
      ...(governance_review_status && { governance_review_status }),
      ...(source_document_id && { source_document_id }),
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
        change_type: 'create',
        created_by: user.id,
      });
    } catch (historyErr) {
      console.error('Failed to create initial version history:', historyErr);
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
        const msg = err instanceof Error ? err.message : 'Unknown error';
        warnings.push(`Classification failed: ${msg}`);
      }
    }

    if (auto_summarise) {
      try {
        await summariseInBackground(newItem.id, user.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        warnings.push(`Summary generation failed: ${msg}`);
      }
    }

    // Layer inference — suggest and store a layer if not explicitly provided
    let suggestedLayer: { suggestedLayer: string; reason: string; confidence: string } | undefined;
    try {
      const { inferLayer } = await import('@/lib/layer-inference');
      const plainTextForLayer = htmlToPlainText(content);
      const effectiveSource = (ingestion_source ?? 'manual') as
        'manual' | 'url_import' | 'upload' | 'bid_library';
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

      // Store the suggested layer in metadata via merge_item_metadata
      const { createServiceClient } = await import('@/lib/supabase/server');
      const serviceClient = createServiceClient();
      await serviceClient.rpc('merge_item_metadata', {
        p_item_id: newItem.id,
        p_new_data: { layer: suggestion.suggestedLayer },
      });
    } catch (layerErr) {
      console.error('Layer inference failed:', layerErr);
      // Non-fatal — item is still usable without a layer suggestion
    }

    // Quality score — calculate and store after AI processing
    try {
      const { calculateAndRoundQualityScore } = await import('@/lib/quality-score');
      const { createServiceClient } = await import('@/lib/supabase/server');
      const serviceClient = createServiceClient();

      // Fetch the latest item state (classification may have updated fields)
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
          topicSuggestion = { topicId: suggestion.topicId, reason: suggestion.reason };
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
    let guideSectionSuggestions: import('@/lib/guide-section-mapping').GuideSectionMatch[] | undefined;
    {
      const effectiveDomain = primary_domain || '';
      const effectiveSubtopic = primary_subtopic || '';
      if (effectiveDomain) {
        try {
          const { suggestGuideSections } = await import('@/lib/guide-section-mapping');
          const { createServiceClient } = await import('@/lib/supabase/server');
          const serviceClient = createServiceClient();
          const matches = await suggestGuideSections(serviceClient, {
            primaryDomain: effectiveDomain,
            primarySubtopic: effectiveSubtopic,
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
        ...(dedupMatches.length > 0 && { duplicate_matches: dedupMatches }),
        ...(suggestedLayer && { suggested_layer: suggestedLayer }),
        ...(topicSuggestion && { topic_suggestion: topicSuggestion }),
        ...(guideSectionSuggestions && { guide_section_suggestions: guideSectionSuggestions }),
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
    errorMessage = err instanceof Error ? err.message : 'Unknown classification error';
    console.error(`Background classification failed for ${itemId}:`, err);
    caughtError = err;
  }

  try {
    await supabase.from('pipeline_runs').insert({
      pipeline_name: 'background_classify',
      status,
      items_processed: 1,
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    });
  } catch (logErr) {
    console.error('Failed to log classification pipeline run:', logErr);
  }

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

  try {
    await supabase.from('pipeline_runs').insert({
      pipeline_name: 'background_summarise',
      status,
      items_processed: 1,
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    });
  } catch (logErr) {
    console.error('Failed to log summary pipeline run:', logErr);
  }

  if (caughtError) throw caughtError;
}
