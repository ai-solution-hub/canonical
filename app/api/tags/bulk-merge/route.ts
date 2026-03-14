import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { TagBulkMergeBodySchema } from '@/lib/validation/schemas';

export const maxDuration = 30;

/**
 * POST /api/tags/bulk-merge — merges multiple source tags into one target.
 * Auth: admin only.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { allowed } = checkRateLimit(`tags:bulk-merge:${user.id}`, 5, 60_000);
    if (!allowed) return rateLimitResponse();

    const raw = await request.json();
    const parsed = parseBody(TagBulkMergeBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { sources, target, type } = parsed.data;

    // Validate that target is not in sources
    if (sources.includes(target)) {
      return NextResponse.json(
        { error: 'Target tag must not be one of the source tags' },
        { status: 400 },
      );
    }

    const { data, error } = await supabase.rpc('bulk_merge_tags', {
      p_sources: sources,
      p_target: target,
      p_type: type,
    });

    if (error) {
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to bulk merge tags') },
        { status: 500 },
      );
    }

    return NextResponse.json({ affected: data ?? 0 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to bulk merge tags') },
      { status: 500 },
    );
  }
}
