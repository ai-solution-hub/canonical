import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  authFailureResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { DisplayNamesBodySchema } from '@/lib/validation/schemas';
import { resolveUserDisplayNames } from '@/lib/users/display-names';

export const maxDuration = 30;

/**
 * POST /api/users/display-names — resolve user UUIDs to display names.
 *
 * Accepts `{ ids: string[] }` and returns `{ [uuid]: displayName }`.
 * Available to all authenticated users.
 *
 * Strategy (S156 WP-2): single SQL round trip via the
 * `get_user_display_names` SECURITY DEFINER function. See
 * `lib/users/display-names.ts` for the wrapper and
 * `docs/specs/s156-auth-admin-resolution-spec.md` §WP-2 for the
 * incident context that motivated the refactor.
 *
 * Pipeline service account IDs resolve to the literal label
 * `'Pipeline (system)'`; unknown IDs resolve to `'A team member'`.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);

    const raw = await request.json();
    const parsed = parseBody(DisplayNamesBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const map = await resolveUserDisplayNames(auth.supabase, parsed.data.ids);

    // Preserve the existing response shape: `{ [uuid]: displayName }`
    const result: Record<string, string> = {};
    for (const [id, info] of map) {
      result[id] = info.display_name;
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to resolve display names') },
      { status: 500 },
    );
  }
}
