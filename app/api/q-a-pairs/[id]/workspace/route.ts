// app/api/q-a-pairs/[id]/workspace/route.ts
//
// ID-135 {135.22} S449 addendum — Assign-to-Workspace rehome.
//
// The pre-M6 `/library` Assign-to-Workspace bulk action posted to the
// {131.17}-deleted `/api/items/[id]/workspaces` route, which wrote the
// dropped `content_item_workspaces` junction table. That table is GONE
// (M6) and no junction table replaces it — the post-M6 workspace-membership
// grain for a Q&A pair is `q_a_pairs.source_workspace_id`, a nullable FK
// straight to `workspaces` (`ON DELETE SET NULL`; confirmed via schema
// query). A pair belongs to at most one workspace, not many, so a dedicated
// single-purpose PATCH leg — rather than folding this into the sidecar/
// edit-intent-heavy main `PATCH /api/q-a-pairs/[id]` — keeps the concerns
// separate and this affordance independently testable (S449 "add a
// real-route test" ask).
//
// Auth/route conventions mirror the sibling `app/api/workspaces/[id]/route.ts`
// PATCH: getAuthorisedClient() -> auth.success check -> authFailureResponse(auth),
// Zod BodySchema, Tables<'q_a_pairs'> types.
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseBody } from '@/lib/validation';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

type RouteContext = { params: Promise<{ id: string }> };
type QAPairsUpdate = Database['public']['Tables']['q_a_pairs']['Update'];

/** `null` unassigns the pair from any workspace. */
const AssignWorkspaceBodySchema = z.object({
  source_workspace_id: z
    .string()
    .uuid('source_workspace_id must be a valid UUID')
    .nullable(),
});

export const PATCH = defineRoute(
  z.unknown(),
  async (request: NextRequest, context: RouteContext) => {
    try {
      const { id } = await context.params;

      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const raw = await request.json().catch((_err) => null);
      const parsedResult = parseBody(AssignWorkspaceBodySchema, raw);
      if (!parsedResult.success) return parsedResult.response;
      const { source_workspace_id } = parsedResult.data;

      const updatePayload: QAPairsUpdate = {
        source_workspace_id,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('q_a_pairs')
        .update(updatePayload)
        .eq('id', id)
        .select('*')
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return NextResponse.json(
            { error: 'Q&A pair not found' },
            { status: 404 },
          );
        }
        logger.error({ err: error }, 'Failed to assign Q&A pair workspace');
        return NextResponse.json(
          { error: 'Failed to assign workspace' },
          { status: 500 },
        );
      }

      if (!data) {
        return NextResponse.json(
          { error: 'Q&A pair not found' },
          { status: 404 },
        );
      }

      return NextResponse.json({ q_a_pair: data });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to assign workspace') },
        { status: 500 },
      );
    }
  },
);
