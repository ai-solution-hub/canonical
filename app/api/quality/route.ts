import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse, getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody, parseSearchParams } from '@/lib/validation';
import { QualityResolveBodySchema, QualityFlagsParamsSchema } from '@/lib/validation/schemas';

export const maxDuration = 30;

/**
 * GET /api/quality
 *
 * Returns quality flag data from ingestion_quality_log.
 * Supports optional query params: item_id, flag_type, resolved, limit, offset.
 * Available to all authenticated users (SELECT policy exists on the table).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const parsed = parseSearchParams(QualityFlagsParamsSchema, request.nextUrl.searchParams);
    if (!parsed.success) return parsed.response;
    const { item_id: itemId, flag_type: flagType, resolved, limit, offset } = parsed.data;

    let query = supabase
      .from('ingestion_quality_log')
      .select('id, content_item_id, flag_type, severity, details, resolved, resolved_at, resolved_by, resolution_notes, created_at', { count: 'exact' });

    if (itemId) {
      query = query.eq('content_item_id', itemId);
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
      console.error('Quality flags query error:', error);
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
}

/**
 * PATCH /api/quality
 *
 * Resolves a quality flag. Editor+ role required.
 * Body: { flag_id: uuid, resolution_notes?: string }
 */
export async function PATCH(request: NextRequest) {
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
      console.error('Quality flag resolve error:', error);
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
}
