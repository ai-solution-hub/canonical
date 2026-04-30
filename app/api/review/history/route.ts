import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { ReviewHistoryParamsSchema } from '@/lib/validation/schemas';
import { logger } from '@/lib/logger';

export const maxDuration = 30;

/**
 * Review history entry returned by the API.
 *
 * Reviewer names are populated from `user_roles.display_name` via a
 * separate lookup after the main query (PostgREST cannot join the same
 * table twice with different FK aliases).
 */
export interface ReviewHistoryEntry {
  id: string;
  flag_type: string;
  severity: string;
  details: { notes?: string; reason?: string } | null;
  resolution_notes: string | null;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
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

    const parsed = parseSearchParams(
      ReviewHistoryParamsSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;
    const { item_id: itemId } = parsed.data;

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

    // Collect unique user IDs referenced in the history rows
    const userIds = new Set<string>();
    for (const row of data ?? []) {
      if (row.created_by) userIds.add(row.created_by);
      if (row.resolved_by) userIds.add(row.resolved_by);
    }

    // Look up display names from user_roles (single query)
    const displayNames: Record<string, string> = {};
    if (userIds.size > 0) {
      const { data: nameRows, error: nameRowsError } = await supabase
        .from('user_roles')
        .select('user_id, display_name')
        .in('user_id', Array.from(userIds));

      if (nameRowsError) {
        // Cosmetic enrichment — log and fall through to raw UUIDs.
        logger.error(
          { err: nameRowsError },
          'Failed to fetch display names for review history',
        );
      }

      if (nameRows) {
        for (const row of nameRows) {
          if (row.display_name) {
            displayNames[row.user_id] = row.display_name;
          }
        }
      }
    }

    const history: ReviewHistoryEntry[] = (data ?? []).map((row) => ({
      id: row.id,
      flag_type: row.flag_type,
      severity: row.severity,
      details: row.details as ReviewHistoryEntry['details'],
      resolution_notes: row.resolution_notes,
      created_at: row.created_at ?? '',
      created_by: row.created_by,
      created_by_name: row.created_by
        ? (displayNames[row.created_by] ?? null)
        : null,
      resolved: row.resolved ?? false,
      resolved_at: row.resolved_at,
      resolved_by: row.resolved_by,
      resolved_by_name: row.resolved_by
        ? (displayNames[row.resolved_by] ?? null)
        : null,
    }));

    return NextResponse.json({ history });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch review history') },
      { status: 500 },
    );
  }
}
