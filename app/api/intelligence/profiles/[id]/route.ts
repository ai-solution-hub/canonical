// app/api/intelligence/profiles/[id]/route.ts
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { COMPANY_PROFILE_EMBEDDING_MODEL } from '@/lib/intelligence/pipeline';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import { parseBody } from '@/lib/validation';
import {
  CompanyProfileSchema,
  CompanyProfileUpdateSchema,
} from '@/lib/validation/schemas';
import type { RecordEmbeddingsOwnerKind } from '@/lib/validation/owner-kind';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

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

      const { data, error } = await supabase
        .from('company_profiles')
        .update(parsed.data)
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

      // ID-131 {131.11} G-SEARCH residual (Checker finding 1): invalidate the
      // cached company embedding so the pipeline regenerates it on the next
      // run. The cache moved to record_embeddings (owner_kind='company_profile')
      // — company_profiles.company_embedding is retired from the cache
      // contract (drops at M6/{131.19}). embedding is NULLABLE on
      // record_embeddings (M1b) and loadOrGenerateCompanyEmbedding treats a
      // null/missing embedding as a cache MISS, so an upsert with
      // embedding: null is the correct invalidation shape — it also stays
      // within the editor+admin INSERT/UPDATE RLS policies this route
      // already requires (a DELETE would need admin-only, which editors
      // calling this route do not have).
      const { error: invalidateError } = await supabase
        .from('record_embeddings')
        .upsert(
          {
            owner_kind: 'company_profile' satisfies RecordEmbeddingsOwnerKind,
            owner_id: id,
            model: COMPANY_PROFILE_EMBEDDING_MODEL,
            embedding: null,
          },
          { onConflict: 'owner_kind,owner_id,model' },
        );

      if (invalidateError) {
        // Best-effort: the profile update above already succeeded, so a
        // failed cache invalidation must not fail the request — worst case
        // is a stale pre-filter embedding until the next successful edit or
        // cache-miss cycle.
        logBestEffortWarn(
          'intelligence.profiles.embedding-cache.invalidate',
          'Failed to invalidate cached company embedding',
          { profileId: id, error: invalidateError.message },
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
  z.object({ success: z.boolean() }),
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
