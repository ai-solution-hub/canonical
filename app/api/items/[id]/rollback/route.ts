import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, forbiddenResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { RollbackBodySchema } from '@/lib/validation/schemas';

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
    if (!auth) return forbiddenResponse();
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
      return NextResponse.json(
        { error: 'Version not found' },
        { status: 404 },
      );
    }

    // Step 3: Fetch current state of the content item
    const { data: currentItem, error: currentError } = await supabase
      .from('content_items')
      .select('title, content, brief, detail, reference, metadata')
      .eq('id', id)
      .single();

    // Step 4: Return 404 if content item doesn't exist
    if (currentError || !currentItem) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 },
      );
    }

    // Step 5: Snapshot current state into content_history before overwriting
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
      metadata: currentItem.metadata ?? null,
      change_summary: `Rolled back to version ${targetVersion.version}`,
      change_type: 'rollback',
      created_by: user.id,
    });

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
