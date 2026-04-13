import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import {
  ItemUpdateBodySchema,
  VALID_CONTENT_TYPES,
  VALID_PLATFORMS,
} from '@/lib/validation/schemas';
import { generateSingleFieldChangeSummary } from '@/lib/change-summary';
import { generateEmbedding } from '@/lib/ai/embed';
import { stripMarkdown } from '@/lib/content/strip-markdown';
import {
  createWarningsCollector,
  warningsEnvelope,
} from '@/lib/supabase/warnings';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';

export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Auth + role check
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { id } = await params;

    // Validate UUID format
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid item ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    const raw = await request.json();
    const parsed = parseBody(ItemUpdateBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { field, value, regenerate_embedding, reclassify, change_reason } =
      parsed.data;

    // Additional field-specific validation
    if (field === 'content_type' && typeof value === 'string') {
      if (!(VALID_CONTENT_TYPES as readonly string[]).includes(value)) {
        return NextResponse.json(
          { error: `Invalid content type: ${value}` },
          { status: 400 },
        );
      }
    }

    if (field === 'platform' && typeof value === 'string') {
      if (!(VALID_PLATFORMS as readonly string[]).includes(value)) {
        return NextResponse.json(
          { error: `Invalid platform: ${value}` },
          { status: 400 },
        );
      }
    }

    if (field === 'ai_keywords' && value !== null && !Array.isArray(value)) {
      return NextResponse.json(
        { error: 'ai_keywords must be an array or null' },
        { status: 400 },
      );
    }

    if (field === 'user_tags' && value !== null && !Array.isArray(value)) {
      return NextResponse.json(
        { error: 'user_tags must be an array or null' },
        { status: 400 },
      );
    }

    if (
      field === 'expiry_date' &&
      value !== null &&
      typeof value === 'string'
    ) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(value)) {
        return NextResponse.json(
          {
            error: 'expiry_date must be a valid ISO date (YYYY-MM-DD) or null',
          },
          { status: 400 },
        );
      }
      const parsed = new Date(value);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: 'expiry_date must be a valid date' },
          { status: 400 },
        );
      }
    }

    if (
      field === 'lifecycle_type' &&
      value !== null &&
      typeof value === 'string'
    ) {
      const validTypes = [
        'evergreen',
        'date_bound',
        'regulation',
        'bid_discovered',
      ];
      if (!validTypes.includes(value)) {
        return NextResponse.json(
          { error: `lifecycle_type must be one of: ${validTypes.join(', ')}` },
          { status: 400 },
        );
      }
    }

    // Fetch current state before update (for version history)
    const { data: currentItem, error: fetchError } = await supabase
      .from('content_items')
      .select(
        'title, content, brief, detail, reference, suggested_title, ai_keywords, primary_domain, primary_subtopic, secondary_domain, secondary_subtopic, priority, summary, content_type, platform, author_name, user_tags, answer_standard, answer_advanced, governance_review_status, expiry_date, lifecycle_type',
      )
      .eq('id', id)
      .single();

    if (fetchError || !currentItem) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Generate change summary
    const oldValue = currentItem[field as keyof typeof currentItem];
    const changeSummary = generateSingleFieldChangeSummary(
      field,
      oldValue,
      value,
    );

    // For Q&A answer fields, auto-rebuild the content field from Standard + Advanced
    const updateData: Record<string, unknown> = {
      [field]: value,
      updated_by: user.id,
    };
    if (
      (field === 'answer_standard' || field === 'answer_advanced') &&
      currentItem.content_type === 'q_a_pair'
    ) {
      const standard =
        field === 'answer_standard' ? value : currentItem.answer_standard;
      const advanced =
        field === 'answer_advanced' ? value : currentItem.answer_advanced;
      const parts: string[] = [];
      if (standard) parts.push(String(standard));
      if (advanced) parts.push(String(advanced));
      updateData.content = parts.join('\n\n') || null;
    }

    // Publishing from draft: generate embedding BEFORE clearing governance_review_status.
    // This is critical — hybrid_search() requires `embedding IS NOT NULL`, so items
    // must have an embedding before they become visible to search.
    if (field === 'governance_review_status' && value === null) {
      try {
        const contentText = currentItem.content ?? '';
        const titleText =
          currentItem.title ?? currentItem.suggested_title ?? '';
        if (contentText) {
          const plainText = stripMarkdown(contentText);
          const embeddingText = `${titleText}\n\n${plainText}`;
          const embedding = await generateEmbedding(embeddingText);
          updateData.embedding = JSON.stringify(embedding);
        }
      } catch (embedErr) {
        console.error('Embedding generation failed during publish:', embedErr);
        return NextResponse.json(
          {
            error:
              'Failed to generate embedding — item not published. Try again.',
          },
          { status: 500 },
        );
      }
    }

    // Perform the update
    const { error } = await supabase
      .from('content_items')
      .update(updateData)
      .eq('id', id);

    if (error) {
      console.error('Failed to update content item:', error);
      return NextResponse.json(
        { error: 'Failed to update item' },
        { status: 500 },
      );
    }

    // Collect non-fatal warnings to surface in the response
    const warnings = createWarningsCollector();

    // Check if domain has review-on-change governance posture
    // If the edited field is a significant content field, trigger governance review
    try {
      const significantFields = [
        'content',
        'summary',
        'suggested_title',
        'primary_domain',
        'primary_subtopic',
        'secondary_domain',
        'secondary_subtopic',
        'content_type',
      ];

      if (significantFields.includes(field)) {
        // Look up the item's domain to check governance config
        const itemDomain =
          field === 'primary_domain' && typeof value === 'string'
            ? value
            : currentItem.primary_domain;

        if (itemDomain) {
          const { data: govConfig, error: govConfigError } = await supabase
            .from('governance_config')
            .select('posture, reviewer_id, timeout_days')
            .eq('domain', itemDomain)
            .single();

          // PGRST116 is "no rows" — governance not configured for this
          // domain is expected and means "no review required". Any other
          // error is a real DB failure worth surfacing as a warning.
          if (govConfigError && govConfigError.code !== 'PGRST116') {
            logBestEffortWarn(
              'items.patch.governance_config',
              'Failed to look up governance_config',
              {
                itemId: id,
                code: govConfigError.code,
                message: govConfigError.message,
              },
            );
            warnings.add(
              'Governance config could not be loaded — review trigger skipped',
            );
          }

          if (govConfig?.posture === 'review_on_change') {
            const timeoutDays = govConfig.timeout_days ?? 7;
            const reviewDue = new Date();
            reviewDue.setDate(reviewDue.getDate() + timeoutDays);

            await supabase
              .from('content_items')
              .update({
                governance_review_status: 'pending',
                governance_review_due: reviewDue.toISOString(),
                governance_reviewer_id: govConfig.reviewer_id ?? null,
              })
              .eq('id', id);

            // Notify the designated reviewer
            if (govConfig.reviewer_id) {
              await supabase.from('notifications').insert({
                user_id: govConfig.reviewer_id,
                type: 'governance_review_needed',
                entity_type: 'content_item',
                entity_id: id,
                title: 'Governance review required',
                message: `Item edited: ${changeSummary}`,
                expires_at: reviewDue.toISOString(),
              });
            }
          }
        }
      }
    } catch (govErr) {
      // Governance check is best-effort — surface as warning
      logBestEffortWarn(
        'items.patch.governance_check',
        'Governance check failed',
        { itemId: id, err: String(govErr) },
      );
      warnings.add(
        'Governance check failed — item updated but governance review was not triggered',
      );
    }

    // Create version history entry (best-effort — don't fail the update if this fails)
    try {
      // The DB trigger content_history_auto_version() handles version numbering,
      // but we need to provide a version number for the insert.
      // Get the current max version for this item. PGRST116 ("no rows") is
      // expected when this is the first edit — treat as version 0.
      const { data: maxVersionData, error: maxVersionError } = await supabase
        .from('content_history')
        .select('version')
        .eq('content_item_id', id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (maxVersionError) {
        logBestEffortWarn(
          'items.patch.history_version_lookup',
          'Failed to look up max content_history version',
          {
            itemId: id,
            code: maxVersionError.code,
            message: maxVersionError.message,
          },
        );
      }

      const nextVersion = (maxVersionData?.version ?? 0) + 1;

      await supabase.from('content_history').insert({
        content_item_id: id,
        version: nextVersion,
        title: currentItem.title ?? '',
        content: currentItem.content ?? '',
        brief: currentItem.brief ?? null,
        detail: currentItem.detail ?? null,
        reference: currentItem.reference ?? null,
        change_summary: changeSummary,
        // S152B WP3 / Q-3: captures WHY the change was made (free-text
        // from the admin UI). NULL is acceptable when the user left
        // the "Why change?" field empty. Distinct from change_summary
        // (WHAT changed) and change_type (category).
        change_reason: change_reason ?? null,
        change_type: 'edit',
        created_by: user.id,
      });
    } catch (historyErr) {
      // Log but don't fail the update — surface as warning
      logBestEffortWarn(
        'items.patch.history_create',
        'Failed to create version history entry',
        { itemId: id, err: String(historyErr) },
      );
      warnings.add('Version history entry could not be created');
    }

    // Regenerate embedding if requested (for content body edits)
    if (regenerate_embedding && typeof value === 'string') {
      try {
        // Fetch the updated item to build embedding text
        const { data: updatedItem, error: updatedItemError } = await supabase
          .from('content_items')
          .select('title, content, summary')
          .eq('id', id)
          .single();

        if (updatedItemError) {
          logBestEffortWarn(
            'items.patch.embed_refetch',
            'Failed to re-fetch item for embedding regeneration',
            {
              itemId: id,
              code: updatedItemError.code,
              message: updatedItemError.message,
            },
          );
          warnings.add(
            'Embedding regeneration skipped: could not re-fetch item',
          );
        }

        if (updatedItem?.content) {
          const plainText = stripMarkdown(updatedItem.content);
          const embeddingText = `${updatedItem.title ?? ''}\n\n${plainText}`;
          const embedding = await generateEmbedding(embeddingText);
          await supabase
            .from('content_items')
            .update({ embedding: JSON.stringify(embedding) })
            .eq('id', id);
        }
      } catch (embedErr) {
        logBestEffortWarn(
          'items.patch.embed_regenerate',
          'Embedding regeneration failed',
          { itemId: id, err: String(embedErr) },
        );
        warnings.add('Embedding regeneration failed');
      }
    }

    // Flag reclassification as needed — must be triggered via the UI
    // (POST /api/items/:id/classify). Cannot use relative fetch() in
    // server-side API route context.
    if (reclassify) {
      warnings.add('Content updated — use "Classify" to reclassify this item');
    }

    // Recalculate quality score if a quality-relevant field changed
    const qualityRelevantFields = [
      'freshness',
      'classification_confidence',
      'brief',
      'detail',
      'reference',
      'summary',
      'content',
      'title',
    ];
    if (qualityRelevantFields.includes(field)) {
      try {
        const { calculateAndRoundQualityScore } =
          await import('@/lib/quality/quality-score');

        // Fetch the updated item's current state
        const { data: updatedForQuality, error: updatedForQualityError } =
          await supabase
            .from('content_items')
            .select(
              'freshness, classification_confidence, brief, detail, reference, summary, citation_count, quality_score',
            )
            .eq('id', id)
            .single();

        if (updatedForQualityError) {
          logBestEffortWarn(
            'items.patch.quality_refetch',
            'Failed to re-fetch item for quality recalculation',
            {
              itemId: id,
              code: updatedForQualityError.code,
              message: updatedForQualityError.message,
            },
          );
          warnings.add(
            'Quality score recalculation skipped: could not re-fetch item',
          );
        }

        if (updatedForQuality) {
          const newScore = calculateAndRoundQualityScore({
            freshness: updatedForQuality.freshness,
            classification_confidence:
              updatedForQuality.classification_confidence,
            brief: updatedForQuality.brief,
            detail: updatedForQuality.detail,
            reference: updatedForQuality.reference,
            summary: updatedForQuality.summary,
            citation_count: updatedForQuality.citation_count ?? 0,
          });

          await supabase
            .from('content_items')
            .update({
              previous_quality_score: updatedForQuality.quality_score ?? null,
              quality_score: newScore,
              quality_score_updated_at: new Date().toISOString(),
            })
            .eq('id', id);
        }
      } catch (qualityErr) {
        logBestEffortWarn(
          'items.patch.quality_recalc',
          'Quality score recalculation failed',
          { itemId: id, err: String(qualityErr) },
        );
        warnings.add('Quality score recalculation failed');
      }
    }

    return warningsEnvelope({ success: true }, warnings);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to process item request') },
      { status: 500 },
    );
  }
}

/** DELETE /api/items/:id -- delete content item (admin only) */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Auth + role check (admin only)
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { id } = await params;

    // Validate UUID format
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid item ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    // Verify item exists
    const { data: existingItem, error: fetchError } = await supabase
      .from('content_items')
      .select('id, title')
      .eq('id', id)
      .single();

    if (fetchError || !existingItem) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Delete the content item — related records are cleaned up via ON DELETE CASCADE
    const { error: deleteError } = await supabase
      .from('content_items')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Failed to delete content item:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete content item' },
        { status: 500 },
      );
    }

    return NextResponse.json({ deleted: true, id });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to delete content item') },
      { status: 500 },
    );
  }
}
