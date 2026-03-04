import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  getAuthorisedClient,
  unauthorisedResponse,
  forbiddenResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { BidUpdateBodySchema } from '@/lib/validation/schemas';
import { canTransition } from '@/lib/bid-state-machine';
import type { BidState } from '@/lib/bid-state-machine';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/bids/:id -- get bid detail with question stats and tender documents */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid bid ID -- must be a valid UUID' },
        { status: 400 },
      );
    }

    // Fetch the bid (project with type = 'bid')
    const { data: bid, error } = await supabase
      .from('projects')
      .select(
        'id, name, description, domain_metadata, is_archived, created_by, created_at, updated_at, updated_by',
      )
      .eq('id', id)
      .eq('type', 'bid')
      .single();

    if (error || !bid) {
      return NextResponse.json(
        { error: 'Bid not found' },
        { status: 404 },
      );
    }

    // Fetch question statistics
    const { data: stats } = await supabase.rpc('get_bid_question_stats', {
      p_project_id: id,
    });

    // List tender documents from storage
    const { data: files } = await supabase.storage
      .from('tender-documents')
      .list(id, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });

    const tenderDocuments = (files ?? []).map((file) => ({
      path: `${id}/${file.name}`,
      filename: file.name,
      size: file.metadata?.size ?? 0,
      mime_type: file.metadata?.mimetype ?? 'application/octet-stream',
      uploaded_at: file.created_at,
    }));

    return NextResponse.json({
      ...bid,
      question_stats: stats?.[0] ?? null,
      tender_documents: tenderDocuments,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch bid') },
      { status: 500 },
    );
  }
}

/** PATCH /api/bids/:id -- update bid metadata and/or status */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth) return forbiddenResponse();
    const { user, supabase } = auth;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid bid ID -- must be a valid UUID' },
        { status: 400 },
      );
    }

    const raw = await request.json();
    const parsed = parseBody(BidUpdateBodySchema, raw);
    if (!parsed.success) return parsed.response;

    // Fetch current bid to get existing domain_metadata
    const { data: current, error: fetchError } = await supabase
      .from('projects')
      .select('id, name, description, domain_metadata')
      .eq('id', id)
      .eq('type', 'bid')
      .single();

    if (fetchError || !current) {
      return NextResponse.json(
        { error: 'Bid not found' },
        { status: 404 },
      );
    }

    const currentMetadata = (current.domain_metadata ?? {}) as Record<string, unknown>;
    const { name, description, status, ...metadataUpdates } = parsed.data;

    // Validate state transition if status is being changed
    if (status) {
      const currentStatus = (currentMetadata.status as BidState) ?? 'draft';
      if (!canTransition(currentStatus, status as BidState)) {
        return NextResponse.json(
          {
            error: `Cannot transition from "${currentStatus}" to "${status}"`,
            current_status: currentStatus,
            requested_status: status,
          },
          { status: 400 },
        );
      }
    }

    // Merge metadata updates, preserving existing fields
    const updatedMetadata = {
      ...currentMetadata,
      ...metadataUpdates,
      ...(status ? { status } : {}),
    };

    // Build project-level updates
    const projectUpdates: Record<string, unknown> = {
      domain_metadata: updatedMetadata,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };
    if (name !== undefined) projectUpdates.name = name;
    if (description !== undefined) projectUpdates.description = description;

    const { data: updated, error: updateError } = await supabase
      .from('projects')
      .update(projectUpdates)
      .eq('id', id)
      .eq('type', 'bid')
      .select(
        'id, name, description, domain_metadata, is_archived, created_by, created_at, updated_at, updated_by',
      )
      .single();

    if (updateError) {
      if (updateError.code === '23505') {
        return NextResponse.json(
          { error: 'A bid with that name already exists' },
          { status: 409 },
        );
      }
      console.error('Failed to update bid:', updateError);
      return NextResponse.json(
        { error: 'Failed to update bid' },
        { status: 500 },
      );
    }

    if (!updated) {
      return NextResponse.json(
        { error: 'Bid not found' },
        { status: 404 },
      );
    }

    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update bid') },
      { status: 500 },
    );
  }
}

/** DELETE /api/bids/:id -- delete a bid (admin only) */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth) return forbiddenResponse();
    const { supabase } = auth;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid bid ID -- must be a valid UUID' },
        { status: 400 },
      );
    }

    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', id)
      .eq('type', 'bid');

    if (error) {
      console.error('Failed to delete bid:', error);
      return NextResponse.json(
        { error: 'Failed to delete bid' },
        { status: 500 },
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to delete bid') },
      { status: 500 },
    );
  }
}
