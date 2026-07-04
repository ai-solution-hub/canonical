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

      // itemIds is always content_items.id (used for the notification's
      // entity_id and the response's cap/count semantics). ownerIds is the
      // resolved source_document_id set — bulk_assign_content_owner now
      // matches record_lifecycle.owner_id (ID-131 {131.13} G-GOV-FACET-B),
      // not content_items.id. Items with no backing source document (e.g.
      // manually created content) cannot be resolved to an owner id and are
      // dropped from ownerIds — content_items has no other FK to a
      // record_lifecycle owner.
      let itemIds: string[];
      let ownerIds: string[];

      if (item_ids) {
        // Use explicit list — resolve to source_document_id via content_items.
        itemIds = item_ids;

        const { data: resolved, error: resolveError } = await supabase
          .from('content_items')
          .select('source_document_id')
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

        ownerIds = (resolved ?? [])
          .map((row) => row.source_document_id)
          .filter((id): id is string => !!id);
      } else if (filter) {
        // Query content_items with filters to resolve IDs
        let query = supabase
          .from('content_items')
          .select('id, source_document_id');

        if (filter.domain) {
          query = query.eq('primary_domain', filter.domain);
        }
        if (filter.subtopic) {
          query = query.eq('primary_subtopic', filter.subtopic);
        }
        if (filter.content_type) {
          query = query.eq('content_type', filter.content_type);
        }
        if (filter.unowned_only) {
          // Column exists in DB but types not yet regenerated
          query = query.is('content_owner_id' as 'id', null);
        }

        query = query.limit(500);

        const { data: items, error: queryError } = await query;

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
        ownerIds = (items ?? [])
          .map((item) => item.source_document_id)
          .filter((id): id is string => !!id);
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
