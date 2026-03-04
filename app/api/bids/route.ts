import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  getAuthorisedClient,
  unauthorisedResponse,
  forbiddenResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { BidCreateBodySchema } from '@/lib/validation/schemas';

/** GET /api/bids -- list all bids (active only) */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const status = request.nextUrl.searchParams.get('status');
    const limit = Math.min(
      Math.max(parseInt(request.nextUrl.searchParams.get('limit') ?? '50', 10) || 50, 1),
      100,
    );
    const offset = Math.max(
      parseInt(request.nextUrl.searchParams.get('offset') ?? '0', 10) || 0,
      0,
    );

    let query = supabase
      .from('projects')
      .select(
        'id, name, description, domain_metadata, is_archived, created_by, created_at, updated_at, updated_by',
        { count: 'exact' },
      )
      .eq('type', 'bid')
      .eq('is_archived', false)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('domain_metadata->>status', status);
    }

    const { data: projects, error, count } = await query;

    if (error) {
      console.error('Failed to fetch bids:', error);
      return NextResponse.json(
        { error: 'Failed to fetch bids' },
        { status: 500 },
      );
    }

    // Enrich each bid with question statistics (batch to avoid N+1)
    const bidIds = (projects ?? []).map((p) => p.id);
    const statsMap = new Map<string, Record<string, unknown>>();

    if (bidIds.length > 0) {
      // Type assertion: get_bid_question_stats_batch exists in the database
      // but has not been captured in the auto-generated Supabase types yet.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: batchStats, error: batchError } = await (supabase.rpc as any)(
        'get_bid_question_stats_batch',
        { p_project_ids: bidIds },
      );

      if (batchError) {
        // Fallback to per-bid calls if batch RPC doesn't exist
        console.warn(
          'Batch stats RPC unavailable, falling back to per-bid calls:',
          batchError.message,
        );
        const fallbackResults = await Promise.all(
          bidIds.map(async (bidId) => {
            const { data: stats } = await supabase.rpc('get_bid_question_stats', {
              p_project_id: bidId,
            });
            return { bidId, stats: stats?.[0] ?? null };
          }),
        );
        for (const { bidId, stats } of fallbackResults) {
          if (stats) statsMap.set(bidId, stats);
        }
      } else if (batchStats) {
        for (const row of batchStats) {
          statsMap.set(row.project_id, row);
        }
      }
    }

    const bids = (projects ?? []).map((project) => ({
      ...project,
      question_stats: statsMap.get(project.id) ?? null,
    }));

    return NextResponse.json({
      bids,
      total: count ?? bids.length,
      limit,
      offset,
    });
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
    if (!auth) return forbiddenResponse();
    const { user, supabase } = auth;

    const { allowed } = checkRateLimit(`bids:${user.id}`, 10, 60_000);
    if (!allowed) return rateLimitResponse();

    const raw = await request.json();
    const parsed = parseBody(BidCreateBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { name, description, buyer, deadline, reference_number, estimated_value, notes } =
      parsed.data;

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
      .from('projects')
      .insert({
        name,
        description: description ?? null,
        type: 'bid',
        created_by: user.id,
        domain_metadata: domainMetadata,
      })
      .select(
        'id, name, description, domain_metadata, is_archived, created_by, created_at, updated_at, updated_by',
      )
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `A bid named "${name}" already exists` },
          { status: 409 },
        );
      }
      console.error('Failed to create bid:', error);
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
