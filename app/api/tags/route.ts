import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  forbiddenResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { TagDeleteBodySchema } from '@/lib/validation/schemas';

/**
 * GET /api/tags — returns all tag counts (user_tags + ai_keywords).
 * Auth: any authenticated user.
 */
export async function GET() {
  try {
    const auth = await getAuthorisedClient();
    if (!auth) return forbiddenResponse();
    const { user, supabase } = auth;

    const { allowed } = checkRateLimit(`tags:list:${user.id}`, 30, 60_000);
    if (!allowed) return rateLimitResponse();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC added in migration, types not yet regenerated
    const { data, error } = await (supabase.rpc as any)('get_all_tag_counts');

    if (error) {
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to fetch tag counts') },
        { status: 500 },
      );
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch tag counts') },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/tags — removes a tag from all items.
 * Auth: admin only.
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth) return forbiddenResponse();
    const { user, supabase } = auth;

    const { allowed } = checkRateLimit(`tags:delete:${user.id}`, 10, 60_000);
    if (!allowed) return rateLimitResponse();

    const raw = await request.json();
    const parsed = parseBody(TagDeleteBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { tag, type } = parsed.data;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC added in migration, types not yet regenerated
    const { data, error } = await (supabase.rpc as any)('delete_tag', {
      p_tag: tag,
      p_type: type,
    });

    if (error) {
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to delete tag') },
        { status: 500 },
      );
    }

    return NextResponse.json({ affected: data ?? 0 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to delete tag') },
      { status: 500 },
    );
  }
}
