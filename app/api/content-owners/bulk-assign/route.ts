import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseBody } from '@/lib/validation';
import { BulkOwnerAssignSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 60;

const BulkAssignResponseSchema = z.object({
  success: z.literal(true),
  items_updated: z.number(),
});

export const POST = defineRoute(
  BulkAssignResponseSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      const raw = await request.json();
      const parsed = parseBody(BulkOwnerAssignSchema, raw);
      if (!parsed.success) return parsed.response;

      const { item_ids, filter, owner_id } = parsed.data;

      // itemIds is used for the notification's entity_id and the response's
      // cap/count semantics. ownerIds is the resolved owner-id set —
      // bulk_assign_content_owner matches record_lifecycle.owner_id (ID-131
      // {131.13} G-GOV-FACET-B). ID-131 {131.19}: content_items is dying — it
      // was already 1:1 with its backing source_document, so both now
      // collapse onto the same source_documents id set (itemIds === ownerIds
      // wherever the id resolves to a real row); ids that don't resolve
      // (e.g. stale/removed) are dropped.
      let itemIds: string[];
      let ownerIds: string[];

      if (item_ids) {
        // Use explicit list. ID-131 {131.19}: content_items is dying — it
        // was already 1:1 with its backing source_document, so item_ids are
        // now source_documents ids directly; this resolves which of them
        // still exist (dropping any that don't, e.g. stale/removed ids —
        // mirrors the old "no backing source document" drop).
        itemIds = item_ids;

        const { data: resolved, error: resolveError } = await supabase
          .from('source_documents')
          .select('id')
          .in('id', itemIds);

        if (resolveError) {
          return NextResponse.json(
            {
              error: safeErrorMessage(
                resolveError,
                'Failed to resolve content items',
              ),
            },
            { status: 500 },
          );
        }

        ownerIds = (resolved ?? []).map((row) => row.id);
      } else if (filter) {
        // Query source_documents with filters to resolve IDs. ID-131
        // {131.19}: primary_domain/primary_subtopic/content_type live on
        // source_documents directly (M3); content_owner_id (unowned_only)
        // lives on the record_lifecycle facet — only join it when needed.
        const { data: items, error: queryError } = await (filter.unowned_only
          ? (() => {
              let q = supabase
                .from('source_documents')
                .select('id, record_lifecycle!inner(content_owner_id)')
                .is('record_lifecycle.content_owner_id', null);
              if (filter.domain) q = q.eq('primary_domain', filter.domain);
              if (filter.subtopic)
                q = q.eq('primary_subtopic', filter.subtopic);
              if (filter.content_type)
                q = q.eq('content_type', filter.content_type);
              return q.limit(500);
            })()
          : (() => {
              let q = supabase.from('source_documents').select('id');
              if (filter.domain) q = q.eq('primary_domain', filter.domain);
              if (filter.subtopic)
                q = q.eq('primary_subtopic', filter.subtopic);
              if (filter.content_type)
                q = q.eq('content_type', filter.content_type);
              return q.limit(500);
            })());

        if (queryError) {
          return NextResponse.json(
            {
              error: safeErrorMessage(
                queryError,
                'Failed to query content items',
              ),
            },
            { status: 500 },
          );
        }

        itemIds = (items ?? []).map((item) => item.id);
        // Each resolved row already IS a source_documents id, i.e. an
        // owner id (owner_kind='source_document').
        ownerIds = itemIds;
      } else {
        // Should not reach here due to Zod refinement, but handle gracefully
        return NextResponse.json(
          { error: 'Either item_ids or filter must be provided' },
          { status: 400 },
        );
      }

      if (itemIds.length === 0) {
        return NextResponse.json({ success: true, items_updated: 0 });
      }

      // Cap at 500
      if (itemIds.length > 500) {
        itemIds = itemIds.slice(0, 500);
      }

      if (ownerIds.length === 0) {
        return NextResponse.json({ success: true, items_updated: 0 });
      }

      // Call bulk_assign_content_owner RPC
      const { data: rpcResult, error: rpcError } = (await supabase.rpc(
        'bulk_assign_content_owner',
        {
          p_item_ids: ownerIds,
          p_owner_id: owner_id,
          p_assigned_by: user.id,
        },
      )) as { data: number | null; error: { message: string } | null };

      if (rpcError) {
        return NextResponse.json(
          {
            error: safeErrorMessage(
              rpcError,
              'Failed to bulk assign content owner',
            ),
          },
          { status: 500 },
        );
      }

      const count = typeof rpcResult === 'number' ? rpcResult : ownerIds.length;

      // Create a single notification for the new owner summarising the bulk action
      if (owner_id !== user.id) {
        try {
          await supabase.from('notifications').insert({
            user_id: owner_id,
            type: 'owner_assignment',
            entity_type: 'content_item',
            entity_id: itemIds[0],
            title: `You have been assigned as owner of ${count} content item${count === 1 ? '' : 's'}`,
            message: null,
          });
        } catch (err) {
          logger.warn(
            { err },
            'Failed to create bulk owner assignment notification',
          );
        }
      }

      return NextResponse.json({ success: true, items_updated: count });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to bulk assign content owner') },
        { status: 500 },
      );
    }
  },
);
