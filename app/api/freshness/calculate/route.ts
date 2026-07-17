import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { batchCalculateFreshness } from '@/lib/freshness';
import { logger, updateRequestContext, withRequestContext } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { FreshnessCalculateBodySchema } from '@/lib/validation/schemas';
import type { FacetOwnerKind } from '@/lib/validation/owner-kind';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const FreshnessCalculateResponseSchema = z.object({
  updated: z.number(),
  failed_count: z.number(),
  total: z.number(),
  results: z.array(z.object({ id: z.string(), freshness: z.string() })),
  failed: z.array(z.object({ id: z.string(), error: z.string() })),
});

export const POST = withRequestContext(
  defineRoute(
    FreshnessCalculateResponseSchema,
    async (request: NextRequest) => {
      try {
        const auth = await getAuthorisedClient(['admin', 'editor']);
        if (!auth.success) return authFailureResponse(auth);
        const { user, supabase } = auth;

        // Upgrade the request scope with the resolved user so subsequent
        // log lines + any Sentry events carry userId/userRole.
        updateRequestContext({ userId: user.id });

        const { allowed } = checkRateLimit(
          `freshness:calculate:${user.id}`,
          5,
          60_000,
        );
        if (!allowed) return rateLimitResponse();

        const raw = await request.json();
        const parsed = parseBody(FreshnessCalculateBodySchema, raw);
        if (!parsed.success) return parsed.response;

        const { item_ids } = parsed.data;

        // Fetch items with their lifecycle data. ID-131 {131.19} G-GOV-FACET:
        // content_items is dying — lifecycle_type/expiry_date live on the
        // record_lifecycle facet (owner_kind='source_document', SD-only
        // freshness axis per D7); updated_at lives on source_documents.
        const { data: rawItems, error: fetchError } = await supabase
          .from('record_lifecycle')
          .select(
            'source_document_id, lifecycle_type, expiry_date, source_documents!inner(id, updated_at)',
          )
          .eq('owner_kind', 'source_document' satisfies FacetOwnerKind)
          .in('source_document_id', item_ids);

        if (fetchError) {
          logger.error(
            { err: fetchError, op: 'freshness.calculate.fetch' },
            'Failed to fetch items for freshness calculation',
          );
          return NextResponse.json(
            { error: 'Failed to fetch items' },
            { status: 500 },
          );
        }

        const items = (rawItems ?? [])
          .filter((row) => row.source_documents !== null)
          .map((row) => ({
            id: row.source_document_id!,
            lifecycle_type: row.lifecycle_type,
            updated_at: row.source_documents!.updated_at,
            expiry_date: row.expiry_date,
          }));

        if (items.length === 0) {
          return NextResponse.json(
            { error: 'No items found for the provided IDs' },
            { status: 404 },
          );
        }

        // Calculate freshness
        const freshnessMap = batchCalculateFreshness(items);
        const now = new Date().toISOString();

        // Update each item's freshness in the database
        const results: Array<{ id: string; freshness: string }> = [];
        const failed: Array<{ id: string; error: string }> = [];

        for (const [itemId, freshness] of freshnessMap) {
          const { error: updateError } = await supabase
            .from('record_lifecycle')
            .update({
              freshness,
              freshness_checked_at: now,
            })
            .eq('owner_kind', 'source_document' satisfies FacetOwnerKind)
            .eq('source_document_id', itemId);

          if (updateError) {
            logger.error(
              { err: updateError, op: 'freshness.calculate.update', itemId },
              'Failed to update freshness for item',
            );
            failed.push({
              id: itemId,
              error: safeErrorMessage(updateError, 'Update failed'),
            });
          } else {
            results.push({ id: itemId, freshness });
          }
        }

        return NextResponse.json({
          updated: results.length,
          failed_count: failed.length,
          total: items.length,
          results,
          failed,
        });
      } catch (err) {
        logger.error(
          { err, op: 'freshness.calculate' },
          'Failed to calculate freshness',
        );
        return NextResponse.json(
          { error: safeErrorMessage(err, 'Failed to calculate freshness') },
          { status: 500 },
        );
      }
    },
  ),
);
