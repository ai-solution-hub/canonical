import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthenticatedClient,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody, parseSearchParams } from '@/lib/validation';
import {
  VALID_GUIDE_TYPES,
  guideCreateSchema,
} from '@/lib/validation/guide-schemas';
import { GuideListParamsSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// ID-131.19 fix-Executor escalation 2b (DR-034 owner ruling): the
// `?include=stats` leg (get_guide_coverage() RPC enrichment) has been
// retired — content_items-era coverage is RETIRED, not re-pointed, and this
// leg had no live UI consumer (grep-confirmed: only guides-stats.test.ts
// exercised it). See supabase/migrations-blocked/20260706104000_id131_coverage_retire.sql
// for the corresponding DROP FUNCTION statements (authored, not yet applied).

// guides.select(...) projects all 13 columns; description/domain_filter/icon/
// color/created_by are DB-nullable. Existing route tests assert 2xx with sparse
// mock rows (id/slug/name/guide_type only — guides.test.ts), so every projected
// column beyond the four always-present keys is .optional() to honour the
// route's own LOUD contract, and .nullable() where the column is DB-nullable.
const GuideRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  guide_type: z.enum(VALID_GUIDE_TYPES),
  description: z.string().nullable().optional(),
  domain_filter: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  display_order: z.number().optional(),
  is_published: z.boolean().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

const GetGuidesResponseSchema = z.array(GuideRowSchema);

export const GET = defineRoute(
  GetGuidesResponseSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthenticatedClient();
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const parsed = parseSearchParams(
        GuideListParamsSchema,
        request.nextUrl.searchParams,
      );
      if (!parsed.success) return parsed.response;
      const { type: typeFilter, include_unpublished: includeUnpublished } =
        parsed.data;

      let query = supabase
        .from('guides')
        .select(
          'id, slug, name, description, guide_type, domain_filter, icon, color, display_order, is_published, created_by, created_at, updated_at',
        )
        .order('display_order')
        .order('name');

      if (typeFilter) {
        query = query.eq('guide_type', typeFilter);
      }

      // RLS handles published/unpublished visibility based on role
      // but if the caller explicitly wants only published, filter here
      if (!includeUnpublished) {
        query = query.eq('is_published', true);
      }

      const { data, error } = await query;

      if (error) {
        logger.error({ err: error }, 'Failed to fetch guides');
        return NextResponse.json(
          { error: 'Failed to fetch guides' },
          { status: 500 },
        );
      }

      return NextResponse.json(data);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch guides') },
        { status: 500 },
      );
    }
  },
);

// POST .select() returns the full inserted row — same shape as GuideRowSchema.
export const POST = defineRoute(
  GuideRowSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      const rl = checkRateLimit(`guides-create:${user.id}`, 20, 60_000);
      if (!rl.allowed) return rateLimitResponse(rl.resetAt);

      const raw = await request.json();
      const parsed = parseBody(guideCreateSchema, raw);
      if (!parsed.success) return parsed.response;

      const { data, error } = await supabase
        .from('guides')
        .insert({
          ...parsed.data,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          return NextResponse.json(
            { error: `A guide with slug "${parsed.data.slug}" already exists` },
            { status: 409 },
          );
        }
        logger.error({ err: error }, 'Failed to create guide');
        return NextResponse.json(
          { error: 'Failed to create guide' },
          { status: 500 },
        );
      }

      return NextResponse.json(data, { status: 201 });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to create guide') },
        { status: 500 },
      );
    }
  },
);
