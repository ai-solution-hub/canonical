import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { sb } from '@/lib/supabase/safe';
import { safeErrorMessage } from '@/lib/error';
import type { Json } from '@/supabase/types/database.types';
import { parseBody } from '@/lib/validation';
import { IngestUrlBodySchema } from '@/lib/validation/ingest-schemas';
import { validateUrl } from '@/lib/extraction/url-validation';
import { detectContentType } from '@/lib/extraction/content-type-detect';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    // 1. Auth check: editor or admin
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    // 2. Rate limit: 10 req/min
    const rl = checkRateLimit(`ingest:url:${user.id}`, 10, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    // 3. Parse and validate request body
    const raw = await request.json();
    const parsed = parseBody(IngestUrlBodySchema, raw);
    if (!parsed.success) return parsed.response;
    const { url, content_type: requestedContentType, user_tags } = parsed.data;

    // 4. SSRF validation
    const urlCheck = validateUrl(url);
    if (!urlCheck.valid) {
      return NextResponse.json({ error: urlCheck.error }, { status: 400 });
    }

    // 5. Check if URL already exists in KB (soft warning)
    const existing = await sb(
      supabase
        .from('content_items')
        .select('id, title')
        .eq('source_url', url)
        .is('archived_at', null)
        .limit(1)
        .maybeSingle(),
      'content_items.byUrl',
    );

    if (existing) {
      return NextResponse.json({
        url_already_exists: true,
        existing_item: { id: existing.id, title: existing.title },
      });
    }

    // 6. Extract content from URL (lazy imports for serverless)
    const { extractFromUrl } = await import('@/lib/extraction/url');
    const extracted = await extractFromUrl(url);

    // 7. Quality check
    const warnings: string[] = [];
    if (extracted.contentLength < 100) {
      return NextResponse.json(
        {
          error:
            'Could not extract meaningful content from this page (less than 100 characters)',
        },
        { status: 422 },
      );
    }
    if (extracted.contentLength < 500) {
      warnings.push(
        'Limited text extracted from this page. The content may be incomplete.',
      );
    }

    // 8. Determine content type
    const contentType = requestedContentType || detectContentType(url);

    // 9. Parse source domain from URL
    let sourceDomain = '';
    try {
      sourceDomain = new URL(url).hostname;
    } catch {
      /* ignore */
    }

    // 10. Generate embedding
    const { generateEmbedding } = await import('@/lib/ai/embed');
    const plainText = extracted.content;
    const embeddingText = `${extracted.title}\n\n${plainText}`;
    let embeddingArray: number[] | undefined;
    let embeddingValue: string | undefined;
    try {
      embeddingArray = await generateEmbedding(embeddingText);
      embeddingValue = JSON.stringify(embeddingArray);
    } catch {
      warnings.push('Embedding generation failed');
    }

    // 11. Dedup check (informational only)
    let dedupMatches: Array<{
      id: string;
      title: string;
      similarity: number;
      match_type: string;
    }> = [];
    try {
      const { checkForDuplicates, formatDedupWarning } =
        await import('@/lib/dedup');
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
    } catch {
      /* non-fatal */
    }

    // 12. Create content item
    const insertData = {
      title: extracted.title || `Imported from ${sourceDomain}`,
      content: extracted.content,
      content_type: contentType,
      platform: 'web' as const,
      source_url: url,
      source_domain: sourceDomain,
      author_name: extracted.author || undefined,
      thumbnail_url: extracted.ogImage || undefined,
      captured_date: new Date().toISOString(),
      created_by: user.id,
      ...(user_tags?.length && { user_tags }),
      ...(embeddingValue && { embedding: embeddingValue }),
      metadata: {
        ingestion_source: 'url_import',
        extraction_method: extracted.extractionMethod,
        ...(extracted.pageCount && { page_count: extracted.pageCount }),
        ...(extracted.ogDescription && {
          og_description: extracted.ogDescription,
        }),
      },
    };

    const { data: newItem, error: insertError } = await supabase
      .from('content_items')
      .insert(insertData)
      .select('id, title, content_type, created_at')
      .single();

    if (insertError || !newItem) {
      return NextResponse.json(
        { error: 'Failed to create content item' },
        { status: 500 },
      );
    }

    // 13. Content history version 1
    try {
      await supabase.from('content_history').insert({
        content_item_id: newItem.id,
        version: 1,
        title: insertData.title,
        content: extracted.content,
        change_summary: `Imported from ${url}`,
        change_type: 'create',
        created_by: user.id,
      });
    } catch {
      /* best-effort */
    }

    // 13b. Date extraction — temporal references and expiry date
    let expiryDate: string | null = null;
    try {
      const { extractTemporalReferences, findExpiryDate, extractDates } =
        await import('@/lib/date-extraction');
      const temporalReferences = extractTemporalReferences(extracted.content);
      const dates = extractDates(extracted.content);
      expiryDate = findExpiryDate(dates);

      if (temporalReferences.length > 0 || expiryDate) {
        const { createServiceClient: createDateSvcClient } =
          await import('@/lib/supabase/server');
        const dateServiceClient = createDateSvcClient();

        if (temporalReferences.length > 0) {
          await dateServiceClient.rpc('merge_item_metadata', {
            p_item_id: newItem.id,
            p_new_data: {
              temporal_references: temporalReferences as unknown as Json,
            },
          });
        }
        if (expiryDate) {
          await supabase
            .from('content_items')
            .update({ expiry_date: expiryDate, lifecycle_type: 'date_bound' })
            .eq('id', newItem.id);
        }
      }

      if (expiryDate) {
        const formatted = new Date(expiryDate).toLocaleDateString('en-GB');
        warnings.push(
          `Expiry date detected: ${formatted} - lifecycle type set to date_bound`,
        );
      }
    } catch (dateErr) {
      console.error('Date extraction failed:', dateErr);
    }

    // 14. Classify (awaited)
    try {
      const { classifyContent } = await import('@/lib/ai/classify');
      await classifyContent({
        supabase,
        itemId: newItem.id,
        force: true,
        userId: user.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      warnings.push(`Classification failed: ${msg}`);
    }

    // 15. Summarise (awaited)
    try {
      const { generateSummary } = await import('@/lib/ai/summarise');
      await generateSummary({
        supabase,
        itemId: newItem.id,
        force: true,
        userId: user.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      warnings.push(`Summary generation failed: ${msg}`);
    }

    // 15b. Quality score calculation
    try {
      const { calculateAndRoundQualityScore } =
        await import('@/lib/quality/quality-score');
      const { createServiceClient: createQualitySvcClient } =
        await import('@/lib/supabase/server');
      const qualityServiceClient = createQualitySvcClient();

      const { data: latestItem } = await qualityServiceClient
        .from('content_items')
        .select(
          'freshness, classification_confidence, brief, detail, reference, ai_summary, citation_count',
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
          ai_summary: latestItem.ai_summary,
          citation_count: latestItem.citation_count ?? 0,
        });

        await qualityServiceClient
          .from('content_items')
          .update({
            quality_score: score,
            quality_score_updated_at: new Date().toISOString(),
          })
          .eq('id', newItem.id);
      }
    } catch (qualityErr) {
      console.error('Quality score calculation failed:', qualityErr);
    }

    // 16. Layer inference — suggest and store a layer
    let suggestedLayer:
      | { suggestedLayer: string; reason: string; confidence: string }
      | undefined;
    try {
      const { inferLayer } = await import('@/lib/layer-inference');
      const suggestion = inferLayer({
        contentType,
        contentLength: extracted.contentLength,
        ingestionSource: 'url_import',
        hasBrief: false,
        hasDetail: false,
        hasReference: false,
        isBidDiscovered: false,
        title: extracted.title || '',
      });
      suggestedLayer = suggestion;

      const { createServiceClient: createSvcClient } =
        await import('@/lib/supabase/server');
      const layerServiceClient = createSvcClient();
      await layerServiceClient
        .from('content_items')
        .update({ layer: suggestion.suggestedLayer })
        .eq('id', newItem.id);
    } catch (layerErr) {
      console.error('Layer inference failed:', layerErr);
      // Non-fatal — item is still usable without a layer suggestion
    }

    // 17. Topic suggestion — after layer inference
    let topicSuggestion: { topicId: string; reason: string } | undefined;
    let classifiedDomain = '';
    let classifiedSubtopic = '';
    let classifiedSecondaryDomain = '';
    let classifiedSecondarySubtopic = '';
    try {
      const { suggestTopic } = await import('@/lib/topic-inference');
      const { createServiceClient } = await import('@/lib/supabase/server');
      const serviceClient = createServiceClient();

      // Re-fetch domain/subtopic (set by classification in step 14)
      const classified = await sb(
        supabase
          .from('content_items')
          .select(
            'primary_domain, primary_subtopic, secondary_domain, secondary_subtopic',
          )
          .eq('id', newItem.id)
          .maybeSingle(),
        'content_items.classified',
      );

      classifiedDomain = classified?.primary_domain || '';
      classifiedSubtopic = classified?.primary_subtopic || '';
      classifiedSecondaryDomain = classified?.secondary_domain || '';
      classifiedSecondarySubtopic = classified?.secondary_subtopic || '';

      if (classifiedDomain && classifiedSubtopic) {
        const suggestion = await suggestTopic(serviceClient, {
          primaryDomain: classifiedDomain,
          primarySubtopic: classifiedSubtopic,
          title: extracted.title || '',
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

    // 17b. Guide section suggestion — after topic suggestion
    let guideSectionSuggestions:
      | import('@/lib/guide-section-mapping').GuideSectionMatch[]
      | undefined;
    if (classifiedDomain) {
      try {
        const { suggestGuideSections } =
          await import('@/lib/guide-section-mapping');
        const { createServiceClient } = await import('@/lib/supabase/server');
        const serviceClient = createServiceClient();
        const matches = await suggestGuideSections(serviceClient, {
          primaryDomain: classifiedDomain,
          primarySubtopic: classifiedSubtopic,
          secondaryDomain: classifiedSecondaryDomain || undefined,
          secondarySubtopic: classifiedSecondarySubtopic || undefined,
          layer: suggestedLayer?.suggestedLayer,
          contentType,
        });
        if (matches.length > 0) {
          guideSectionSuggestions = matches;
        }
      } catch (guideErr) {
        console.error('Guide section suggestion failed:', guideErr);
        // Non-fatal — item is still usable without guide section suggestions
      }
    }

    // 18. Fetch final item state (post-classify)
    const finalItem = await sb(
      supabase
        .from('content_items')
        .select('primary_domain, primary_subtopic, ai_summary')
        .eq('id', newItem.id)
        .maybeSingle(),
      'content_items.finalState',
    );

    return NextResponse.json({
      id: newItem.id,
      title: insertData.title,
      source_url: url,
      content_type: contentType,
      primary_domain: finalItem?.primary_domain,
      primary_subtopic: finalItem?.primary_subtopic,
      ai_summary: finalItem?.ai_summary,
      content_length: extracted.contentLength,
      warnings,
      duplicate_matches: dedupMatches,
      ...(suggestedLayer && { suggested_layer: suggestedLayer }),
      ...(topicSuggestion && { topic_suggestion: topicSuggestion }),
      ...(guideSectionSuggestions && {
        guide_section_suggestions: guideSectionSuggestions,
      }),
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to ingest URL') },
      { status: 500 },
    );
  }
}
