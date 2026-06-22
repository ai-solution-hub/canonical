import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { enqueueTaxonomySync } from '@/lib/taxonomy/sync-trigger';
import { parseBody } from '@/lib/validation';
import { TaxonomySubtopicUpdateSchema } from '@/lib/validation/schemas';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

type TaxonomySubtopicUpdate =
  Database['public']['Tables']['taxonomy_subtopics']['Update'];

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// TODO(OPS-T1): author ResponseSchema
export const PATCH = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin']);
      if (!auth.success) return authFailureResponse(auth);
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

      const updates: TaxonomySubtopicUpdate = {};
      if (parsed.data.name !== undefined) updates.name = parsed.data.name;
      if (parsed.data.display_order !== undefined)
        updates.display_order = parsed.data.display_order;
      if (parsed.data.is_active !== undefined)
        updates.is_active = parsed.data.is_active;
      if (parsed.data.accepted_at !== undefined)
        updates.accepted_at = parsed.data.accepted_at;
      if (parsed.data.description !== undefined)
        updates.description = parsed.data.description;

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
        .select(
          'id, domain_id, name, display_order, is_active, provenance, description',
        )
        .single();

      if (error) {
        // Check for unique constraint violation
        if (error.code === '23505') {
          return NextResponse.json(
            {
              error: `A subtopic named '${parsed.data.name}' already exists in this domain`,
            },
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

      enqueueTaxonomySync();
      return NextResponse.json(data);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to update subtopic') },
        { status: 500 },
      );
    }
  },
);
