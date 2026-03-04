import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, forbiddenResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import {
  ItemUpdateBodySchema,
  VALID_CONTENT_TYPES,
  VALID_PLATFORMS,
} from '@/lib/validation/schemas';
import { generateSingleFieldChangeSummary } from '@/lib/change-summary';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Auth + role check
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth) return forbiddenResponse();
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

    const { field, value } = parsed.data;

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
      .select('title, content, brief, detail, reference, suggested_title, ai_keywords, primary_domain, primary_subtopic, secondary_domain, secondary_subtopic, priority, ai_summary, content_type, platform, author_name, user_tags')
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

    // Perform the update
    const { error } = await supabase
      .from('content_items')
      .update({ [field]: value, updated_by: user.id })
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
