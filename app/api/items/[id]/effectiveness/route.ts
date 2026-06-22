import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';
import { logger } from '@/lib/logger';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProcurementCitation {
  workspace_id: string;
  workspace_name: string;
  buyer: string | null;
  outcome: 'won' | 'lost' | 'withdrawn' | null;
  cited_at: string;
}

interface EffectivenessResponse {
  content_item_id: string;
  total_citations: number;
  winning_citations: number;
  losing_citations: number;
  pending_citations: number;
  win_rate: number;
  bids: ProcurementCitation[];
}

// ---------------------------------------------------------------------------
// GET /api/items/[id]/effectiveness
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Auth — any authenticated user may read
    const auth = await getAuthorisedClient(['admin', 'editor', 'viewer']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { id } = await params;

    // Validate UUID format
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid item ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    // Check the content item exists
    const { data: item, error: itemError } = await supabase
      .from('content_items')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (itemError) {
      return NextResponse.json(
        { error: 'Failed to look up content item' },
        { status: 500 },
      );
    }

    if (!item) {
      return NextResponse.json(
        { error: 'Content item not found' },
        { status: 404 },
      );
    }

    // Get win-rate stats from RPC
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'get_content_win_rate',
      { p_content_item_id: id },
    );

    if (rpcError) {
      logger.error({ err: rpcError }, 'get_content_win_rate RPC error');
      return NextResponse.json(
        { error: 'Failed to fetch effectiveness data' },
        { status: 500 },
      );
    }

    // RPC returns a single row; extract values (bigint -> Number)
    const rpcRow = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    const totalCitations = Number(rpcRow?.total_citations ?? 0);
    const winningCitations = Number(rpcRow?.winning_citations ?? 0);
    const losingCitations = Number(rpcRow?.losing_citations ?? 0);
    const pendingCitations = Number(rpcRow?.pending_citations ?? 0);
    const winRate = Number(rpcRow?.win_rate ?? 0);

    // Get bid list: citations -> form_responses -> form_questions -> workspaces
    const { data: citations, error: citationsError } = await supabase
      .from('citations')
      .select(
        `
        created_at,
        form_responses!inner (
          id,
          question:form_questions!inner (
            workspace_id,
            workspace:workspaces!inner (
              id,
              name,
              domain_metadata
            )
          )
        )
      `,
      )
      .eq('cited_content_item_id', id)
      .eq('cited_kind', 'content_item')
      .order('created_at', { ascending: false });

    if (citationsError) {
      logger.error({ err: citationsError }, 'Citations query error');
      return NextResponse.json(
        { error: 'Failed to fetch citation data' },
        { status: 500 },
      );
    }

    // Build the bid list, deduplicating by workspace_id
    const seenWorkspaces = new Set<string>();
    const bids: ProcurementCitation[] = [];

    for (const citation of citations ?? []) {
      const response = citation.form_responses as unknown as {
        id: string;
        question: {
          workspace_id: string;
          workspace: {
            id: string;
            name: string;
            domain_metadata: Record<string, unknown> | null;
          };
        };
      };

      const workspace = response?.question?.workspace;
      if (!workspace || seenWorkspaces.has(workspace.id)) continue;
      seenWorkspaces.add(workspace.id);

      const outcome =
        (workspace.domain_metadata?.outcome as string | null) ?? null;
      const validOutcome =
        outcome === 'won' || outcome === 'lost' || outcome === 'withdrawn'
          ? outcome
          : null;

      bids.push({
        workspace_id: workspace.id,
        workspace_name: workspace.name ?? 'Untitled bid',
        buyer: (workspace.domain_metadata?.buyer as string | null) ?? null,
        outcome: validOutcome,
        cited_at: citation.created_at ?? new Date().toISOString(),
      });
    }

    const response: EffectivenessResponse = {
      content_item_id: id,
      total_citations: totalCitations,
      winning_citations: winningCitations,
      losing_citations: losingCitations,
      pending_citations: pendingCitations,
      win_rate: winRate,
      bids,
    };

    return NextResponse.json(response);
  } catch (err) {
    logger.error({ err }, 'Effectiveness route error');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
