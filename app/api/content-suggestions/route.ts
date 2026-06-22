import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth/client';
import { generateContentSuggestions } from '@/lib/content/content-suggestions';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { ContentSuggestionsParamsSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// TODO(OPS-T1): author ResponseSchema
export const GET = defineRoute(z.unknown(), async (request: NextRequest) => {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const parsed = parseSearchParams(
      ContentSuggestionsParamsSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;
    const { limit, domain } = parsed.data;

    const suggestions = await generateContentSuggestions({
      supabase,
      maxSuggestions: limit,
      domainFilter: domain,
      includeTemplateGaps: true,
    });

    return NextResponse.json(suggestions);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Content suggestions failed') },
      { status: 500 },
    );
  }
});
