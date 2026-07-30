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

const EntityMergeResponseSchema = z.object({
  merged: z.boolean(),
  target: z.string(),
  entity_type: z.string(),
  mentions_updated: z.number(),
  duplicates_removed: z.number(),
  // id-400 (Inv-9 RESHAPE — curation pinning): surviving target rows stamped
  // `metadata.curation_pinned = true` post-merge; the ingestion walk may
  // never UPDATE/DELETE a pinned row (stage_5.py + flow.py honour the pin).
  mentions_pinned: z.number(),
});

export const POST = defineRoute(
  EntityMergeResponseSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin']);
      if (!auth.success) return authFailureResponse(auth);
      const { user } = auth;

      const { allowed } = checkRateLimit(
        `entities:merge:${user.id}`,
        10,
        60_000,
      );
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

      // ID-70: merge_entities now returns a single typed row (RETURNS TABLE).
      const result = data?.[0];
      if (!result) {
        return NextResponse.json(
          { error: 'Merge returned no result' },
          { status: 500 },
        );
      }

      // id-400 (Inv-9 RESHAPE — curation pinning, TRIAGE §3.1.4): stamp the
      // surviving target rows `metadata.curation_pinned = true` so the
      // ingestion walk can never revert this merge — census #41 failure #1
      // (admin merge reverted on a later walk) is the live symptom this
      // closes. The pipeline honours the pin at three sites: the Stage-5
      // write-back domain + cross-op survivor rule (stage_5.py) and the
      // em-declare carry-forward (flow.py). Best-effort: the merge itself
      // already committed atomically via the RPC; a pin-stamp fault is
      // reported through `mentions_pinned` (fewer than expected / 0), never
      // a 500 that would misreport the committed merge as failed.
      let mentionsPinned = 0;
      try {
        const { data: pinRows, error: pinReadError } = await serviceClient
          .from('entity_mentions')
          .select('id, metadata')
          .eq('canonical_name', result.target)
          .eq('entity_type', result.entity_type);
        if (!pinReadError && Array.isArray(pinRows)) {
          for (const row of pinRows) {
            const existing =
              row.metadata && typeof row.metadata === 'object'
                ? (row.metadata as Record<string, unknown>)
                : {};
            const { error: pinWriteError } = await serviceClient
              .from('entity_mentions')
              .update({ metadata: { ...existing, curation_pinned: true } })
              .eq('id', row.id);
            if (!pinWriteError) mentionsPinned += 1;
          }
        }
      } catch {
        // best-effort — surfaced via mentions_pinned below
      }

      return NextResponse.json({
        merged: result.merged,
        target: result.target,
        entity_type: result.entity_type,
        mentions_updated: result.mentions_updated,
        duplicates_removed: result.duplicates_removed,
        mentions_pinned: mentionsPinned,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to merge entities') },
        { status: 500 },
      );
    }
  },
);
