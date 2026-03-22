import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse, rateLimitResponse } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
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
    const { data: existing } = await supabase
      .from('content_items')
      .select('id, title')
      .eq('source_url', url)
      .is('archived_at', null)
      .limit(1)
      .maybeSingle();

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
        { error: 'Could not extract meaningful content from this page (less than 100 characters)' },
        { status: 422 },
      );
    }
    if (extracted.contentLength < 500) {
      warnings.push('Limited text extracted from this page. The content may be incomplete.');
    }

    // 8. Determine content type
    const contentType = requestedContentType || detectContentType(url);

    // 9. Parse source domain from URL
    let sourceDomain = '';
    try {
      sourceDomain = new URL(url).hostname;
    } catch { /* ignore */ }

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
    let dedupMatches: Array<{ id: string; title: string; similarity: number; match_type: string }> = [];
    try {
      const { checkForDuplicates, formatDedupWarning } = await import('@/lib/dedup');
      const dedupResult = await checkForDuplicates(supabase, plainText, embeddingArray);
      if (dedupResult.has_duplicates) {
        dedupMatches = dedupResult.matches;
        const warning = formatDedupWarning(dedupResult);
        if (warning) warnings.push(warning);
      }
    } catch { /* non-fatal */ }

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
        ...(extracted.ogDescription && { og_description: extracted.ogDescription }),
      },
    };

    const { data: newItem, error: insertError } = await supabase
      .from('content_items')
      .insert(insertData)
      .select('id, title, content_type, created_at')
      .single();

    if (insertError || !newItem) {
      return NextResponse.json({ error: 'Failed to create content item' }, { status: 500 });
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
    } catch { /* best-effort */ }

    // 14. Classify (awaited)
    try {
      const { classifyContent } = await import('@/lib/ai/classify');
      await classifyContent({ supabase, itemId: newItem.id, force: true, userId: user.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      warnings.push(`Classification failed: ${msg}`);
    }

    // 15. Summarise (awaited)
    try {
      const { generateSummary } = await import('@/lib/ai/summarise');
      await generateSummary({ supabase, itemId: newItem.id, force: true, userId: user.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      warnings.push(`Summary generation failed: ${msg}`);
    }

    // 16. Layer inference — suggest and store a layer
    let suggestedLayer: { suggestedLayer: string; reason: string; confidence: string } | undefined;
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

      await supabase.rpc('merge_item_metadata', {
        p_item_id: newItem.id,
        p_new_data: { layer: suggestion.suggestedLayer },
      });
    } catch (layerErr) {
      console.error('Layer inference failed:', layerErr);
      // Non-fatal — item is still usable without a layer suggestion
    }

    // 17. Topic suggestion — after layer inference
    let topicSuggestion: { topicId: string; reason: string } | undefined;
    try {
      const { suggestTopic } = await import('@/lib/topic-inference');
      const { createServiceClient } = await import('@/lib/supabase/server');
      const serviceClient = createServiceClient();

      // Re-fetch domain/subtopic (set by classification in step 14)
      const { data: classified } = await supabase
        .from('content_items')
        .select('primary_domain, primary_subtopic')
        .eq('id', newItem.id)
        .single();

      const effectiveDomain = classified?.primary_domain || '';
      const effectiveSubtopic = classified?.primary_subtopic || '';

      if (effectiveDomain && effectiveSubtopic) {
        const suggestion = await suggestTopic(serviceClient, {
          primaryDomain: effectiveDomain,
          primarySubtopic: effectiveSubtopic,
          title: extracted.title || '',
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

    // 18. Fetch final item state (post-classify)
    const { data: finalItem } = await supabase
      .from('content_items')
      .select('primary_domain, primary_subtopic, ai_summary')
      .eq('id', newItem.id)
      .single();

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
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to ingest URL') },
      { status: 500 },
    );
  }
}
