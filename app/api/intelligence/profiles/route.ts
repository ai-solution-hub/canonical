// app/api/intelligence/profiles/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { CompanyProfileCreateSchema } from '@/lib/validation/schemas';

/** GET /api/intelligence/profiles — list all active company profiles */
export async function GET() {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { data, error } = await supabase
      .from('company_profiles')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch profiles' }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch profiles') },
      { status: 500 },
    );
  }
}

/** POST /api/intelligence/profiles — create a company profile */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase, user } = auth;

    const raw = await request.json();
    const parsed = parseBody(CompanyProfileCreateSchema, raw);
    if (!parsed.success) return parsed.response;

    const { data, error } = await supabase
      .from('company_profiles')
      .insert({ ...parsed.data, created_by: user.id })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'A profile with this slug already exists' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create profile') },
      { status: 500 },
    );
  }
}
