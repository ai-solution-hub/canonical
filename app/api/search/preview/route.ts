import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  rateLimitResponse,
  authFailureResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { sb } from '@/lib/supabase/safe';
import { PREVIEW_MAX_RESULTS } from '@/lib/search-history';

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

    // Validate query param
    const q = request.nextUrl.searchParams.get('q')?.trim();
    if (!q) {
      return NextResponse.json(
        { error: 'Query parameter "q" is required' },
        { status: 400 },
      );
    }

    // Parse and clamp limit
    const rawLimit = request.nextUrl.searchParams.get('limit');
    let limit = PREVIEW_MAX_RESULTS;
    if (rawLimit !== null) {
      const parsed = parseInt(rawLimit, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        limit = Math.min(parsed, 20);
      }
    }

    // Escape ilike wildcards
    const escaped = escapeIlike(q);

    // Query content_items with ilike on title + content
    // Select layer for potential Phase 3 use, but exclude from response
    const results = await sb(
      supabase
        .from('content_items')
        .select('id, title, content_type, primary_domain, layer')
        .or(`title.ilike.%${escaped}%,content.ilike.%${escaped}%`)
        .limit(limit),
      'content_items.preview',
    );

    const items = results ?? [];

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
        layer?: string;
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
