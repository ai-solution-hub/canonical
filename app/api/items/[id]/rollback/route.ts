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
 * Creates a NEW version (not destructive) with the old content restored.
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

    // Fetch the version to rollback to
    const { data: targetVersion, error: versionError } = await supabase
      .from('content_history')
      .select('*')
      .eq('id', version_id)
      .eq('content_item_id', id)
      .single();

    if (versionError || !targetVersion) {
      return NextResponse.json(
        { error: 'Version not found' },
        { status: 404 },
      );
    }

    // Fetch current state for the history snapshot
    const { data: currentItem, error: currentError } = await supabase
      .from('content_items')
      .select('title, content, brief, detail, reference')
      .eq('id', id)
      .single();

    if (currentError || !currentItem) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 },
      );
    }

    // Update the content item with the version's content
    const { error: updateError } = await supabase
      .from('content_items')
      .update({
        title: targetVersion.title,
        content: targetVersion.content,
        brief: targetVersion.brief,
        detail: targetVersion.detail,
        reference: targetVersion.reference,
        updated_by: user.id,
      })
      .eq('id', id);

    if (updateError) {
      console.error('Failed to rollback content item:', updateError);
      return NextResponse.json(
        { error: 'Failed to rollback item' },
        { status: 500 },
      );
    }

    // Create a new version history entry for the rollback
    try {
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
        title: targetVersion.title,
        content: targetVersion.content,
        brief: targetVersion.brief,
        detail: targetVersion.detail,
        reference: targetVersion.reference,
        change_summary: `Rolled back to version ${targetVersion.version}`,
        change_type: 'rollback',
        created_by: user.id,
      });
    } catch (historyErr) {
      console.error('Failed to create rollback version entry:', historyErr);
    }

    return NextResponse.json({
      success: true,
      rolled_back_to_version: targetVersion.version,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to rollback item') },
      { status: 500 },
    );
  }
}
