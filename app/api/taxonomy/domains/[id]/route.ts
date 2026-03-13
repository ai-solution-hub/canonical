import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { TaxonomyDomainUpdateSchema } from '@/lib/validation/schemas';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/taxonomy/domains/:id
 *
 * Update an existing domain. Admin-only.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { id } = await params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid domain ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    const raw = await request.json();
    const parsed = parseBody(TaxonomyDomainUpdateSchema, raw);
    if (!parsed.success) return parsed.response;

    const updates: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.colour !== undefined) updates.colour = parsed.data.colour;
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
      .from('taxonomy_domains')
      .update(updates)
      .eq('id', id)
      .select('id, name, display_order, colour, is_active')
      .single();

    if (error) {
      // Check for unique constraint violation
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `A domain named '${parsed.data.name}' already exists` },
          { status: 409 },
        );
      }
      // Check for not found (single() fails on 0 rows)
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Domain not found' },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { error: 'Failed to update domain' },
        { status: 500 },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update domain') },
      { status: 500 },
    );
  }
}
