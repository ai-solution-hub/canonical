import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import type { Json } from '@/supabase/types/database.types';

export const maxDuration = 30;

/**
 * PATCH /api/entities/[canonical_name]/metadata — update entity metadata.
 *
 * Updates the metadata JSONB column on the first entity_mentions row
 * matching the given canonical_name. This stores certification-level
 * properties (version, issuing_body, expiry_date, scope, etc.) that
 * are entity-level rather than mention-level.
 *
 * Auth: editor or admin.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ canonical_name: string }> },
) {
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
    let metadata: Record<string, unknown>;
    try {
      metadata = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
      return NextResponse.json(
        { error: 'Request body must be a JSON object' },
        { status: 400 },
      );
    }

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
    const currentMetadata = (existing.metadata as Record<string, unknown>) ?? {};
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

    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update entity metadata') },
      { status: 500 },
    );
  }
}
