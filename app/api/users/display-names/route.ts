import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { resolveUserDisplayNames } from '@/lib/users/display-names';
import { parseBody } from '@/lib/validation';
import { DisplayNamesBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// TODO(OPS-T1): author ResponseSchema
export const POST = defineRoute(z.unknown(), async (request: NextRequest) => {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);

    const raw = await request.json().catch((_err) => null);
    if (raw === null) {
      return NextResponse.json(
        { error: 'Request body must be valid JSON with an `ids` array.' },
        { status: 400 },
      );
    }
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
});
