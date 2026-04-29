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
import { resolveContentOwnerId } from '@/lib/auth/owner-default';
import { validateUrl } from '@/lib/extraction/url-validation';
import { detectContentType } from '@/lib/extraction/content-type-detect';
import { logger, updateRequestContext } from '@/lib/logger';
import { withRequestContext } from '@/lib/route-context';

export const maxDuration = 60;

/**
 * POST /api/ingest/url — extract → dedup → classify → embed → store.
 *
 * Phase 2 (S15 WP1): wrapped with `withRequestContext` so this multi-step
 * pipeline emits one shared `requestId` across every log line. Spec §6
 * AC3: "multi-step pipelines carry a correlation ID".
 */
export const POST = withRequestContext(async (request: NextRequest) => {
  try {
    // 1. Auth check: editor or admin
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase, role } = auth;

    // Upgrade the request scope with the resolved user so subsequent
    // log lines + any Sentry events carry userId/userRole.
    updateRequestContext({ userId: user.id, userRole: role });

    // 2. Rate limit: 10 req/min
    const rl = checkRateLimit(`ingest:url:${user.id}`, 10, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    // 3. Parse and validate request body
    const raw = await request.json();
    const parsed = parseBody(IngestUrlBodySchema, raw);
    if (!parsed.success) return parsed.response;
    const {
      url,
      content_type: requestedContentType,
      user_tags,
      skip_dedup,
      content_owner_id,
    } = parsed.data;

    // Admin-only dedup override (spec §6 D2). Silent-ignore for
    // non-admin — do not 403 a legitimate write.
    const skipDedup = skip_dedup === true && role === 'admin';

    // S206 WP-A Phase 2 (AC3.1) — resolve content owner. Admin caller may
    // supply an explicit owner UUID; non-admins are silent-forced to
    // themselves via the helper.
    const ownerId = resolveContentOwnerId({
      explicit: content_owner_id,
      role,
      userId: user.id,
    });

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

    // 11. Dedup — soft-block per spec §6 D1. Exact-hash match stamps
    // `dedup_status='suspected_duplicate'` + records the existing id in
    // `metadata.suspected_duplicate_of`. Near-duplicate remains
    // informational. Admin override via `skip_dedup=true` (silent-ignore
    // for non-admin). URL identity check above is a separate hard-skip
    // path and is unchanged.
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
      content_owner_id: ownerId,
      dedup_status: dedupStamp.dedup_status,
      // S207 WP-A4 (Plan Task 3.2): typed provenance column. Read by
      // ensure_v1_history_at_commit() to set
      // content_history.change_reason='initial_ingest'.
      ingest_source: 'url_import' as const,
      ...(user_tags?.length && { user_tags }),
      ...(embeddingValue && { embedding: embeddingValue }),
      metadata: {
        ingestion_source: 'url_import',
        extraction_method: extracted.extractionMethod,
        ...(extracted.pageCount && { page_count: extracted.pageCount }),
        ...(extracted.ogDescription && {
          og_description: extracted.ogDescription,
        }),
        ...(dedupStamp.suspected_duplicate_of && {
          suspected_duplicate_of: dedupStamp.suspected_duplicate_of,
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

    // 13. Content history version 1 — S207 WP-A4 Task 3.4: app-level v1
    // content_history insert removed. The deferred trigger
    // `trg_content_items_ensure_v1_history` is now the single authority for
    // v1 history rows. See spec docs/specs/ingest-path-consistency-spec.md
    // §3.4 AC4.3.

    // 13a. Chunking — split content into searchable sections
    try {
      const { regenerateChunks } = await import('@/lib/content/chunk-store');
      const { createServiceClient } = await import('@/lib/supabase/server');
      const chunkServiceClient = createServiceClient();
      const chunkResult = await regenerateChunks(
        chunkServiceClient,
        newItem.id,
        extracted.content,
      );
      if (chunkResult.errors.length > 0) {
        warnings.push(`Chunking: ${chunkResult.errors.length} error(s)`);
      }
    } catch (chunkErr) {
      logger.warn(
        { err: chunkErr, op: 'ingest_url.chunking', itemId: newItem.id },
        'Chunking failed',
      );
      warnings.push('Content chunking failed');
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
      logger.warn(
        { err: dateErr, op: 'ingest_url.date_extraction' },
        'Date extraction failed',
      );
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

        await qualityServiceClient
          .from('content_items')
          .update({
            quality_score: score,
            quality_score_updated_at: new Date().toISOString(),
          })
          .eq('id', newItem.id);
      }
    } catch (qualityErr) {
      logger.warn(
        { err: qualityErr, op: 'ingest_url.quality_score' },
        'Quality score calculation failed',
      );
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
      logger.warn(
        { err: layerErr, op: 'ingest_url.layer_inference' },
        'Layer inference failed',
      );
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
      logger.warn(
        { err: topicErr, op: 'ingest_url.topic_suggestion' },
        'Topic suggestion failed',
      );
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
        logger.warn(
          { err: guideErr, op: 'ingest_url.guide_section_suggestion' },
          'Guide section suggestion failed',
        );
        // Non-fatal — item is still usable without guide section suggestions
      }
    }

    // 18. Fetch final item state (post-classify)
    const finalItem = await sb(
      supabase
        .from('content_items')
        .select('primary_domain, primary_subtopic, summary')
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
      summary: finalItem?.summary,
      content_length: extracted.contentLength,
      warnings,
      dedup_status: dedupStamp.dedup_status,
      ...(dedupStamp.suspected_duplicate_of && {
        suspected_duplicate_of: dedupStamp.suspected_duplicate_of,
      }),
      duplicate_matches: dedupMatches,
      ...(suggestedLayer && { suggested_layer: suggestedLayer }),
      ...(topicSuggestion && { topic_suggestion: topicSuggestion }),
      ...(guideSectionSuggestions && {
        guide_section_suggestions: guideSectionSuggestions,
      }),
    });
  } catch (err) {
    logger.error({ err, op: 'ingest_url' }, 'Failed to ingest URL');
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to ingest URL') },
      { status: 500 },
    );
  }
});
