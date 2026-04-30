import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody, parseSearchParams } from '@/lib/validation';
import {
  BidCreateBodySchema,
  BidListParamsSchema,
  parseBidMetadata,
} from '@/lib/validation/schemas';
import { logger } from '@/lib/logger';

export const maxDuration = 30;

/** GET /api/bids -- list all bids (active only) */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const parsed = parseSearchParams(
      BidListParamsSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;
    const { status, limit, offset } = parsed.data;

    let query = supabase
      .from('workspaces')
      .select(
        'id, name, description, status, domain_metadata, is_archived, created_by, created_at, updated_at, updated_by',
        { count: 'exact' },
      )
      .eq('type', 'bid')
      .eq('is_archived', false)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: workspaces, error, count } = await query;

    if (error) {
      logger.error({ err: error }, 'Failed to fetch bids');
      return NextResponse.json(
        { error: 'Failed to fetch bids' },
        { status: 500 },
      );
    }

    // Enrich each bid with question statistics (batch to avoid N+1)
    const bidIds = (workspaces ?? []).map((p) => p.id);
    const statsMap = new Map<string, Record<string, unknown>>();
    // Track per-bid stats failures so the response can surface them as a
    // sibling `failed_bid_ids` field. Mirrors the H13 pattern in
    // `app/api/freshness/calculate/route.ts` (S151 silent-failure remediation).
    const failedBidIds: string[] = [];

    if (bidIds.length > 0) {
      const { data: batchStats, error: batchError } = await supabase.rpc(
        'get_bid_question_stats_batch',
        { p_project_ids: bidIds },
      );

      if (batchError) {
        // Fallback to per-bid calls if batch RPC doesn't exist
        logger.warn(
          { err: batchError.message },
          'Batch stats RPC unavailable, falling back to per-bid calls',
        );
        const fallbackResults = await Promise.all(
          bidIds.map(async (bidId) => {
            const { data: stats, error: statsError } = await supabase.rpc(
              'get_bid_question_stats',
              {
                p_project_id: bidId,
              },
            );
            if (statsError) {
              logger.error(
                { err: statsError, bidId },
                'Per-bid stats RPC failed (fallback path) for bid',
              );
              return { bidId, stats: null, failed: true };
            }
            return { bidId, stats: stats?.[0] ?? null, failed: false };
          }),
        );
        for (const { bidId, stats, failed } of fallbackResults) {
          if (stats) statsMap.set(bidId, stats);
          if (failed) failedBidIds.push(bidId);
        }
      } else if (batchStats) {
        for (const row of batchStats) {
          statsMap.set(row.project_id, row);
        }
      }
    }

    const bids = (workspaces ?? []).map((workspace) => ({
      ...workspace,
      domain_metadata:
        parseBidMetadata(workspace.domain_metadata) ??
        workspace.domain_metadata,
      question_stats: statsMap.get(workspace.id) ?? null,
    }));

    // `failed_bid_ids` is a sibling field, only present when the fallback
    // loop produced at least one failure. Matches the H13 "absent when
    // empty" convention so existing consumers see no shape change in the
    // happy path.
    const response: {
      bids: typeof bids;
      total: number;
      limit: number;
      offset: number;
      failed_bid_ids?: string[];
    } = {
      bids,
      total: count ?? bids.length,
      limit,
      offset,
    };
    if (failedBidIds.length > 0) {
      response.failed_bid_ids = failedBidIds;
    }
    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch bids') },
      { status: 500 },
    );
  }
}

/** POST /api/bids -- create a new bid */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { allowed } = checkRateLimit(`bids:${user.id}`, 10, 60_000);
    if (!allowed) return rateLimitResponse();

    const raw = await request.json();
    const parsed = parseBody(BidCreateBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const {
      name,
      description,
      buyer,
      deadline,
      reference_number,
      estimated_value,
      notes,
    } = parsed.data;

    const domainMetadata = {
      buyer,
      status: 'draft',
      deadline: deadline ?? null,
      reference_number: reference_number ?? null,
      estimated_value: estimated_value ?? null,
      tender_source: null,
      tender_document_ids: [],
      submission_date: null,
      outcome: null,
      outcome_notes: null,
      notes: notes ?? null,
    };

    const { data, error } = await supabase
      .from('workspaces')
      .insert({
        name,
        description: description ?? null,
        type: 'bid',
        status: 'draft',
        created_by: user.id,
        domain_metadata: domainMetadata,
      })
      .select(
        'id, name, description, status, domain_metadata, is_archived, created_by, created_at, updated_at, updated_by',
      )
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `A bid named "${name}" already exists` },
          { status: 409 },
        );
      }
      logger.error({ err: error }, 'Failed to create bid');
      return NextResponse.json(
        { error: 'Failed to create bid' },
        { status: 500 },
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create bid') },
      { status: 500 },
    );
  }
}
