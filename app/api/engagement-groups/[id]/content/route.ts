// app/api/engagement-groups/[id]/content/route.ts
//
// ID-145 {145.35} — group-side batch assign (BI-33 owner ruling, S479):
// links a BATCH of q_a_pairs onto ONE engagement group via the additive
// `engagement_group_content` M:N link table (schema shape (b) from the
// {145.35} design pass — supabase/migrations/20260716130000_id145_35_
// engagement_group_content.sql, authored-only, not yet pushed). Does NOT
// touch `q_a_pairs.source_form_instance_id` (a provenance/lineage field,
// {145.23}) — assigning content to a group is a LINK, never a re-point.
//
// Replaces the retired PATCH /api/q-a-pairs/[id]/workspace as the target of
// the browse/library bulk "Assign to workspace" action
// (components/browse/bulk-action-toolbar.tsx + hooks/use-library-bulk-actions.ts,
// rewired in this same Subtask to POST here instead) — that route 410s
// unconditionally and STAYS retired (q_a_pairs.source_workspace_id was
// dropped system-wide with no replacement, W1c, {145.23}).
//
// Idempotent: `.upsert(rows, { onConflict: 'engagement_group_id,q_a_pair_id',
// ignoreDuplicates: true })` against the migration's
// UNIQUE(engagement_group_id, q_a_pair_id) — re-posting an already-linked
// pair is a silent no-op, not a duplicate row / 409.
//
// Auth: admin/editor only, matching the engagement_group_content_insert RLS
// policy (get_user_role() IN ('admin','editor')) — the route-level check
// gives a friendly 403 rather than relying on RLS to silently 0-row the
// write.
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import type {
  EngagementGroupContentInsert,
  InterimTableClient,
} from '@/types/engagement-group-content';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

type RouteContext = { params: Promise<{ id: string }> };

const AssignContentBodySchema = z.object({
  q_a_pair_ids: z.array(z.string().uuid()).min(1).max(500),
});

const AssignContentResponseSchema = z.object({
  success: z.literal(true),
  linked: z.number(),
});

export const POST = defineRoute(
  AssignContentResponseSchema,
  async (request: NextRequest, context: RouteContext) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id: engagementGroupId } = await context.params;

      const raw = await request.json();
      const parsed = parseBody(AssignContentBodySchema, raw);
      if (!parsed.success) return parsed.response;
      const { q_a_pair_ids } = parsed.data;

      const groupLookup = await supabase
        .from('engagement_groups')
        .select('id')
        .eq('id', engagementGroupId)
        .maybeSingle();

      if (groupLookup.error) {
        return NextResponse.json(
          {
            error: safeErrorMessage(
              groupLookup.error,
              'Failed to look up the engagement group',
            ),
          },
          { status: 500 },
        );
      }
      if (!groupLookup.data) {
        return NextResponse.json(
          { error: 'Engagement group not found' },
          { status: 404 },
        );
      }

      const rows: EngagementGroupContentInsert[] = q_a_pair_ids.map(
        (qAPairId) => ({
          engagement_group_id: engagementGroupId,
          q_a_pair_id: qAPairId,
        }),
      );

      // `engagement_group_content` is authored-only (migration not yet
      // pushed) — no entry in database.types.ts yet. Cast to the minimal
      // `.from(): any` shape (mirrors the {145.34} `promotion_dispositions`
      // INTERIM precedent, lib/q-a-pairs/promotion-candidate-review.ts).
      const interimClient = supabase as unknown as InterimTableClient;
      const insertResult = await interimClient
        .from('engagement_group_content')
        .upsert(rows, {
          onConflict: 'engagement_group_id,q_a_pair_id',
          ignoreDuplicates: true,
        });

      if (insertResult.error) {
        const code = (insertResult.error as { code?: string }).code;
        if (code === '23503') {
          return NextResponse.json(
            { error: 'One or more selected items no longer exist' },
            { status: 404 },
          );
        }
        return NextResponse.json(
          {
            error: safeErrorMessage(
              insertResult.error,
              'Failed to assign content to the engagement group',
            ),
          },
          { status: 500 },
        );
      }

      return NextResponse.json({ success: true, linked: q_a_pair_ids.length });
    } catch (err) {
      return NextResponse.json(
        {
          error: safeErrorMessage(
            err,
            'Failed to assign content to the engagement group',
          ),
        },
        { status: 500 },
      );
    }
  },
);
