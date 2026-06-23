import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { enqueueTaxonomySync } from '@/lib/taxonomy/sync-trigger';
import { parseBody } from '@/lib/validation';
import { TaxonomyReorderSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const ReorderResponseSchema = z.object({
  success: z.literal(true),
  updated: z.number(),
});

export const POST = defineRoute(
  ReorderResponseSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const raw = await request.json();
      const parsed = parseBody(TaxonomyReorderSchema, raw);
      if (!parsed.success) return parsed.response;

      const { type, domain_id, items } = parsed.data;
      const table =
        type === 'domain' ? 'taxonomy_domains' : 'taxonomy_subtopics';

      // For subtopic reordering, validate all IDs belong to the specified domain
      if (type === 'subtopic' && domain_id) {
        const ids = items.map((item) => item.id);
        const { data: existing, error: checkError } = await supabase
          .from('taxonomy_subtopics')
          .select('id, domain_id')
          .in('id', ids);

        if (checkError) {
          return NextResponse.json(
            { error: 'Failed to validate subtopic ownership' },
            { status: 500 },
          );
        }

        const invalid = (existing ?? []).filter(
          (s) => s.domain_id !== domain_id,
        );
        if (invalid.length > 0) {
          return NextResponse.json(
            {
              error:
                'One or more subtopics do not belong to the specified domain',
            },
            { status: 400 },
          );
        }
      }

      // Apply updates individually (Supabase doesn't support batch update with different values)
      let updated = 0;
      for (const item of items) {
        const { error } = await supabase
          .from(table)
          .update({ display_order: item.display_order })
          .eq('id', item.id);

        if (!error) updated++;
      }

      enqueueTaxonomySync();
      return NextResponse.json({ success: true, updated });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to reorder items') },
        { status: 500 },
      );
    }
  },
);
