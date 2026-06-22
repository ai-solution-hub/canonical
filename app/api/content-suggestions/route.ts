import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth/client';
import { generateContentSuggestions } from '@/lib/content/content-suggestions';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { ContentSuggestionsParamsSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// Mirrors the ContentSuggestion interface from @/lib/content/content-suggestions.
const ContentSuggestionsResponseSchema = z.array(
  z.object({
    id: z.string(),
    suggestion_type: z.enum([
      'empty_subtopic',
      'thin_coverage',
      'stale_only',
      'template_gap',
      'missing_layer',
    ]),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    domain: z.string(),
    subtopic: z.string(),
    title: z.string(),
    description: z.string(),
    suggested_content_type: z.string().optional(),
    suggested_layer: z.string().optional(),
    related_template: z.string().optional(),
    item_count: z.number(),
    freshness_breakdown: z
      .object({
        fresh: z.number(),
        aging: z.number(),
        stale: z.number(),
        expired: z.number(),
      })
      .optional(),
  }),
);

export const GET = defineRoute(
  ContentSuggestionsResponseSchema,
  async (request: NextRequest) => {
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
  },
);
