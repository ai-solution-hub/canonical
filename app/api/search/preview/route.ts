import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthenticatedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { PREVIEW_MAX_RESULTS } from '@/lib/search-history';
import { sb } from '@/lib/supabase/safe';
import { parseSearchParams } from '@/lib/validation';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

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

const PreviewSearchResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      title: z.string().nullable(),
      content_type: z.string().nullable(),
      primary_domain: z.string().nullable(),
    }),
  ),
  count: z.number(),
});

export const GET = defineRoute(
  PreviewSearchResponseSchema,
  async (request: NextRequest) => {
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

      // ID-131.11 G-SEARCH (AC12 / §9): typeahead preview over the typed
      // L-records substrate (content_items retired). ilike across
      // source_documents (filename/summary), q_a_pairs
      // (question_text/answer_standard), and reference_items (title/summary),
      // then merged. `sb()` throws on any Postgres error, so each result set is
      // the array on success.
      const [sourceDocs, qaPairs, refItems] = await Promise.all([
        sb(
          supabase
            .from('source_documents')
            .select('id, filename, suggested_title, primary_domain')
            .or(`filename.ilike.%${escaped}%,summary.ilike.%${escaped}%`)
            .limit(limit),
          'source_documents.preview',
        ),
        sb(
          supabase
            .from('q_a_pairs')
            .select('id, question_text')
            .or(
              `question_text.ilike.%${escaped}%,answer_standard.ilike.%${escaped}%`,
            )
            .limit(limit),
          'q_a_pairs.preview',
        ),
        sb(
          supabase
            .from('reference_items')
            .select('id, title, primary_domain')
            .or(`title.ilike.%${escaped}%,summary.ilike.%${escaped}%`)
            .limit(limit),
          'reference_items.preview',
        ),
      ]);

      // Merge into the unified 4-field preview shape. `content_type` carries
      // the owner_kind so consumers can distinguish record classes. q_a_pairs
      // carry no primary_domain column (it lives on the record_lifecycle
      // facet), so it is null here — the preview is a lightweight typeahead,
      // not a governance surface.
      type PreviewRow = {
        id: string;
        title: string | null;
        content_type: string;
        primary_domain: string | null;
      };
      const merged: PreviewRow[] = [
        ...sourceDocs.map((d) => ({
          id: d.id,
          title: d.suggested_title ?? d.filename,
          content_type: 'source_document',
          primary_domain: d.primary_domain,
        })),
        ...qaPairs.map((qa) => ({
          id: qa.id,
          title: qa.question_text,
          content_type: 'q_a_pair',
          primary_domain: null,
        })),
        ...refItems.map((ri) => ({
          id: ri.id,
          title: ri.title,
          content_type: 'reference_item',
          primary_domain: ri.primary_domain,
        })),
      ];

      // Sort: title matches first, then content-only matches (preserved from
      // the pre-refactor content_items preview).
      const lowerQ = q.toLowerCase();
      const sorted = merged.sort((a, b) => {
        const aTitle = (a.title ?? '').toLowerCase().includes(lowerQ);
        const bTitle = (b.title ?? '').toLowerCase().includes(lowerQ);
        if (aTitle && !bTitle) return -1;
        if (!aTitle && bTitle) return 1;
        return 0;
      });

      // Clamp the merged set to the requested limit (each per-table query is
      // already limit-capped; the merge can exceed it).
      const clamped = sorted.slice(0, limit);

      return NextResponse.json({
        results: clamped,
        count: clamped.length,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Preview search failed') },
        { status: 500 },
      );
    }
  },
);
