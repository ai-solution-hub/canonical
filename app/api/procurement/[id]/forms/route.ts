import { defineRoute } from '@/lib/api/define-route';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

/**
 * RETIRED — ID-145 {145.19} groups A+C (DR-075 §6 ruling, ratified S474).
 *
 * This route used to mint/re-type a SIBLING form inside the
 * workspace-holds-many-forms container (`form_templates.workspace_id`,
 * dropped W1c STEP 1). That container is exactly what ID-145 BI-1/BI-4
 * retires — the item IS the form, with no separate umbrella. TECH.md §6's
 * per-route ruling table names this route's disposition explicitly:
 * "re-shape 'add-a-sibling-form' to `engagement_group_id`-keyed, or retire if
 * sibling *creation* is not v1" — PRODUCT §A3 settles that: engagement
 * grouping is a READ-ONLY lineage rail (PSQ -> ITT -> tender), never a
 * container a form is minted "into" or re-typed "inside". Sibling-form
 * creation/type-override is therefore NOT a v1 affordance, so both handlers
 * RETIRE (410 Gone) rather than re-shape onto `engagement_group_id`.
 *
 * The sole caller, `components/procurement/procurement-forms-card.tsx`, is
 * already dead code — unreferenced by `app/procurement/[id]/page.tsx` since
 * {145.18} removed it from the render tree (S470 journal). That component's
 * own removal is the {145.19} UI-half's file-ownership boundary, not this
 * (API-only) Subtask's.
 */
const RETIRED_BODY = {
  error:
    'This endpoint is retired (ID-145 form-first re-key, DR-075 §6) — the workspace-holds-many-forms container no longer exists. Engagement grouping is read-only lineage only in v1 (PRODUCT §A3); update the item itself via PATCH /api/procurement/[id].',
} as const;

export const POST = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    _context: { params: Promise<{ id: string }> },
  ) => {
    return NextResponse.json(RETIRED_BODY, { status: 410 });
  },
);

export const PATCH = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    _context: { params: Promise<{ id: string }> },
  ) => {
    return NextResponse.json(RETIRED_BODY, { status: 410 });
  },
);
