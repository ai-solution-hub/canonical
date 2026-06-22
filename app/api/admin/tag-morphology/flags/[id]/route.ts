/**
 * Tag morphology drift flag — disposition.
 *
 * PATCH /api/admin/tag-morphology/flags/[id]
 *
 * Body: { decision: 'accept' | 'add_override' | 'dismiss', decision_rationale?: string }
 *
 * Admin/editor only. Records the disposition + decided_by + decided_at on
 * the flag row. Does NOT execute the backfill — that is performed
 * separately by `scripts/apply-tag-morphology-backfill.ts` against
 * accepted flag IDs.
 *
 * Spec: docs/specs/p1-tag-morphology-library-adoption-spec.md §3.5.4
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';
import { sb } from '@/lib/supabase/safe';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { TagMorphologyFlagDecisionSchema } from '@/lib/validation/schemas';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user } = auth;
    // tag_morphology_drift_flags is not yet present in database.types.ts —
    // see CLAUDE.md "Do not regen types mid-session" gotcha.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = auth.supabase as any;

    const raw = await request.json();
    const parsed = parseBody(TagMorphologyFlagDecisionSchema, raw);
    if (!parsed.success) return parsed.response;
    const { decision, decision_rationale } = parsed.data;

    const updated = await sb(
      supabase
        .from('tag_morphology_drift_flags')
        .update({
          decision,
          decision_rationale: decision_rationale ?? null,
          decided_by: user.id,
          decided_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select(
          'id, stored_tag, proposed_canonical, decision, decision_rationale, decided_by, decided_at',
        )
        .single(),
      'tag_morphology_drift_flags.update',
    );

    return NextResponse.json({ flag: updated });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update tag morphology flag') },
      { status: 500 },
    );
  }
}
