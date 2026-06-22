// app/api/intelligence/profiles/[id]/route.ts
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import {
  CompanyProfileSchema,
  CompanyProfileUpdateSchema,
} from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

export const GET = defineRoute(
  CompanyProfileSchema,
  async (_request: NextRequest, context: RouteContext) => {
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
        return NextResponse.json(
          { error: 'Profile not found' },
          { status: 404 },
        );
      }

      return NextResponse.json(data);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch profile') },
        { status: 500 },
      );
    }
  },
);

export const PATCH = defineRoute(
  CompanyProfileSchema,
  async (request: NextRequest, context: RouteContext) => {
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
        return NextResponse.json(
          { error: 'Profile not found' },
          { status: 404 },
        );
      }

      return NextResponse.json(data);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to update profile') },
        { status: 500 },
      );
    }
  },
);

export const DELETE = defineRoute(
  CompanyProfileSchema,
  async (_request: NextRequest, context: RouteContext) => {
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
        return NextResponse.json(
          { error: 'Profile not found' },
          { status: 404 },
        );
      }

      return NextResponse.json({ success: true });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to delete profile') },
        { status: 500 },
      );
    }
  },
);
