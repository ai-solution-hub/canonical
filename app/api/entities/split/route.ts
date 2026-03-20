import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { EntitySplitBodySchema } from '@/lib/validation/schemas';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 30;

/**
 * POST /api/entities/split — split an entity by moving selected variant rows
 * to a new canonical_name.
 *
 * Updates entity_mentions where canonical_name matches AND entity_name is in
 * the provided variant_names list. Also updates entity_relationships where the
 * affected mention rows were the only references.
 *
 * Auth: admin only.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { user } = auth;

    const { allowed } = checkRateLimit(`entities:split:${user.id}`, 10, 60_000);
    if (!allowed) return rateLimitResponse();

    const raw = await request.json();
    const parsed = parseBody(EntitySplitBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { canonical_name, variant_names, new_canonical_name } = parsed.data;

    if (canonical_name === new_canonical_name) {
      return NextResponse.json(
        { error: 'New canonical name must differ from the current one' },
        { status: 400 },
      );
    }

    const serviceClient = createServiceClient();

    // Update entity_mentions: move selected variants to new canonical_name
    const { data: updated, error: updateErr } = await serviceClient
      .from('entity_mentions')
      .update({ canonical_name: new_canonical_name })
      .eq('canonical_name', canonical_name)
      .in('entity_name', variant_names)
      .select('id');

    if (updateErr) {
      return NextResponse.json(
        { error: safeErrorMessage(updateErr, 'Failed to split entity mentions') },
        { status: 500 },
      );
    }

    const mentionsUpdated = updated?.length ?? 0;

    if (mentionsUpdated === 0) {
      return NextResponse.json(
        { error: 'No matching variant mentions found to split' },
        { status: 404 },
      );
    }

    // Check if ALL mentions of the old canonical_name have been moved.
    // If so, update entity_relationships to point to the new canonical_name.
    let relationshipsUpdated = 0;

    const { count: remainingCount, error: countErr } = await serviceClient
      .from('entity_mentions')
      .select('id', { count: 'exact', head: true })
      .eq('canonical_name', canonical_name);

    if (!countErr && (remainingCount === null || remainingCount === 0)) {
      // All mentions moved — update entity_relationships too
      const { data: srcUpdated, error: srcErr } = await serviceClient
        .from('entity_relationships')
        .update({ source_entity: new_canonical_name })
        .eq('source_entity', canonical_name)
        .select('id');

      if (!srcErr && srcUpdated) {
        relationshipsUpdated += srcUpdated.length;
      }

      const { data: tgtUpdated, error: tgtErr } = await serviceClient
        .from('entity_relationships')
        .update({ target_entity: new_canonical_name })
        .eq('target_entity', canonical_name)
        .select('id');

      if (!tgtErr && tgtUpdated) {
        relationshipsUpdated += tgtUpdated.length;
      }
    }

    return NextResponse.json({
      split: true,
      original: canonical_name,
      new_canonical_name,
      mentions_moved: mentionsUpdated,
      relationships_updated: relationshipsUpdated,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to split entity') },
      { status: 500 },
    );
  }
}
