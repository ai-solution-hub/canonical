// app/api/engagement-groups/route.ts
//
// ID-145 {145.35} — GET lists engagement groups (BI-33 owner ruling, S479).
// Backs the browse/library bulk "Assign to engagement group" picker
// (components/browse/bulk-action-toolbar.tsx, hooks/use-library-bulk-actions.ts
// via handleBulkAssignOpen) — mirrors GET /api/workspaces' shape and auth
// posture: `getAuthenticatedClient()` only (no role gate), matching
// engagement_groups' `engagement_groups_select` RLS policy ("any
// authenticated member may read", W1c STEP 6,
// 20260712062000_id145_w1c_rename_reshape.sql).
//
// No POST here — engagement group CREATION is out of this Subtask's scope
// (the picker only lists EXISTING groups); the write path this Subtask adds
// is POST /api/engagement-groups/[id]/content (group-side batch assign).
//
// Schema routing (post-push integration fix, {145.35} follow-up):
// `engagement_groups` is INTERNAL_ONLY — deliberately absent from the `api`
// Data-API surface (`scripts/check-api-view-coverage.ts`
// `INTERNAL_ONLY_TABLES`). The standard authenticated client routes bare
// `.from()` calls to the `api` schema at runtime (`lib/supabase/schema.ts`
// `DB_OPTION`), where this table doesn't exist — PostgREST returns PGRST205
// (relation not found). `.schema('public')` below is the documented
// per-call override (`lib/supabase/schema.ts` module doc, INV-12); RLS
// still applies via the caller's JWT.
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const EngagementGroupListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
});
const GetEngagementGroupsResponseSchema = z.array(
  EngagementGroupListItemSchema,
);

export const GET = defineRoute(
  GetEngagementGroupsResponseSchema,
  async (_request: NextRequest) => {
    try {
      const auth = await getAuthenticatedClient();
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { data, error } = await supabase
        .schema('public')
        .from('engagement_groups')
        .select('id, name')
        .order('name');

      if (error) {
        logger.error({ err: error }, 'Failed to fetch engagement groups');
        return NextResponse.json(
          { error: 'Failed to fetch engagement groups' },
          { status: 500 },
        );
      }

      return NextResponse.json(data ?? []);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch engagement groups') },
        { status: 500 },
      );
    }
  },
);
