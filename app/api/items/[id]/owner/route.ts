import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { OwnerAssignSchema } from '@/lib/validation/schemas';
import { parseBody } from '@/lib/validation';

export const maxDuration = 30;

/**
 * PATCH /api/items/[id]/owner
 *
 * Assign or unassign a content owner for a content item.
 * Editor+ role required.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;
    const { id } = await params;

    // Validate item ID format
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid item ID' }, { status: 400 });
    }

    const body = await request.json();
    const parsed = parseBody(OwnerAssignSchema, body);
    if (!parsed.success) return parsed.response;

    const { owner_id } = parsed.data;

    // Fetch current item for history tracking
    const { data: current, error: fetchError } = await supabase
      .from('content_items')
      .select('id, title, content, content_owner_id')
      .eq('id', id)
      .single();

    if (fetchError) {
      // PGRST116 = "not found" from .single() — anything else is a real error
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      }
      return NextResponse.json(
        {
          error: safeErrorMessage(fetchError, 'Failed to update content owner'),
        },
        { status: 500 },
      );
    }
    if (!current) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    const currentData = current as Record<string, unknown>;
    const previousOwnerId = currentData.content_owner_id;

    // Update content_owner_id
    const updateData = {
      content_owner_id: owner_id,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };
    const { data: updated, error: updateError } = await supabase
      .from('content_items')
      .update(updateData)
      .eq('id', id)
      .select('id')
      .single();

    if (updateError || !updated) {
      return NextResponse.json(
        {
          error: safeErrorMessage(
            updateError,
            'Failed to update content owner',
          ),
        },
        { status: 500 },
      );
    }

    // Record in content_history (best-effort)
    // Best-effort post-update steps. Failures are recorded as warnings on
    // the response so the UI can surface them ("owner saved, but…")
    // instead of pretending everything worked.
    const warnings: string[] = [];

    try {
      // Get max version for this item
      const { data: maxVersionData, error: maxVersionError } = await supabase
        .from('content_history')
        .select('version')
        .eq('content_item_id', id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (maxVersionError) {
        console.error(
          'Failed to fetch max content_history version:',
          maxVersionError,
        );
        warnings.push('Owner change saved, but version history was not recorded');
      } else {
        const nextVersion = ((maxVersionData?.version as number) ?? 0) + 1;

        const { error: historyInsertError } = await supabase
          .from('content_history')
          .insert({
            content_item_id: id,
            version: nextVersion,
            title: (currentData.title as string) ?? '',
            content: (currentData.content as string) ?? '',
            change_type: 'owner_change',
            change_summary: `Content owner ${owner_id ? 'assigned' : 'unassigned'}`,
            // S152B WP3 / S153: canonical change_reason for owner reassignment.
            change_reason: 'owner_change',
            change_details: {
              field: 'content_owner_id',
              old: previousOwnerId,
              new: owner_id,
            },
            changed_by: user.id,
          });
        if (historyInsertError) {
          console.error(
            'Failed to insert content_history row for owner change:',
            historyInsertError,
          );
          warnings.push(
            'Owner change saved, but version history was not recorded',
          );
        }
      }
    } catch (err) {
      console.warn('Failed to record content history for owner change:', err);
      warnings.push('Owner change saved, but version history was not recorded');
    }

    // Create notification for the new owner if different from current user.
    // Documented as best-effort but absence is user-visible — surface as a
    // warning so the assigning user can re-notify out of band.
    if (owner_id && owner_id !== user.id) {
      try {
        const { error: notifInsertError } = await supabase
          .from('notifications')
          .insert({
            user_id: owner_id,
            type: 'owner_assignment',
            entity_type: 'content_item',
            entity_id: id,
            title: 'You have been assigned as content owner',
            message: null,
          });
        if (notifInsertError) {
          console.error(
            'Failed to create owner assignment notification:',
            notifInsertError,
          );
          warnings.push(
            'Owner saved, but the new owner was not notified — please tell them directly',
          );
        }
      } catch (err) {
        console.warn('Failed to create owner assignment notification:', err);
        warnings.push(
          'Owner saved, but the new owner was not notified — please tell them directly',
        );
      }
    }

    return NextResponse.json({
      success: true,
      owner_id,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update content owner') },
      { status: 500 },
    );
  }
}
