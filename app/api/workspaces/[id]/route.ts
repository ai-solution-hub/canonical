import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseBody, parseSearchParams } from '@/lib/validation';
import {
  WorkspaceDeleteParamsSchema,
  WorkspaceUpdateBodySchema,
} from '@/lib/validation/schemas';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update'];

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PATCH = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      const { id } = await params;
      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid workspace ID — must be a valid UUID' },
          { status: 400 },
        );
      }

      const raw = await request.json();
      const parsed = parseBody(WorkspaceUpdateBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const updates: WorkspaceUpdate = {
        ...parsed.data,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      };

      const { data, error } = await supabase
        .from('workspaces')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          return NextResponse.json(
            { error: 'A workspace with that name already exists' },
            { status: 409 },
          );
        }
        logger.error({ err: error }, 'Failed to update workspace');
        return NextResponse.json(
          { error: 'Failed to update workspace' },
          { status: 500 },
        );
      }

      if (!data) {
        return NextResponse.json(
          { error: 'Workspace not found' },
          { status: 404 },
        );
      }

      return NextResponse.json(data);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to update workspace') },
        { status: 500 },
      );
    }
  },
);

export const DELETE = defineRoute(
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
          { error: 'Invalid workspace ID — must be a valid UUID' },
          { status: 400 },
        );
      }

      const parsed = parseSearchParams(
        WorkspaceDeleteParamsSchema,
        request.nextUrl.searchParams,
      );
      if (!parsed.success) return parsed.response;
      const permanent = parsed.data.permanent === true;

      if (permanent) {
        // The "assigned items" pre-delete guard is RETIRED (ID-131.19, M6,
        // S450 GO tail) — its check (content_item_workspaces) was dropped;
        // the S440 owner ruling accepted this breakage and the rebind to the
        // new workspace-membership model is owned by {135.22}.

        // Hard delete
        const { error } = await supabase
          .from('workspaces')
          .delete()
          .eq('id', id);

        if (error) {
          logger.error({ err: error }, 'Failed to delete workspace');
          return NextResponse.json(
            { error: 'Failed to delete workspace' },
            { status: 500 },
          );
        }

        return NextResponse.json({ success: true });
      }

      // Soft delete (archive)
      const { data: archived, error } = await supabase
        .from('workspaces')
        .update({ is_archived: true, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('id')
        .single();

      if (error || !archived) {
        if (!archived && !error) {
          return NextResponse.json(
            { error: 'Workspace not found' },
            { status: 404 },
          );
        }
        logger.error({ err: error }, 'Failed to archive workspace');
        return NextResponse.json(
          { error: 'Failed to archive workspace' },
          { status: 500 },
        );
      }

      return NextResponse.json({ success: true });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to delete workspace') },
        { status: 500 },
      );
    }
  },
);
