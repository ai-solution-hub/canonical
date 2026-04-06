import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  getAuthorisedClient,
  unauthorisedResponse,
  authFailureResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import {
  BidUpdateBodySchema,
  parseBidMetadata,
} from '@/lib/validation/schemas';
import { canTransition } from '@/lib/bid/bid-state-machine';
import type { BidState } from '@/lib/bid/bid-state-machine';

export const maxDuration = 30;

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

    // Fetch the bid (workspace with type = 'bid')
    const { data: bid, error } = await supabase
      .from('workspaces')
      .select(
        'id, name, description, status, domain_metadata, is_archived, created_by, created_at, updated_at, updated_by',
      )
      .eq('id', id)
      .eq('type', 'bid')
      .single();

    if (error || !bid) {
      return NextResponse.json({ error: 'Bid not found' }, { status: 404 });
    }

    // Fetch question statistics
    const { data: stats, error: statsError } = await supabase.rpc(
      'get_bid_question_stats',
      {
        p_project_id: id,
      },
    );

    if (statsError) {
      console.error('Failed to fetch bid question stats:', statsError);
      return NextResponse.json(
        {
          error: safeErrorMessage(
            statsError,
            'Failed to fetch bid question stats',
          ),
        },
        { status: 500 },
      );
    }

    // List tender documents from storage
    const { data: files, error: filesError } = await supabase.storage
      .from('tender-documents')
      .list(id, {
        limit: 100,
        sortBy: { column: 'created_at', order: 'desc' },
      });

    if (filesError) {
      console.error('Failed to list tender documents:', filesError);
      return NextResponse.json(
        {
          error: safeErrorMessage(
            filesError,
            'Failed to list tender documents',
          ),
        },
        { status: 500 },
      );
    }

    const tenderDocuments = (files ?? []).map((file) => ({
      path: `${id}/${file.name}`,
      filename: file.name,
      size: file.metadata?.size ?? 0,
      mime_type: file.metadata?.mimetype ?? 'application/octet-stream',
      uploaded_at: file.created_at,
    }));

    return NextResponse.json({
      ...bid,
      domain_metadata:
        parseBidMetadata(bid.domain_metadata) ?? bid.domain_metadata,
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
    if (!auth.success) return authFailureResponse(auth);
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
      .from('workspaces')
      .select('id, name, description, status, domain_metadata')
      .eq('id', id)
      .eq('type', 'bid')
      .single();

    if (fetchError || !current) {
      return NextResponse.json({ error: 'Bid not found' }, { status: 404 });
    }

    const currentMetadata =
      parseBidMetadata(current.domain_metadata) ??
      (current.domain_metadata as Record<string, unknown>) ??
      {};
    const { name, description, status, ...metadataUpdates } = parsed.data;

    // Validate state transition if status is being changed
    if (status) {
      const currentStatus = (current.status as BidState) ?? 'draft';
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

    // Merge metadata updates, preserving existing fields (exclude status from JSONB -- trigger syncs it)
    const updatedMetadata = {
      ...currentMetadata,
      ...metadataUpdates,
    };

    // Build workspace-level updates
    const workspaceUpdates: Record<string, unknown> = {
      domain_metadata: updatedMetadata,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };
    if (name !== undefined) workspaceUpdates.name = name;
    if (description !== undefined) workspaceUpdates.description = description;
    if (status !== undefined) workspaceUpdates.status = status;

    const { data: updated, error: updateError } = await supabase
      .from('workspaces')
      .update(workspaceUpdates)
      .eq('id', id)
      .eq('type', 'bid')
      .select(
        'id, name, description, status, domain_metadata, is_archived, created_by, created_at, updated_at, updated_by',
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
      return NextResponse.json({ error: 'Bid not found' }, { status: 404 });
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
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid bid ID -- must be a valid UUID' },
        { status: 400 },
      );
    }

    // Verify bid exists before cleanup
    const { data: bid, error: fetchError } = await supabase
      .from('workspaces')
      .select('id, domain_metadata')
      .eq('id', id)
      .eq('type', 'bid')
      .single();

    if (fetchError || !bid) {
      return NextResponse.json({ error: 'Bid not found' }, { status: 404 });
    }

    // Clean up storage files before DB delete (best-effort).
    // Errors here orphan storage objects but must NOT block the DB delete —
    // we still log every failure so the data-hygiene leak is observable.
    try {
      const { createServiceClient } = await import('@/lib/supabase/server');
      const serviceClient = createServiceClient();

      // Delete tender documents
      const { data: tenderFiles, error: tenderListError } =
        await serviceClient.storage
          .from('tender-documents')
          .list(id, { limit: 200 });
      if (tenderListError) {
        console.error(
          'Bid DELETE: failed to list tender documents for cleanup',
          { bidId: id, error: tenderListError },
        );
      }
      if (tenderFiles?.length) {
        const { error: tenderRemoveError } = await serviceClient.storage
          .from('tender-documents')
          .remove(tenderFiles.map((f) => `${id}/${f.name}`));
        if (tenderRemoveError) {
          console.error(
            'Bid DELETE: failed to remove tender documents (orphaned)',
            { bidId: id, error: tenderRemoveError },
          );
        }
      }

      // Delete template files and completions
      const { data: templates, error: templatesError } = await supabase
        .from('templates')
        .select('id, storage_path, structure_path')
        .eq('project_id', id);
      if (templatesError) {
        console.error(
          'Bid DELETE: failed to list templates for cleanup (orphaned files possible)',
          { bidId: id, error: templatesError },
        );
      }

      if (templates?.length) {
        const templatePaths = templates
          .flatMap((t) => [t.storage_path, t.structure_path])
          .filter(Boolean) as string[];

        // Get completed template files
        const templateIds = templates.map((t) => t.id);
        const { data: completions, error: completionsError } = await supabase
          .from('template_completions')
          .select('storage_path')
          .in('template_id', templateIds);
        if (completionsError) {
          console.error(
            'Bid DELETE: failed to list template completions for cleanup (orphaned files possible)',
            { bidId: id, error: completionsError },
          );
        }

        const completionPaths = (completions ?? [])
          .map((c) => c.storage_path)
          .filter(Boolean);

        const allPaths = [...templatePaths, ...completionPaths];
        if (allPaths.length) {
          const { error: templateRemoveError } = await serviceClient.storage
            .from('templates')
            .remove(allPaths);
          if (templateRemoveError) {
            console.error(
              'Bid DELETE: failed to remove template files (orphaned)',
              { bidId: id, error: templateRemoveError },
            );
          }
        }
      }
    } catch (storageErr) {
      console.error('Storage cleanup failed (non-fatal):', storageErr);
    }

    // Remove content_item_workspaces junction rows first — FK is NO ACTION
    // so these would block the workspace delete if any content is linked
    await supabase
      .from('content_item_workspaces')
      .delete()
      .eq('workspace_id', id);

    const { error } = await supabase
      .from('workspaces')
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
