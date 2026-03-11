import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  forbiddenResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { EntityMergeBodySchema } from '@/lib/validation/schemas';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * POST /api/entities/merge — merge multiple entities into one canonical form.
 *
 * Transaction:
 * 1. Update canonical_name on entity_mentions for all source entities → target
 * 2. Set entity_type_override to the chosen type
 * 3. Update source_entity / target_entity on entity_relationships
 * 4. Delete duplicate mention rows (same canonical_name + entity_type + content_item_id)
 *
 * Auth: admin only.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth) return forbiddenResponse();
    const { user } = auth;

    const { allowed } = checkRateLimit(`entities:merge:${user.id}`, 10, 60_000);
    if (!allowed) return rateLimitResponse();

    const raw = await request.json();
    const parsed = parseBody(EntityMergeBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { sources, target, entity_type } = parsed.data;

    // All source canonical names (including target if present)
    const allSourceNames = [...new Set([...sources, target])];

    // Use service client for transactional operations
    const serviceClient = createServiceClient();

    // 1. Update entity_mentions: rename canonical_name to target
    const { data: mentionsUpdated, error: mentionsErr } = await serviceClient
      .from('entity_mentions')
      .update({
        canonical_name: target,
        entity_type_override: entity_type,
      })
      .in('canonical_name', allSourceNames)
      .select('id');

    if (mentionsErr) {
      return NextResponse.json(
        { error: safeErrorMessage(mentionsErr, 'Failed to update entity mentions') },
        { status: 500 },
      );
    }

    // 2. Update entity_relationships: source_entity
    const { error: relSourceErr } = await serviceClient
      .from('entity_relationships')
      .update({ source_entity: target })
      .in('source_entity', allSourceNames);

    if (relSourceErr) {
      return NextResponse.json(
        { error: safeErrorMessage(relSourceErr, 'Failed to update relationship sources') },
        { status: 500 },
      );
    }

    // 3. Update entity_relationships: target_entity
    const { error: relTargetErr } = await serviceClient
      .from('entity_relationships')
      .update({ target_entity: target })
      .in('target_entity', allSourceNames);

    if (relTargetErr) {
      return NextResponse.json(
        { error: safeErrorMessage(relTargetErr, 'Failed to update relationship targets') },
        { status: 500 },
      );
    }

    // 4. Delete duplicate mention rows — keep the one with highest confidence
    //    (or earliest created_at). Duplicates have the same
    //    (canonical_name, entity_type, content_item_id) after the merge.
    let duplicatesRemoved = 0;
    const { data: dupes, error: dupeFetchErr } = await serviceClient.rpc(
      'delete_duplicate_entity_mentions',
      { p_canonical_name: target },
    );
    if (dupeFetchErr) {
      console.warn('Failed to clean up duplicate mentions:', dupeFetchErr.message);
    }
    if (typeof dupes === 'number') duplicatesRemoved = dupes;

    return NextResponse.json({
      merged: true,
      target,
      entity_type,
      mentions_updated: mentionsUpdated?.length ?? 0,
      duplicates_removed: duplicatesRemoved,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to merge entities') },
      { status: 500 },
    );
  }
}
