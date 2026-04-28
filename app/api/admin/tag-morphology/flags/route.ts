/**
 * Tag morphology drift flags — list + bulk insert
 *
 * GET  /api/admin/tag-morphology/flags?decision=pending&limit=...&offset=...
 * POST /api/admin/tag-morphology/flags
 *
 * Admin/editor only. Backed by the `tag_morphology_drift_flags` table
 * (migration 20260424222432). The corpus regression eval populates this
 * queue; humans triage each flag via PATCH /[id].
 *
 * Spec: docs/specs/p1-tag-morphology-library-adoption-spec.md §3.5.4
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { sb, SupabaseError } from '@/lib/supabase/safe';
import { safeErrorMessage } from '@/lib/error';
import { parseBody, parseSearchParams } from '@/lib/validation';
import {
  TagMorphologyFlagsQuerySchema,
  TagMorphologyFlagsBulkInsertSchema,
} from '@/lib/validation/schemas';

// `tag_morphology_drift_flags` is a new table (migration 20260424222432)
// not yet present in the auto-generated database.types.ts. Per CLAUDE.md
// gotcha "Do not regen types mid-session", we use a typed local shim
// instead of running `supabase gen types`. The shim is removed once types
// are regenerated.
type DriftFlag = {
  id: string;
  stored_tag: string;
  proposed_canonical: string;
  usage_count: number;
  affected_content_ids: string[];
  detected_at: string;
  decision: 'pending' | 'accept' | 'add_override' | 'dismiss';
  decided_by: string | null;
  decided_at: string | null;
  decision_rationale: string | null;
};

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = auth.supabase as any;

    const parsed = parseSearchParams(
      TagMorphologyFlagsQuerySchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;
    const { decision, limit = 100, offset = 0 } = parsed.data;

    let query = supabase
      .from('tag_morphology_drift_flags')
      .select(
        'id, stored_tag, proposed_canonical, usage_count, affected_content_ids, detected_at, decision, decided_by, decided_at, decision_rationale',
        { count: 'exact' },
      )
      .order('usage_count', { ascending: false })
      .order('detected_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (decision) {
      query = query.eq('decision', decision);
    }

    // `sb()` extracts only `data`; this route also needs `count` (for paginated
    // total). We invoke the query once, throw `SupabaseError` on failure (same
    // error class `sb()` throws — see `lib/supabase/safe.ts`), and read both
    // `data` and `count` from the resolved response. POST below uses `sb()`
    // directly because it does not need `count`.
    const result = await query;
    if (result.error) {
      throw new SupabaseError(
        result.error,
        'tag_morphology_drift_flags.select',
      );
    }

    return NextResponse.json({
      flags: (result.data ?? []) as DriftFlag[],
      total: result.count ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to list tag morphology flags') },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = auth.supabase as any;

    const raw = await request.json();
    const parsed = parseBody(TagMorphologyFlagsBulkInsertSchema, raw);
    if (!parsed.success) return parsed.response;
    const { flags } = parsed.data;

    // Upsert on (stored_tag, proposed_canonical) — re-runs of the eval refresh
    // usage_count + affected_content_ids without resetting an existing decision.
    const inserted = (await sb(
      supabase
        .from('tag_morphology_drift_flags')
        .upsert(
          flags.map((f) => ({
            stored_tag: f.stored_tag,
            proposed_canonical: f.proposed_canonical,
            usage_count: f.usage_count,
            affected_content_ids: f.affected_content_ids,
          })),
          {
            onConflict: 'stored_tag,proposed_canonical',
            ignoreDuplicates: false,
          },
        )
        .select('id'),
      'tag_morphology_drift_flags.upsert',
    )) as { id: string }[];

    return NextResponse.json({
      inserted: inserted.length,
      total: flags.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to insert tag morphology flags') },
      { status: 500 },
    );
  }
}
