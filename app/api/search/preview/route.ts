import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getAuthenticatedClient,
  rateLimitResponse,
  authFailureResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { sb } from '@/lib/supabase/safe';
import { PREVIEW_MAX_RESULTS } from '@/lib/search-history';
import { parseSearchParams } from '@/lib/validation';

const PreviewSearchSchema = z.object({
  q: z.string().trim().min(1),
  // Accept any positive int; clamp to max 20 server-side rather than reject
  // so accidental over-fetch just gets trimmed (spec §4.1 "max 20 clamp").
  limit: z.number().int().positive().optional(),
});

/**
 * Escape characters that are PostgREST ilike wildcards.
 * `%` matches any sequence, `_` matches any single char, `\` is the escape
 * char itself. Each must be backslash-escaped before interpolation into
 * the `%<q>%` pattern.
 */
export function escapeIlike(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    // Auth check — viewer+ permitted
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    // Rate limit: 60 requests per minute
    const rl = checkRateLimit(`search-preview:${user.id}`, 60, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    // Validate query params via shared Zod helper
    const parsed = parseSearchParams(
      PreviewSearchSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;
    const { q, limit: requestedLimit } = parsed.data;
    const limit = Math.min(requestedLimit ?? PREVIEW_MAX_RESULTS, 20);

    // Escape ilike wildcards
    const escaped = escapeIlike(q);

    // Query content_items with ilike on title + content.
    // `layer` is selected for potential Phase 3 use but stripped from the response.
    // `sb()` throws on any Postgres error, so `items` is always the array on success.
    const items = await sb(
      supabase
        .from('content_items')
        .select('id, title, content_type, primary_domain, layer')
        .or(`title.ilike.%${escaped}%,content.ilike.%${escaped}%`)
        .limit(limit),
      'content_items.preview',
    );

    // Sort: title matches first, then content-only matches
    const lowerQ = q.toLowerCase();
    const sorted = [...items].sort((a, b) => {
      const aTitle = (a.title ?? '').toLowerCase().includes(lowerQ);
      const bTitle = (b.title ?? '').toLowerCase().includes(lowerQ);
      if (aTitle && !bTitle) return -1;
      if (!aTitle && bTitle) return 1;
      return 0;
    });

    // Map to response shape — exclude `layer` per spec §4.1
    const mapped = sorted.map(
      (item: {
        id: string;
        title: string;
        content_type: string;
        primary_domain: string | null;
        layer: string | null;
      }) => ({
        id: item.id,
        title: item.title,
        content_type: item.content_type,
        primary_domain: item.primary_domain,
      }),
    );

    return NextResponse.json({
      results: mapped,
      count: mapped.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Preview search failed') },
      { status: 500 },
    );
  }
}
