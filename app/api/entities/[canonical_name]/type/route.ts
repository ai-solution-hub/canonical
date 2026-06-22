import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { createServiceClient } from '@/lib/supabase/server';
import { parseBody } from '@/lib/validation';
import { EntityTypeOverrideBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// TODO(OPS-T1): author ResponseSchema
export const PATCH = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ canonical_name: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin']);
      if (!auth.success) return authFailureResponse(auth);
      const { user } = auth;

      const { allowed } = checkRateLimit(
        `entities:type:${user.id}`,
        20,
        60_000,
      );
      if (!allowed) return rateLimitResponse();

      const raw = await request.json();
      const parsed = parseBody(EntityTypeOverrideBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const { canonical_name } = await params;
      const decodedName = decodeURIComponent(canonical_name);
      const { entity_type } = parsed.data;

      const serviceClient = createServiceClient();

      const { data: updated, error: updateErr } = await serviceClient
        .from('entity_mentions')
        .update({ entity_type_override: entity_type })
        .eq('canonical_name', decodedName)
        .select('id');

      if (updateErr) {
        return NextResponse.json(
          {
            error: safeErrorMessage(updateErr, 'Failed to update entity type'),
          },
          { status: 500 },
        );
      }

      const count = updated?.length ?? 0;

      if (count === 0) {
        return NextResponse.json(
          { error: 'No mentions found for this canonical name' },
          { status: 404 },
        );
      }

      return NextResponse.json({
        updated: true,
        canonical_name: decodedName,
        entity_type,
        mentions_updated: count,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to update entity type') },
        { status: 500 },
      );
    }
  },
);
