import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse, getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { z } from 'zod';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    const { searchParams } = request.nextUrl;
    const itemId = searchParams.get('item_id');
    const flagType = searchParams.get('flag_type');
    const resolvedParam = searchParams.get('resolved');
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');

    const limit = Math.min(Math.max(parseInt(limitParam ?? '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(offsetParam ?? '0', 10) || 0, 0);
    const resolved = resolvedParam === 'true' ? true : resolvedParam === 'false' ? false : undefined;

    let query = supabase
      .from('ingestion_quality_log')
      .select('id, content_item_id, flag_type, severity, details, resolved, resolved_at, resolved_by, resolution_notes, created_at', { count: 'exact' });

    if (itemId) {
      if (!UUID_RE.test(itemId)) {
        return NextResponse.json(
          { error: 'item_id must be a valid UUID' },
          { status: 400 },
        );
      }
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

/** Schema for PATCH /api/quality — resolve a quality flag */
const QualityResolveBodySchema = z.object({
  flag_id: z.string().uuid('flag_id must be a valid UUID'),
  resolution_notes: z.string().max(1000).optional(),
});

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
