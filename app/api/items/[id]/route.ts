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
import { htmlToPlainText } from '@/lib/editor-utils';

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

    const { field, value, regenerate_embedding, reclassify } = parsed.data;

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

    // Fetch current state before update (for version history)
    const { data: currentItem, error: fetchError } = await supabase
      .from('content_items')
      .select('title, content, brief, detail, reference, suggested_title, ai_keywords, primary_domain, primary_subtopic, secondary_domain, secondary_subtopic, priority, ai_summary, content_type, platform, author_name, user_tags, answer_standard, answer_advanced, governance_review_status')
      .eq('id', id)
      .single();

    if (fetchError || !currentItem) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 },
      );
    }

    // Generate change summary
    const oldValue = currentItem[field as keyof typeof currentItem];
    const changeSummary = generateSingleFieldChangeSummary(
      field,
      oldValue,
      value,
    );

    // For Q&A answer fields, auto-rebuild the content field from Standard + Advanced
    const updateData: Record<string, unknown> = { [field]: value, updated_by: user.id };
    if (
      (field === 'answer_standard' || field === 'answer_advanced') &&
      currentItem.content_type === 'q_a_pair'
    ) {
      const standard = field === 'answer_standard' ? value : currentItem.answer_standard;
      const advanced = field === 'answer_advanced' ? value : currentItem.answer_advanced;
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
        const titleText = currentItem.title ?? currentItem.suggested_title ?? '';
        if (contentText) {
          const plainText = htmlToPlainText(contentText);
          const embeddingText = `${titleText}\n\n${plainText}`;
          const embedding = await generateEmbedding(embeddingText);
          updateData.embedding = JSON.stringify(embedding);
        }
      } catch (embedErr) {
        console.error('Embedding generation failed during publish:', embedErr);
        return NextResponse.json(
          { error: 'Failed to generate embedding — item not published. Try again.' },
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
    const warnings: string[] = [];

    // Check if domain has review-on-change governance posture
    // If the edited field is a significant content field, trigger governance review
    try {
      const significantFields = [
        'content',
        'ai_summary',
        'suggested_title',
        'primary_domain',
        'primary_subtopic',
        'secondary_domain',
        'secondary_subtopic',
        'content_type',
      ];

      if (significantFields.includes(field)) {
        // Look up the item's domain to check governance config
        const itemDomain = field === 'primary_domain' && typeof value === 'string'
          ? value
          : currentItem.primary_domain;

        if (itemDomain) {
          const { data: govConfig } = await supabase
            .from('governance_config')
            .select('posture, reviewer_id, timeout_days')
            .eq('domain', itemDomain)
            .single();

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
      console.error('Governance check failed:', govErr);
      warnings.push('Governance check failed — item updated but governance review was not triggered');
    }

    // Create version history entry (best-effort — don't fail the update if this fails)
    try {
      // The DB trigger content_history_auto_version() handles version numbering,
      // but we need to provide a version number for the insert.
      // Get the current max version for this item.
      const { data: maxVersionData } = await supabase
        .from('content_history')
        .select('version')
        .eq('content_item_id', id)
        .order('version', { ascending: false })
        .limit(1)
        .single();

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
        change_type: 'edit',
        created_by: user.id,
      });
    } catch (historyErr) {
      // Log but don't fail the update — surface as warning
      console.error('Failed to create version history entry:', historyErr);
      warnings.push('Version history entry could not be created');
    }

    // Regenerate embedding if requested (for content body edits)
    if (regenerate_embedding && typeof value === 'string') {
      try {
        // Fetch the updated item to build embedding text
        const { data: updatedItem } = await supabase
          .from('content_items')
          .select('title, content, ai_summary')
          .eq('id', id)
          .single();

        if (updatedItem?.content) {
          const plainText = htmlToPlainText(updatedItem.content);
          const embeddingText = `${updatedItem.title ?? ''}\n\n${plainText}`;
          const embedding = await generateEmbedding(embeddingText);
          await supabase
            .from('content_items')
            .update({ embedding: JSON.stringify(embedding) })
            .eq('id', id);
        }
      } catch (embedErr) {
        console.error('Embedding regeneration failed:', embedErr);
        warnings.push('Embedding regeneration failed');
      }
    }

    // Flag reclassification as needed — must be triggered via the UI
    // (POST /api/items/:id/classify). Cannot use relative fetch() in
    // server-side API route context.
    if (reclassify) {
      warnings.push('Content updated — use "Classify" to reclassify this item');
    }

    const response: Record<string, unknown> = { success: true };
    if (warnings.length > 0) {
      response.warnings = warnings;
    }
    return NextResponse.json(response);
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
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 },
      );
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
