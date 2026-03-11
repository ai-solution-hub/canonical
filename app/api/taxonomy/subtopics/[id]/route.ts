import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, forbiddenResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { TaxonomySubtopicUpdateSchema } from '@/lib/validation/schemas';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/taxonomy/subtopics/:id
 *
 * Update an existing subtopic. Admin-only.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth) return forbiddenResponse();
    const { supabase } = auth;

    const { id } = await params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid subtopic ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    const raw = await request.json();
    const parsed = parseBody(TaxonomySubtopicUpdateSchema, raw);
    if (!parsed.success) return parsed.response;

    const updates: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.display_order !== undefined) updates.display_order = parsed.data.display_order;
    if (parsed.data.is_active !== undefined) updates.is_active = parsed.data.is_active;
    if (parsed.data.accepted_at !== undefined) updates.accepted_at = parsed.data.accepted_at;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from('taxonomy_subtopics')
      .update(updates)
      .eq('id', id)
      .select('id, domain_id, name, display_order, is_active')
      .single();

    if (error) {
      // Check for unique constraint violation
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `A subtopic named '${parsed.data.name}' already exists in this domain` },
          { status: 409 },
        );
      }
      // Check for not found
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Subtopic not found' },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { error: 'Failed to update subtopic' },
        { status: 500 },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update subtopic') },
      { status: 500 },
    );
  }
}
