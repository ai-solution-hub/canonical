import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { QuestionUpdateBodySchema } from '@/lib/validation/schemas';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PATCH /api/bids/:id/questions/:qId -- update a question */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; qId: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { id, qId } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid bid ID -- must be a valid UUID' },
        { status: 400 },
      );
    }
    if (!UUID_RE.test(qId)) {
      return NextResponse.json(
        { error: 'Invalid question ID -- must be a valid UUID' },
        { status: 400 },
      );
    }

    const raw = await request.json();
    const parsed = parseBody(QuestionUpdateBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const updates = parsed.data;

    // Ensure there is at least one field to update
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 },
      );
    }

    const { data: updated, error } = await supabase
      .from('bid_questions')
      .update(updates)
      .eq('id', qId)
      .eq('project_id', id)
      .select(
        'id, project_id, section_name, section_sequence, question_text, question_sequence, word_limit, evaluation_weight, confidence_posture, matched_content_ids, assigned_to, created_by, created_at, updated_at',
      )
      .single();

    if (error) {
      // PostgREST returns PGRST116 when no rows match .single()
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Question not found for this bid' },
          { status: 404 },
        );
      }
      console.error('Failed to update bid question:', error);
      return NextResponse.json(
        { error: 'Failed to update bid question' },
        { status: 500 },
      );
    }

    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update bid question') },
      { status: 500 },
    );
  }
}

/** DELETE /api/bids/:id/questions/:qId -- remove a question */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; qId: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { id, qId } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid bid ID -- must be a valid UUID' },
        { status: 400 },
      );
    }
    if (!UUID_RE.test(qId)) {
      return NextResponse.json(
        { error: 'Invalid question ID -- must be a valid UUID' },
        { status: 400 },
      );
    }

    const { error } = await supabase
      .from('bid_questions')
      .delete()
      .eq('id', qId)
      .eq('project_id', id);

    if (error) {
      console.error('Failed to delete bid question:', error);
      return NextResponse.json(
        { error: 'Failed to delete bid question' },
        { status: 500 },
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to delete bid question') },
      { status: 500 },
    );
  }
}
