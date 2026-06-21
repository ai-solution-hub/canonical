// app/api/pipeline-runs/[id]/route.ts
//
// GET single pipeline_runs row by id. Used by the Pattern E consumers
// (batch_reclassify, folder-drop) to poll for mid-flight progress.
// Auth: admin OR editor.
// Non-admins can only read rows they created (eq('created_by', user.id)),
// matching the list endpoint's filter at app/api/pipeline-runs/route.ts:46.
//
// 404 returned when:
//   - The row exists but the caller is not admin AND created_by != user.id
//     (treat as "not found" rather than 403 — pipeline_run_ids leak through
//     the response payload of `POST /api/ingest/markdown` so a 403 would
//     reveal that the id corresponds to *some other user's* run; 404 is
//     consistent with the non-existence response).
//   - The row genuinely doesn't exist (yet — caller is racing the at-start
//     INSERT in Pattern E; this is expected for the first ~sub-100ms after
//     the import mutation send).
//
// Spec: docs/specs/ep2-markdown-ui-ingest-spec.md §7.2 Pattern E.
// Plan: docs/plans/§1.11-ep2-build-plan.md EP2-T6 (e).

import { NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  type AuthorisedResult,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';

export const maxDuration = 15;

const SELECT_COLS =
  'id, pipeline_name, status, progress, source_filename, items_created, items_processed, workspace_id, error_message, started_at, completed_at, created_at, created_by, result';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth: AuthorisedResult = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) return authFailureResponse(auth);
  const { supabase, user, role } = auth;

  try {
    const { id } = await params;

    // Mirror the list-endpoint shape (app/api/pipeline-runs/route.ts:39).
    // Non-admins are constrained to their own rows via `created_by` —
    // matching the list endpoint's filter behaviour at line 46 there.
    let query = supabase.from('pipeline_runs').select(SELECT_COLS).eq('id', id);

    if (role !== 'admin') {
      query = query.eq('created_by', user.id);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to fetch pipeline run') },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch pipeline run') },
      { status: 500 },
    );
  }
}
