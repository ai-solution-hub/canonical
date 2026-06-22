// app/api/intelligence/profiles/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { CompanyProfileUpdateSchema } from '@/lib/validation/schemas';

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/intelligence/profiles/:id — get a single company profile */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { data, error } = await supabase
      .from('company_profiles')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch profile') },
      { status: 500 },
    );
  }
}

/** PATCH /api/intelligence/profiles/:id — update a company profile */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const raw = await request.json();
    const parsed = parseBody(CompanyProfileUpdateSchema, raw);
    if (!parsed.success) return parsed.response;

    // Invalidate cached company embedding when profile data changes
    // The pipeline will regenerate it on the next run
    const updateData = {
      ...parsed.data,
      company_embedding: null,
    };

    const { data, error } = await supabase
      .from('company_profiles')
      .update(updateData)
      .eq('id', id)
      .eq('is_active', true)
      .select()
      .single();

    if (error || !data) {
      if (error?.code === '23505') {
        return NextResponse.json(
          { error: 'A profile with this slug already exists' },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update profile') },
      { status: 500 },
    );
  }
}

/** DELETE /api/intelligence/profiles/:id — soft-delete a company profile (admin only) */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { data, error } = await supabase
      .from('company_profiles')
      .update({ is_active: false })
      .eq('id', id)
      .eq('is_active', true)
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to delete profile') },
      { status: 500 },
    );
  }
}
