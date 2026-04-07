import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { sb } from '@/lib/supabase/safe';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { RollbackBodySchema } from '@/lib/validation/schemas';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/items/[id]/rollback
 *
 * Rollback a content item to a specific version.
 * Creates a NEW version snapshot of the current state (non-destructive),
 * then updates the content item with the target version's data.
 * Requires editor+ role.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { id } = await params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid item ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    const raw = await request.json();
    const parsed = parseBody(RollbackBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { version_id } = parsed.data;

    // Step 1: Fetch the target version to rollback to
    const { data: targetVersion, error: versionError } = await supabase
      .from('content_history')
      .select(
        'id, content_item_id, version, title, content, brief, detail, reference, metadata',
      )
      .eq('id', version_id)
      .eq('content_item_id', id)
      .single();

    // Step 2: Return 404 if target version doesn't exist
    if (versionError || !targetVersion) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }

    // Step 3: Fetch current state of the content item
    const { data: currentItem, error: currentError } = await supabase
      .from('content_items')
      .select('title, content, brief, detail, reference, metadata')
      .eq('id', id)
      .single();

    // Step 4: Return 404 if content item doesn't exist
    if (currentError || !currentItem) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Step 5: Snapshot current state into content_history before overwriting
    const maxVersionData = await sb(
      supabase
        .from('content_history')
        .select('version')
        .eq('content_item_id', id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle(),
      'content_history.maxVersion',
    );

    const nextVersion = (maxVersionData?.version ?? 0) + 1;

    const { error: snapshotError } = await supabase
      .from('content_history')
      .insert({
        content_item_id: id,
        version: nextVersion,
        title: currentItem.title ?? '',
        content: currentItem.content ?? '',
        brief: currentItem.brief ?? null,
        detail: currentItem.detail ?? null,
        reference: currentItem.reference ?? null,
        metadata: currentItem.metadata ?? null,
        change_summary: `Rolled back to version ${targetVersion.version}`,
        // S152B WP3 / S153: canonical rollback_to_v<N> reason.
        change_reason: `rollback_to_v${targetVersion.version}`,
        change_type: 'rollback',
        created_by: user.id,
      });

    if (snapshotError) {
      console.error(
        'Failed to snapshot current state before rollback:',
        snapshotError,
      );
      return NextResponse.json(
        { error: 'Failed to save current version snapshot — rollback aborted' },
        { status: 500 },
      );
    }

    // Step 6: Update content_items with the target version's data
    const { data: updateResult, error: updateError } = await supabase
      .from('content_items')
      .update({
        title: targetVersion.title,
        content: targetVersion.content,
        brief: targetVersion.brief,
        detail: targetVersion.detail,
        reference: targetVersion.reference,
        metadata: targetVersion.metadata,
        updated_by: user.id,
      })
      .eq('id', id)
      .select('id')
      .single();

    if (updateError || !updateResult) {
      console.error('Failed to rollback content item:', updateError);
      return NextResponse.json(
        { error: 'Failed to rollback item' },
        { status: 500 },
      );
    }

    // Step 7: Return success with the new version number
    return NextResponse.json({
      success: true,
      rolled_back_to_version: targetVersion.version,
      new_version: nextVersion,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to rollback item') },
      { status: 500 },
    );
  }
}
