// app/api/intelligence/profiles/route.ts
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import {
  CompanyProfileCreateSchema,
  CompanyProfileSchema,
} from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const GET = defineRoute(z.array(CompanyProfileSchema), async () => {
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
      return NextResponse.json(
        { error: 'Failed to fetch profiles' },
        { status: 500 },
      );
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch profiles') },
      { status: 500 },
    );
  }
});

export const POST = defineRoute(
  CompanyProfileSchema,
  async (request: NextRequest) => {
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
          return NextResponse.json(
            { error: 'A profile with this slug already exists' },
            { status: 409 },
          );
        }
        return NextResponse.json(
          { error: 'Failed to create profile' },
          { status: 500 },
        );
      }

      return NextResponse.json(data, { status: 201 });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to create profile') },
        { status: 500 },
      );
    }
  },
);
