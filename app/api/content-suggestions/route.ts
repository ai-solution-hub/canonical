import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, authFailureResponse } from '@/lib/auth';
import { generateContentSuggestions } from '@/lib/content/content-suggestions';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { ContentSuggestionsParamsSchema } from '@/lib/validation/schemas';

export const maxDuration = 30;

export async function GET(request: NextRequest) {
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
}
