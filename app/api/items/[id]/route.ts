import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import {
  ItemUpdateBodySchema,
  VALID_CONTENT_TYPES,
  VALID_PLATFORMS,
  normaliseTag,
} from '@/lib/validation/schemas';
import { generateSingleFieldChangeSummary } from '@/lib/change-summary';
import { generateEmbedding } from '@/lib/ai/embed';
import { stripMarkdown } from '@/lib/content/strip-markdown';
import {
  createWarningsCollector,
  warningsEnvelope,
} from '@/lib/supabase/warnings';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import {
  setSupersession,
  SupersessionError,
} from '@/lib/supersession/set';
import { SupabaseError } from '@/lib/supabase/safe';
import { resolveQuestionForRebuild } from '@/lib/bid-library-ingest/resolve-question';

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

    // --------------------------------------------------------------------
    // Supersession branch (S186 WP-B.5). Admin-only. Detours around the
    // generic update flow because the shared `setSupersession` helper
    // handles validation (exists + not-self + not-chain) and the audit
    // log. Spec: docs/specs/supersession-model-spec.md §5.1.
    // --------------------------------------------------------------------
    if (field === 'superseded_by') {
      // Re-check role — supersession is admin-only even though the route
      // otherwise accepts admin + editor (spec §5 Q1 lock).
      const { data: userRole, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();
      if (roleError) {
        logBestEffortWarn(
          'items.patch.supersession.role_lookup',
          'Failed to look up user_roles for supersession admin check',
          {
            userId: user.id,
            code: roleError.code,
            message: roleError.message,
          },
        );
        return NextResponse.json(
          { error: 'Could not verify permissions; try again.' },
          { status: 500 },
        );
      }
      if (userRole?.role !== 'admin') {
        return NextResponse.json(
          { error: 'Supersession is admin-only.' },
          { status: 403 },
        );
      }

      // null clears the pointer (un-supersede) — revert dedup_status to
      // 'suspected_duplicate' so the row re-enters the soft-block review
      // queue rather than being silently "clean".
      //
      // Design choice (verifier M2, S186 WP-B.5): this is intentionally
      // conservative — an admin un-superseding a row that was NEVER a
      // hash-duplicate still lands in the review queue. That's a minor
      // false-positive in the queue but guarantees no "clean" row silently
      // dropped out of search review. Acceptable because un-supersession
      // is admin-only + rare. If audit evidence post-launch shows a real
      // volume of non-dedup supersessions, revisit by branching on the
      // pre-supersede dedup_status.
      if (value === null) {
        const { error: clearErr } = await supabase
          .from('content_items')
          .update({
            superseded_by: null,
            dedup_status: 'suspected_duplicate',
            updated_by: user.id,
          })
          .eq('id', id);
        if (clearErr) {
          return NextResponse.json(
            { error: `Un-supersede failed: ${clearErr.message}` },
            { status: 500 },
          );
        }
        return NextResponse.json({
          success: true,
          superseded_by: null,
          dedup_status: 'suspected_duplicate',
        });
      }

      try {
        const result = await setSupersession(
          {
            oldId: id,
            newId: value as string,
            actorUserId: user.id,
          },
          supabase,
        );
        return NextResponse.json({
          success: true,
          old_item: result.oldItem,
          new_item: result.newItem,
        });
      } catch (err) {
        if (err instanceof SupersessionError) {
          const status =
            err.code === 'OLD_NOT_FOUND' || err.code === 'NEW_NOT_FOUND'
              ? 404
              : 409;
          return NextResponse.json(
            { error: err.message, error_code: err.code },
            { status },
          );
        }
        if (err instanceof SupabaseError) {
          return NextResponse.json(
            { error: `Supersession failed: ${err.message}` },
            { status: 500 },
          );
        }
        return NextResponse.json(
          {
            error: `Unexpected error: ${safeErrorMessage(err, 'unknown error')}`,
          },
          { status: 500 },
        );
      }
    }

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

    if (
      field === 'governance_review_status' &&
      value !== null &&
      typeof value === 'string'
    ) {
      const validStatuses = ['draft', 'pending', 'approved', 'rejected'];
      if (!validStatuses.includes(value)) {
        return NextResponse.json(
          {
            error: `governance_review_status must be one of: ${validStatuses.join(', ')}`,
          },
          { status: 400 },
        );
      }
    }

    // Fetch current state before update (for version history)
    const { data: currentItem, error: fetchError } = await supabase
      .from('content_items')
      .select(
        'title, content, brief, detail, reference, suggested_title, ai_keywords, primary_domain, primary_subtopic, secondary_domain, secondary_subtopic, priority, summary, content_type, platform, author_name, user_tags, answer_standard, answer_advanced, governance_review_status, expiry_date, lifecycle_type, classified_at',
      )
      .eq('id', id)
      .single();

    if (fetchError || !currentItem) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Normalise ai_keywords at the write boundary (spec ss6.6 EP4).
    // Ensures web-form-edited keywords match classify-time canonicalisation.
    // Computed BEFORE change summary so the recorded value matches what is
    // actually stored (WP3 L-1 fix).
    const effectiveValue =
      field === 'ai_keywords' && Array.isArray(value)
        ? [...new Set(value.map(normaliseTag).filter((k: string) => k.length > 0))]
        : value;

    // Generate change summary using the normalised value
    const oldValue = currentItem[field as keyof typeof currentItem];
    const changeSummary = generateSingleFieldChangeSummary(
      field,
      oldValue,
      effectiveValue,
    );

    // For Q&A answer fields, auto-rebuild the content field from Standard + Advanced.
    // Canonical shape per P0-BM Phase 3 spec ss4.1:
    //   Q: {question}\n\n{answer_standard}\n\n{answer_advanced}
    // Question sourced via resolveQuestionForRebuild (spec ss6.2 Option B).
    const updateData: Record<string, unknown> = {
      [field]: effectiveValue,
      updated_by: user.id,
    };
    let rebuiltQaContent: string | null = null;
    if (
      (field === 'answer_standard' || field === 'answer_advanced') &&
      currentItem.content_type === 'q_a_pair'
    ) {
      const question = resolveQuestionForRebuild(
        currentItem.content,
        currentItem.title,
      );
      const standard =
        field === 'answer_standard' ? value : currentItem.answer_standard;
      const advanced =
        field === 'answer_advanced' ? value : currentItem.answer_advanced;
      const parts: string[] = [`Q: ${question}`];
      if (standard) parts.push(String(standard));
      if (advanced) parts.push(String(advanced));
      const joined = parts.join('\n\n');
      updateData.content = joined;
      rebuiltQaContent = joined;
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

    // S183 WP1 G2 — first-time publish for draft-created items needs
    // classification + chunks. Drafts bypass the AI pipeline in POST
    // /api/items, so items with classified_at = NULL have no
    // entity_mentions, entity_relationships, summary, or content_chunks.
    // Running now fixes that so the item is fully searchable + richly
    // linked the moment it becomes live. Non-fatal: any failure becomes
    // a warning rather than un-publishing the item.
    if (
      field === 'governance_review_status' &&
      value === null &&
      !currentItem.classified_at &&
      currentItem.content
    ) {
      const { createServiceClient } = await import('@/lib/supabase/server');
      const { recordPipelineRun } = await import('@/lib/pipeline/record-run');
      const publishServiceClient = createServiceClient();

      let classifyStatus: 'completed' | 'failed' = 'completed';
      let classifyError: string | null = null;
      try {
        const { classifyContent } = await import('@/lib/ai/classify');
        await classifyContent({
          supabase: publishServiceClient,
          itemId: id,
          force: true,
          userId: user.id,
        });
      } catch (classifyErr) {
        classifyStatus = 'failed';
        classifyError =
          classifyErr instanceof Error
            ? classifyErr.message
            : 'Unknown classification error';
        console.error(`Publish classify failed for ${id}:`, classifyErr);
        warnings.add('Classification failed on publish');
      }
      await recordPipelineRun({
        supabase: publishServiceClient,
        pipelineName: 'publish_classify',
        status: classifyStatus,
        itemsProcessed: 1,
        errorMessage: classifyError,
      });

      try {
        const { regenerateChunks } = await import('@/lib/content/chunk-store');
        await regenerateChunks(publishServiceClient, id, currentItem.content);
      } catch (chunkErr) {
        console.error(`Publish chunking failed for ${id}:`, chunkErr);
        warnings.add('Chunk generation failed on publish');
      }
    }

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

    // Regenerate chunks when content changes.
    // Triggered by: (a) direct content-field edits, (b) Q&A rebuilds that
    // reconstruct `content` from answer_standard + answer_advanced.
    const newContentForChunks: string | null =
      field === 'content' && typeof value === 'string'
        ? value
        : rebuiltQaContent;
    if (newContentForChunks !== null) {
      try {
        const { regenerateChunks } = await import('@/lib/content/chunk-store');
        const { createServiceClient } = await import('@/lib/supabase/server');
        const chunkServiceClient = createServiceClient();
        const chunkResult = await regenerateChunks(
          chunkServiceClient,
          id,
          newContentForChunks,
        );
        if (chunkResult.errors.length > 0) {
          warnings.add(
            `Chunk regeneration: ${chunkResult.errors.length} error(s)`,
          );
        }
      } catch (chunkErr) {
        logBestEffortWarn(
          'items.patch.chunk_regenerate',
          'Chunk regeneration failed',
          { itemId: id, err: String(chunkErr) },
        );
        warnings.add('Content chunk regeneration failed');
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
