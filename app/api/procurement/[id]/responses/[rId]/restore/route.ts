import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { ResponseRestoreBodySchema } from '@/lib/validation/schemas';
import { sb } from '@/lib/supabase/safe';
import { logger } from '@/lib/logger';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/bids/:id/responses/:rId/restore — restore a previous version */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; rId: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { id, rId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(rId)) {
      return NextResponse.json(
        { error: 'Invalid ID -- must be a valid UUID' },
        { status: 400 },
      );
    }

    const raw = await request.json();
    const parsed = parseBody(ResponseRestoreBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { version } = parsed.data;

    // Validate response belongs to this bid
    const { data: existing, error: existingError } = await supabase
      .from('form_responses')
      .select('id, question_id')
      .eq('id', rId)
      .single();

    if (existingError || !existing) {
      return NextResponse.json(
        { error: 'Response not found' },
        { status: 404 },
      );
    }

    const question = await sb(
      supabase
        .from('form_questions')
        .select('id')
        .eq('id', existing.question_id)
        .eq('workspace_id', id)
        .maybeSingle(),
      'bids.response.restore.questionOwnership',
    );

    if (!question) {
      return NextResponse.json(
        { error: 'Response not found in this bid' },
        { status: 404 },
      );
    }

    // Fetch the history row for the requested version
    const { data: historyRow, error: historyError } = await supabase
      .from('form_response_history')
      .select('*')
      .eq('response_id', rId)
      .eq('version', version)
      .single();

    if (historyError || !historyRow) {
      return NextResponse.json(
        { error: `Version ${version} not found in history` },
        { status: 404 },
      );
    }

    // Set change_reason session variable for the trigger to capture.
    await supabase.rpc('set_config', {
      setting: 'app.change_reason',
      value: `Restored from version ${version}`,
      is_local: true,
    });

    // Update the current response (this triggers the snapshot of the current version)
    const { data: updated, error: updateError } = await supabase
      .from('form_responses')
      .update({
        response_text: historyRow.response_text,
        response_text_advanced: historyRow.response_text_advanced,
        metadata: historyRow.metadata,
        source_content_ids: historyRow.source_content_ids,
        review_status: 'edited',
        last_edited_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', rId)
      .select(
        'id, question_id, response_text, response_text_advanced, review_status, version, last_edited_by, updated_at',
      )
      .single();

    if (updateError) {
      logger.error({ err: updateError }, 'Failed to restore response version');
      return NextResponse.json(
        { error: 'Failed to restore response version' },
        { status: 500 },
      );
    }

    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to restore response version') },
      { status: 500 },
    );
  }
}
