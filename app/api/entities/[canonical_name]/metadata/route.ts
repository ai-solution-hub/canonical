import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseBody } from '@/lib/validation';
import { EntityMetadataUpdateSchema } from '@/lib/validation/schemas';
import type { Database, Json } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// ID-131 {131.19} G-GOV-FACET: expiry_date/lifecycle_type (source_document-
// only freshness axis, D7) now live on the record_lifecycle facet, not
// content_items.
type RecordLifecycleUpdate =
  Database['public']['Tables']['record_lifecycle']['Update'];

export const maxDuration = 30;

export const PATCH = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ canonical_name: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['editor', 'admin']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { canonical_name } = await params;
      const decodedName = decodeURIComponent(canonical_name);

      if (!decodedName || decodedName.trim().length === 0) {
        return NextResponse.json(
          { error: 'canonical_name is required' },
          { status: 400 },
        );
      }

      // Parse and validate request body
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return NextResponse.json(
          { error: 'Invalid JSON body' },
          { status: 400 },
        );
      }

      const parsed = parseBody(EntityMetadataUpdateSchema, raw);
      if (!parsed.success) return parsed.response;
      const metadata = parsed.data;

      // Find the first entity_mentions row for this canonical name
      const { data: existing, error: findError } = await supabase
        .from('entity_mentions')
        .select('id, metadata')
        .eq('canonical_name', decodedName)
        .limit(1)
        .single();

      if (findError || !existing) {
        return NextResponse.json(
          { error: 'Entity not found' },
          { status: 404 },
        );
      }

      // Merge new metadata with existing (shallow merge — new keys override)
      const currentMetadata =
        (existing.metadata as Record<string, unknown>) ?? {};
      const mergedMetadata = { ...currentMetadata, ...metadata };

      // Update the row
      const { data: updated, error: updateError } = await supabase
        .from('entity_mentions')
        .update({ metadata: mergedMetadata as Json })
        .eq('id', existing.id)
        .select('id, canonical_name, entity_type, metadata')
        .single();

      if (updateError) {
        return NextResponse.json(
          { error: safeErrorMessage(updateError, 'Failed to update metadata') },
          { status: 500 },
        );
      }

      // Reverse bridge: propagate expiry_date to linked content items
      // Only for entity types where expiry dates are entity-level (cert, reg, standard)
      const warnings: string[] = [];
      const entityExpiry = mergedMetadata.expiry_date as string | undefined;
      if (entityExpiry !== undefined) {
        try {
          const { data: entityInfo, error: entityInfoError } = await supabase
            .from('entity_mentions')
            .select('entity_type, source_document_id')
            .eq('canonical_name', decodedName);

          if (entityInfoError) {
            logger.error(
              { err: entityInfoError },
              'Reverse bridge: failed to look up entity_mentions',
            );
            warnings.push(
              'Entity metadata saved, but linked content items could not be looked up — expiry not propagated',
            );
          } else if (entityInfo && entityInfo.length > 0) {
            const entityType = entityInfo[0].entity_type;
            const propagateTypes = ['certification', 'regulation', 'standard'];

            if (propagateTypes.includes(entityType)) {
              const contentIds = [
                ...new Set(
                  entityInfo
                    .map((e) => e.source_document_id)
                    .filter(Boolean) as string[],
                ),
              ];

              if (contentIds.length > 0) {
                const updatePayload: RecordLifecycleUpdate = {
                  expiry_date: entityExpiry || null,
                };
                if (entityExpiry) {
                  updatePayload.lifecycle_type = 'date_bound';
                }
                // ID-131 {131.19}: contentIds here are entity_mentions.
                // source_document_id values (already M2-renamed) — the
                // facet row is keyed on the same column, scoped to
                // owner_kind='source_document' (D7 SD-only freshness axis).
                const { error: propagateError } = await supabase
                  .from('record_lifecycle')
                  .update(updatePayload)
                  .eq('owner_kind', 'source_document')
                  .in('source_document_id', contentIds);

                if (propagateError) {
                  logger.error(
                    { err: propagateError },
                    'Reverse bridge: failed to propagate expiry to content items',
                  );
                  warnings.push(
                    'Entity metadata saved, but expiry could not be propagated to linked content items',
                  );
                }
              }
            }
          }
        } catch (bridgeErr) {
          logger.error({ err: bridgeErr }, 'Reverse bridge propagation failed');
          warnings.push(
            'Entity metadata saved, but reverse bridge propagation failed',
          );
        }
      }

      if (warnings.length > 0) {
        return NextResponse.json({ ...updated, warnings });
      }
      return NextResponse.json(updated);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to update entity metadata') },
        { status: 500 },
      );
    }
  },
);
