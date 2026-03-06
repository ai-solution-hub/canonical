import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  forbiddenResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { TagRenameBodySchema } from '@/lib/validation/schemas';

/**
 * POST /api/tags/rename — renames a tag across all items atomically.
 * Auth: admin only.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth) return forbiddenResponse();
    const { user, supabase } = auth;

    const { allowed } = checkRateLimit(`tags:rename:${user.id}`, 10, 60_000);
    if (!allowed) return rateLimitResponse();

    const raw = await request.json();
    const parsed = parseBody(TagRenameBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { old: oldTag, new: newTag, type } = parsed.data;

    if (oldTag === newTag) {
      return NextResponse.json(
        { error: 'Old and new tag names must be different' },
        { status: 400 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC added in migration, types not yet regenerated
    const { data, error } = await (supabase.rpc as any)('rename_tag', {
      p_old: oldTag,
      p_new: newTag,
      p_type: type,
    });

    if (error) {
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to rename tag') },
        { status: 500 },
      );
    }

    return NextResponse.json({ affected: data ?? 0 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to rename tag') },
      { status: 500 },
    );
  }
}
