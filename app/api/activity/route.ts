import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, forbiddenResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';

/**
 * Formats a quality flag details JSONB value into a human-readable string.
 *
 * The `details` column in `ingestion_quality_log` is JSONB. It may be:
 *  - null/undefined (no details)
 *  - a string (already serialised or double-serialised JSON)
 *  - an object with fields like `reason`, `confidence`, `remediation_source`
 *
 * Returns a concise summary or an empty string if nothing useful.
 */
function formatQualityDetails(
  details: unknown,
): string {
  if (details === null || details === undefined) return '';

  // If it's already a plain string, use it directly
  if (typeof details === 'string') {
    // It might be a double-serialised JSON string — try parsing it
    try {
      const parsed = JSON.parse(details);
      if (typeof parsed === 'object' && parsed !== null) {
        return formatQualityDetailsObject(parsed);
      }
      // Parsed to a primitive — just return the string
      return details;
    } catch {
      // Not JSON, just a plain string
      return details;
    }
  }

  if (typeof details === 'object') {
    return formatQualityDetailsObject(details as Record<string, unknown>);
  }

  return String(details);
}

/**
 * Formats a quality details object into a human-readable string.
 * Extracts known fields (reason, confidence) and presents them clearly.
 */
function formatQualityDetailsObject(
  obj: Record<string, unknown>,
): string {
  const parts: string[] = [];

  if (typeof obj.reason === 'string' && obj.reason) {
    parts.push(obj.reason);
  }

  if (typeof obj.confidence === 'number') {
    parts.push(`confidence ${Math.round(obj.confidence * 100)}%`);
  }

  // If we extracted known fields, return them
  if (parts.length > 0) return parts.join(' — ');

  // Fallback: enumerate key-value pairs for any unknown structure
  const entries = Object.entries(obj).filter(
    ([, v]) => v !== null && v !== undefined,
  );
  if (entries.length === 0) return '';

  return entries
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(', ');
}

/**
 * GET /api/activity
 *
 * Unified activity feed showing recent changes across the KB.
 * Admin-only. Combines version history, reviews, and quality events.
 *
 * Query params:
 *   - limit (default 30, max 100)
 *   - offset (default 0)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth) return forbiddenResponse();
    const { supabase } = auth;

    const url = new URL(request.url);
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get('limit') ?? '30', 10) || 30, 1),
      100,
    );
    const offset = Math.max(
      parseInt(url.searchParams.get('offset') ?? '0', 10) || 0,
      0,
    );

    // Fetch recent version history entries (edits, rollbacks)
    const { data: historyData, error: historyError } = await supabase
      .from('content_history')
      .select(
        'id, content_item_id, version, change_summary, change_type, created_by, created_at',
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (historyError) {
      console.error('Failed to fetch activity history:', historyError);
      return NextResponse.json(
        { error: 'Failed to fetch activity feed' },
        { status: 500 },
      );
    }

    // Map history entries to activity items
    const activities = (historyData ?? []).map((entry) => ({
      id: entry.id,
      type: entry.change_type === 'rollback' ? 'rollback' : 'edit',
      entity_type: 'content_item',
      entity_id: entry.content_item_id,
      summary: entry.change_summary ?? `Version ${entry.version}`,
      user_id: entry.created_by,
      created_at: entry.created_at,
      metadata: {
        version: entry.version,
        change_type: entry.change_type,
      },
    }));

    // Also fetch recent quality flags
    const { data: qualityData } = await supabase
      .from('ingestion_quality_log')
      .select('id, content_item_id, flag_type, severity, details, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const qualityActivities = (qualityData ?? []).map((entry) => ({
      id: entry.id,
      type: 'quality_flag',
      entity_type: 'content_item',
      entity_id: entry.content_item_id,
      summary: `${entry.severity}: ${entry.flag_type}${entry.details ? ` — ${formatQualityDetails(entry.details)}` : ''}`,
      user_id: null,
      created_at: entry.created_at,
      metadata: {
        flag_type: entry.flag_type,
        severity: entry.severity,
      },
    }));

    // Merge and sort by date, take the limit
    const merged = [...activities, ...qualityActivities]
      .sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      })
      .slice(0, limit);

    return NextResponse.json({
      activities: merged,
      limit,
      offset,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch activity feed') },
      { status: 500 },
    );
  }
}
