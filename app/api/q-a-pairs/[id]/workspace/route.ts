// app/api/q-a-pairs/[id]/workspace/route.ts
//
// RETIRED — ID-145 {145.23} round-2 (mandatory extra #4; mirrors the
// {145.19} `app/api/procurement/[id]/forms/route.ts` retirement precedent).
//
// This route existed solely to PATCH `q_a_pairs.source_workspace_id` (a
// nullable FK straight to `workspaces`) — the post-M6 workspace-membership
// grain for a Q&A pair, per the ID-135 {135.22}/{135.25} header this file
// used to carry. W1c (`20260712062000_id145_w1c_rename_reshape.sql`)
// DROPPED that column outright: TECH.md §6's migration table reads
// `q_a_pairs`: RENAME source_form_template_id -> source_form_instance_id;
// DROP COLUMN source_workspace_id (data moved in M1)` — the ONE-TIME M1
// lineage migration moved existing rows' workspace ancestry onto
// `source_form_instance_id` (a PROVENANCE/lineage field — "which form this
// pair was extracted from" — never a live "assign to any workspace"
// target), then M3 dropped the column with NO replacement. Confirmed
// empirically: `information_schema.columns` has zero rows for
// `q_a_pairs.source_workspace_id` on staging (rbwqewalexrzgxtvcqrh).
//
// This is genuinely workspace-lineage-only (unlike a re-keyable
// `workspace_id` -> `form_instance_id` rename elsewhere in this dispatch):
// there is no column left to write, and repurposing `source_form_instance_id`
// (a one-time provenance snapshot) as a mutable "assign this pair to any
// workspace the user picks" target would be a new product decision, not a
// mechanical re-key. Per DR-075 §6 posture (route disposition table), routes
// whose backing container is gone with no replacement RETIRE (410) rather
// than re-shape.
//
// PATCH ALWAYS returns 410 Gone — no auth check, no Supabase read/write.
//
// KNOWN LIVE CALLER (flagged for product/Curator triage — NOT dead code,
// unlike the {145.19} forms-route precedent's caller): the browse/library
// page's "Assign to workspace" bulk action
// (`components/browse/bulk-action-toolbar.tsx`,
// `hooks/use-library-bulk-actions.ts`, restored by {135.22}/{135.25}) PATCHes
// this exact route. Retiring the route means that live UI affordance will
// now surface a 410 on every use. Out of this Subtask's file-ownership
// boundary (route-family tsc fix, not UI) — reported as an out-of-scope
// finding for the Curator: either retire the "Assign to workspace" bulk
// action from the UI (workspace lineage is retired system-wide for
// q_a_pairs), or a product decision defines a new semantic for it.
import { defineRoute } from '@/lib/api/define-route';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

type RouteContext = { params: Promise<{ id: string }> };

const RETIRED_BODY = {
  error:
    'This endpoint is retired (ID-145 form-first re-key, {145.23} round-2) — q_a_pairs.source_workspace_id was dropped with no replacement (W1c); workspace lineage for Q&A pairs is retired system-wide in v1.',
} as const;

export const PATCH = defineRoute(
  z.unknown(),
  async (_request: NextRequest, _context: RouteContext) => {
    return NextResponse.json(RETIRED_BODY, { status: 410 });
  },
);
