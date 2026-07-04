import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { enqueueTaxonomySync } from '@/lib/taxonomy/sync-trigger';
import { parseBody } from '@/lib/validation';
import { LayerUpdateSchema } from '@/lib/validation/schemas';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

type LayerVocabularyUpdate =
  Database['public']['Tables']['layer_vocabulary']['Update'];

export const maxDuration = 30;

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

      const raw = await request.json();
      const parsed = parseBody(LayerUpdateSchema, raw);
      if (!parsed.success) return parsed.response;

      const updates: LayerVocabularyUpdate = {};
      if (parsed.data.label !== undefined) updates.label = parsed.data.label;
      if (parsed.data.description !== undefined)
        updates.description = parsed.data.description;
      if (parsed.data.display_order !== undefined)
        updates.display_order = parsed.data.display_order;
      if (parsed.data.is_active !== undefined)
        updates.is_active = parsed.data.is_active;
      updates.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('layer_vocabulary')
        .update(updates)
        .eq('id', id)
        .select(
          'id, key, label, description, display_order, is_active, created_at, updated_at',
        )
        .single();

      if (error) {
        // PGRST116 = no rows found
        if (error.code === 'PGRST116') {
          return NextResponse.json(
            { error: 'Layer not found' },
            { status: 404 },
          );
        }
        return NextResponse.json(
          { error: safeErrorMessage(error, 'Failed to update layer') },
          { status: 500 },
        );
      }

      if (!data) {
        return NextResponse.json({ error: 'Layer not found' }, { status: 404 });
      }

      enqueueTaxonomySync();
      return NextResponse.json(data);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to update layer') },
        { status: 500 },
      );
    }
  },
);

export const DELETE = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;
      const { id } = await params;

      // First, look up the layer key
      const { data: layer, error: lookupError } = await supabase
        .from('layer_vocabulary')
        .select('key')
        .eq('id', id)
        .single();

      if (lookupError || !layer) {
        return NextResponse.json({ error: 'Layer not found' }, { status: 404 });
      }

      // ID-131 {131.19}: the content_items.layer usage-check is REMOVED here
      // — the `layer` column dies with the content_items table (M6); the IMS
      // layers surface itself is out of ID-131 scope (orchestrator-ruled).

      // Safe to delete
      const { error: deleteError } = await supabase
        .from('layer_vocabulary')
        .delete()
        .eq('id', id);

      if (deleteError) {
        return NextResponse.json(
          { error: safeErrorMessage(deleteError, 'Failed to delete layer') },
          { status: 500 },
        );
      }

      enqueueTaxonomySync();
      return new NextResponse(null, { status: 204 });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to delete layer') },
        { status: 500 },
      );
    }
  },
);
