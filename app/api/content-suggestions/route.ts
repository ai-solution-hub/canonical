import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { generateContentSuggestions } from '@/lib/content-suggestions';
import { safeErrorMessage } from '@/lib/error';

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const limit = parseInt(
      request.nextUrl.searchParams.get('limit') ?? '5',
      10,
    );
    const domain = request.nextUrl.searchParams.get('domain') || undefined;

    const suggestions = await generateContentSuggestions({
      supabase,
      maxSuggestions: Math.min(Math.max(limit, 1), 20),
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
