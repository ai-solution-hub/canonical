import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';

export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Review history entry returned by the API.
 *
 * Reviewer names: `created_by_name` and `resolved_by_name` are currently
 * always null because `user_roles.display_name` does not yet exist.
 * TODO: Once Workflows spec Phase 2.1 adds `user_roles.display_name`,
 * join against it here and populate the name fields.
 */
export interface ReviewHistoryEntry {
  id: string;
  flag_type: string;
  severity: string;
  details: { notes?: string; reason?: string } | null;
  resolution_notes: string | null;
  created_at: string;
  created_by: string | null;
  /** TODO: Populate from user_roles.display_name when column exists (Workflows spec Phase 2.1) */
  created_by_name: string | null;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  /** TODO: Populate from user_roles.display_name when column exists (Workflows spec Phase 2.1) */
  resolved_by_name: string | null;
}

/**
 * GET /api/review/history?item_id={uuid}
 *
 * Returns review history entries from `ingestion_quality_log` for a given
 * content item. Includes all quality flag types (not just review_needed).
 *
 * Auth: editors and admins only (matches review action endpoint).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { searchParams } = request.nextUrl;
    const itemId = searchParams.get('item_id');

    if (!itemId) {
      return NextResponse.json(
        { error: 'item_id query parameter is required' },
        { status: 400 },
      );
    }

    if (!UUID_RE.test(itemId)) {
      return NextResponse.json(
        { error: 'item_id must be a valid UUID' },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from('ingestion_quality_log')
      .select(
        'id, flag_type, severity, details, resolution_notes, created_at, created_by, resolved, resolved_at, resolved_by',
      )
      .eq('content_item_id', itemId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to fetch review history') },
        { status: 500 },
      );
    }

    // Map rows to ReviewHistoryEntry shape.
    // Reviewer display names are null until user_roles.display_name exists.
    const history: ReviewHistoryEntry[] = (data ?? []).map((row) => ({
      id: row.id,
      flag_type: row.flag_type,
      severity: row.severity,
      details: row.details as ReviewHistoryEntry['details'],
      resolution_notes: row.resolution_notes,
      created_at: row.created_at ?? '',
      created_by: row.created_by,
      created_by_name: null, // TODO: join user_roles.display_name (Workflows spec Phase 2.1)
      resolved: row.resolved ?? false,
      resolved_at: row.resolved_at,
      resolved_by: row.resolved_by,
      resolved_by_name: null, // TODO: join user_roles.display_name (Workflows spec Phase 2.1)
    }));

    return NextResponse.json({ history });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch review history') },
      { status: 500 },
    );
  }
}
