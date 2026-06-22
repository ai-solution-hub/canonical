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
import { EntityMergeBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// TODO(OPS-T1): author ResponseSchema
export const POST = defineRoute(z.unknown(), async (request: NextRequest) => {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { user } = auth;

    const { allowed } = checkRateLimit(`entities:merge:${user.id}`, 10, 60_000);
    if (!allowed) return rateLimitResponse();

    const raw = await request.json();
    const parsed = parseBody(EntityMergeBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { sources, target, entity_type } = parsed.data;

    // All source canonical names (including target if present)
    const allSourceNames = [...new Set([...sources, target])];

    // Use service client for atomic RPC merge
    const serviceClient = createServiceClient();

    // Single atomic RPC call — all updates happen in one transaction
    const { data, error } = await serviceClient.rpc('merge_entities', {
      p_source_names: allSourceNames,
      p_target_name: target,
      p_entity_type: entity_type,
    });

    if (error) {
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to merge entities') },
        { status: 500 },
      );
    }

    // RPC returns a jsonb object with merge results
    const result = data as {
      merged: boolean;
      target: string;
      entity_type: string;
      mentions_updated: number;
      relationship_sources_updated: number;
      relationship_targets_updated: number;
      duplicates_removed: number;
    };

    return NextResponse.json({
      merged: result.merged,
      target: result.target,
      entity_type: result.entity_type,
      mentions_updated: result.mentions_updated,
      duplicates_removed: result.duplicates_removed,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to merge entities') },
      { status: 500 },
    );
  }
});
