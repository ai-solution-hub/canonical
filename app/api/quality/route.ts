import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthenticatedClient,
  getAuthorisedClient,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseBody, parseSearchParams } from '@/lib/validation';
import {
  QualityFlagsParamsSchema,
  QualityResolveBodySchema,
} from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// GET returns a paged list of ingestion_quality_log rows. The SELECT projects
// `id, source_document_id, flag_type, severity, details, resolved, resolved_at,
// resolved_by, resolution_notes, created_at`. `id`/`flag_type`/`severity` are
// NOT NULL; the remaining columns are nullable DB values and .optional()
// because some 2xx projections return a subset.
const QualityFlagSchema = z.object({
  id: z.string(),
  flag_type: z.string(),
  severity: z.string(),
  source_document_id: z.string().nullable().optional(),
  // details is a free-form jsonb column projected verbatim.
  details: z.unknown().optional(),
  resolved: z.boolean().nullable().optional(),
  resolved_at: z.string().nullable().optional(),
  resolved_by: z.string().nullable().optional(),
  resolution_notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});
const GetQualityResponseSchema = z.object({
  items: z.array(QualityFlagSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export const GET = defineRoute(
  GetQualityResponseSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthenticatedClient();
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const parsed = parseSearchParams(
        QualityFlagsParamsSchema,
        request.nextUrl.searchParams,
      );
      if (!parsed.success) return parsed.response;
      const {
        item_id: itemId,
        flag_type: flagType,
        resolved,
        limit,
        offset,
      } = parsed.data;

      let query = supabase
        .from('ingestion_quality_log')
        .select(
          'id, source_document_id, flag_type, severity, details, resolved, resolved_at, resolved_by, resolution_notes, created_at',
          { count: 'exact' },
        );

      if (itemId) {
        query = query.eq('source_document_id', itemId);
      }

      if (flagType) {
        query = query.eq('flag_type', flagType);
      }

      if (resolved !== undefined) {
        query = query.eq('resolved', resolved);
      }

      query = query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) {
        logger.error({ err: error }, 'Quality flags query error');
        return NextResponse.json(
          { error: 'Failed to fetch quality flags' },
          { status: 500 },
        );
      }

      return NextResponse.json({
        items: data ?? [],
        total: count ?? 0,
        limit,
        offset,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch quality flags') },
        { status: 500 },
      );
    }
  },
);

// PATCH returns a resolution confirmation envelope: { resolved: true, id }
// where `id` is the resolved flag's id from `.update().select('id').single()`.
const PatchQualityResponseSchema = z.object({
  resolved: z.literal(true),
  id: z.string(),
});
export const PATCH = defineRoute(
  PatchQualityResponseSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      const body = await request.json();
      const validated = parseBody(QualityResolveBodySchema, body);
      if (!validated.success) return validated.response;

      const { flag_id, resolution_notes } = validated.data;

      const { data, error } = await supabase
        .from('ingestion_quality_log')
        .update({
          resolved: true,
          resolved_at: new Date().toISOString(),
          resolved_by: user.id,
          resolution_notes: resolution_notes ?? null,
        })
        .eq('id', flag_id)
        .select('id')
        .single();

      if (error) {
        logger.error({ err: error }, 'Quality flag resolve error');
        return NextResponse.json(
          { error: 'Failed to resolve quality flag' },
          { status: 500 },
        );
      }

      if (!data) {
        return NextResponse.json(
          { error: 'Quality flag not found' },
          { status: 404 },
        );
      }

      return NextResponse.json({ resolved: true, id: data.id });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to resolve quality flag') },
        { status: 500 },
      );
    }
  },
);
