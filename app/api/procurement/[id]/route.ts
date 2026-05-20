import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  getAuthorisedClient,
  authFailureResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import {
  ProcurementUpdateBodySchema,
  parseProcurementMetadata,
} from '@/lib/validation/schemas';
import { canTransition } from '@/lib/procurement/procurement-workflow';
import type { ProcurementWorkflowState } from '@/lib/procurement/procurement-workflow';
import type { Database } from '@/supabase/types/database.types';
import { logger } from '@/lib/logger';

type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update'];

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
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid bid ID -- must be a valid UUID' },
        { status: 400 },
      );
    }

    // Fetch the bid (workspace with procurement application_type).
    // Post-T2: discriminator moved from `workspaces.type` to FK via application_types.
    const { data: procurementRow, error } = await supabase
      .from('workspaces')
      .select(
        'id, name, description, status, domain_metadata, is_archived, created_by, created_at, updated_at, updated_by, application_types!inner(key)',
      )
      .eq('id', id)
      .eq('application_types.key', 'procurement')
      .single();

    if (error || !procurementRow) {
      return NextResponse.json(
        { error: 'Procurement not found' },
        { status: 404 },
      );
    }

    // Strip the joined projection — callers expect flat workspace fields.
    const { application_types: _appTypes, ...bid } = procurementRow;

    // Composite view: question stats and tender documents are independent
    // enrichments of the bid detail page. A failure in either should not 500
    // the whole page — multiple sibling tabs (overview, questions, drafting,
    // outcome) render fine without them. Surface failures via the canonical
    // sibling-field warnings[] envelope (matches H1 dashboard / H14 template
    // detail / M8 questions list — see s151-fail-fast-partial-response-decisions.md).
    const warnings: string[] = [];

    // Fetch question statistics
    const { data: stats, error: statsError } = await supabase.rpc(
      'get_bid_question_stats',
      {
        p_project_id: id,
      },
    );

    if (statsError) {
      logger.error({ err: statsError }, 'Failed to fetch bid question stats');
      warnings.push(
        'Question stats could not be loaded: ' +
          safeErrorMessage(statsError, 'stats RPC failed'),
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
      logger.error({ err: filesError }, 'Failed to list tender documents');
      warnings.push(
        'Tender documents could not be listed: ' +
          safeErrorMessage(filesError, 'storage list failed'),
      );
    }

    const tenderDocuments = (files ?? []).map((file) => ({
      path: `${id}/${file.name}`,
      filename: file.name,
      size: file.metadata?.size ?? 0,
      mime_type: file.metadata?.mimetype ?? 'application/octet-stream',
      uploaded_at: file.created_at,
    }));

    const responseBody: Record<string, unknown> = {
      ...bid,
      domain_metadata:
        parseProcurementMetadata(bid.domain_metadata) ?? bid.domain_metadata,
      question_stats: stats?.[0] ?? null,
      tender_documents: tenderDocuments,
    };
    if (warnings.length > 0) {
      responseBody.warnings = warnings;
    }
    return NextResponse.json(responseBody);
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
    const parsed = parseBody(ProcurementUpdateBodySchema, raw);
    if (!parsed.success) return parsed.response;

    // Fetch current bid to get existing domain_metadata.
    // Post-T2: discriminator via application_types JOIN.
    const { data: current, error: fetchError } = await supabase
      .from('workspaces')
      .select(
        'id, name, description, status, domain_metadata, application_types!inner(key)',
      )
      .eq('id', id)
      .eq('application_types.key', 'procurement')
      .single();

    if (fetchError || !current) {
      return NextResponse.json(
        { error: 'Procurement not found' },
        { status: 404 },
      );
    }

    const currentMetadata =
      parseProcurementMetadata(current.domain_metadata) ??
      (current.domain_metadata as Record<string, unknown>) ??
      {};
    const { name, description, status, ...metadataUpdates } = parsed.data;

    // Validate state transition if status is being changed
    if (status) {
      const currentStatus =
        (current.status as ProcurementWorkflowState) ?? 'draft';
      if (!canTransition(currentStatus, status as ProcurementWorkflowState)) {
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
    const workspaceUpdates: WorkspaceUpdate = {
      domain_metadata: updatedMetadata as WorkspaceUpdate['domain_metadata'],
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };
    if (name !== undefined) workspaceUpdates.name = name;
    if (description !== undefined) workspaceUpdates.description = description;
    if (status !== undefined) workspaceUpdates.status = status;

    // UPDATE narrows on the same WHERE clause used in the read above. The
    // application_type_id filter would require a sub-select; the prior read
    // already verified the row is a procurement workspace, so a direct
    // .eq('id', id) here is safe (RLS plus the prior fetchError gate).
    const { data: updated, error: updateError } = await supabase
      .from('workspaces')
      .update(workspaceUpdates)
      .eq('id', id)
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
      logger.error({ err: updateError }, 'Failed to update bid');
      return NextResponse.json(
        { error: 'Failed to update bid' },
        { status: 500 },
      );
    }

    if (!updated) {
      return NextResponse.json(
        { error: 'Procurement not found' },
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
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid bid ID -- must be a valid UUID' },
        { status: 400 },
      );
    }

    // Verify bid exists before cleanup.
    // Post-T2: discriminator via application_types JOIN.
    const { data: bid, error: fetchError } = await supabase
      .from('workspaces')
      .select('id, domain_metadata, application_types!inner(key)')
      .eq('id', id)
      .eq('application_types.key', 'procurement')
      .single();

    if (fetchError || !bid) {
      return NextResponse.json(
        { error: 'Procurement not found' },
        { status: 404 },
      );
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
        logger.error(
          { procurementId: id, error: tenderListError },
          'Procurement DELETE: failed to list tender documents for cleanup',
        );
      }
      if (tenderFiles?.length) {
        const { error: tenderRemoveError } = await serviceClient.storage
          .from('tender-documents')
          .remove(tenderFiles.map((f) => `${id}/${f.name}`));
        if (tenderRemoveError) {
          logger.error(
            { procurementId: id, error: tenderRemoveError },
            'Procurement DELETE: failed to remove tender documents (orphaned)',
          );
        }
      }

      // Delete template files and completions.
      // Post-T2: `templates` → `form_templates`, `workspace_id` → `workspace_id`.
      const { data: templates, error: templatesError } = await supabase
        .from('form_templates')
        .select('id, storage_path, structure_path')
        .eq('workspace_id', id);
      if (templatesError) {
        logger.error(
          { procurementId: id, error: templatesError },
          'Procurement DELETE: failed to list templates for cleanup (orphaned files possible)',
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
          logger.error(
            { procurementId: id, error: completionsError },
            'Procurement DELETE: failed to list template completions for cleanup (orphaned files possible)',
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
            logger.error(
              { procurementId: id, error: templateRemoveError },
              'Procurement DELETE: failed to remove template files (orphaned)',
            );
          }
        }
      }
    } catch (storageErr) {
      logger.error({ err: storageErr }, 'Storage cleanup failed (non-fatal)');
    }

    // Remove content_item_workspaces junction rows first — FK is NO ACTION
    // so these would block the workspace delete if any content is linked
    await supabase
      .from('content_item_workspaces')
      .delete()
      .eq('workspace_id', id);

    // DELETE narrows on id only (prior fetchError gate enforces procurement-type).
    const { error } = await supabase.from('workspaces').delete().eq('id', id);

    if (error) {
      logger.error({ err: error }, 'Failed to delete bid');
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
