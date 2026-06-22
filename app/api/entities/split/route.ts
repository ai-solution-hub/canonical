import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { createServiceClient } from '@/lib/supabase/server';
import { parseBody } from '@/lib/validation';
import { EntitySplitBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// TODO(OPS-T1): author ResponseSchema
export const POST = defineRoute(z.unknown(), async (request: NextRequest) => {
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
        {
          error: safeErrorMessage(updateErr, 'Failed to split entity mentions'),
        },
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

    // Check if ALL mentions of the old canonical_name were moved.
    // If yes, also update entity_relationships to point to the new name.
    const { data: remaining } = await serviceClient
      .from('entity_mentions')
      .select('id')
      .eq('canonical_name', canonical_name)
      .limit(1);

    const allMoved = !remaining || remaining.length === 0;
    let relationshipsUpdated = 0;

    if (allMoved) {
      // Update relationships where the old name was source or target
      const { data: srcUpdated } = await serviceClient
        .from('entity_relationships')
        .update({ source_entity: new_canonical_name })
        .eq('source_entity', canonical_name)
        .select('id');

      const { data: tgtUpdated } = await serviceClient
        .from('entity_relationships')
        .update({ target_entity: new_canonical_name })
        .eq('target_entity', canonical_name)
        .select('id');

      relationshipsUpdated =
        (srcUpdated?.length ?? 0) + (tgtUpdated?.length ?? 0);
    }

    return NextResponse.json({
      split: true,
      original: canonical_name,
      new_canonical_name,
      mentions_moved: mentionsUpdated,
      all_mentions_moved: allMoved,
      relationships_updated: relationshipsUpdated,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to split entity') },
      { status: 500 },
    );
  }
});
