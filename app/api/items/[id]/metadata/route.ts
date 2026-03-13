import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { z } from 'zod';
import { CLIENT_CONFIG } from '@/lib/client-config';
import type { Json } from '@/supabase/types/database.types';

const layerValues = CLIENT_CONFIG.layer_vocabulary.map((l) => l.key);

const MetadataUpdateSchema = z
  .object({
    layer: z
      .enum(layerValues as [string, ...string[]])
      .nullable()
      .optional(),
    topic_id: z.string().max(200).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one metadata field required',
  });

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;
    const { id } = await params;

    const body = await request.json();
    const parsed = MetadataUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid metadata' },
        { status: 400 },
      );
    }

    // Fetch current metadata
    const { data: current, error: fetchError } = await supabase
      .from('content_items')
      .select('metadata')
      .eq('id', id)
      .single();

    if (fetchError || !current) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Merge updates into existing metadata
    const existingMetadata =
      (current.metadata as Record<string, unknown>) || {};
    const updatedMetadata = { ...existingMetadata };

    for (const [key, value] of Object.entries(parsed.data)) {
      if (value === null) {
        delete updatedMetadata[key];
      } else if (value !== undefined) {
        updatedMetadata[key] = value;
      }
    }

    const { error: updateError } = await supabase
      .from('content_items')
      .update({ metadata: updatedMetadata as unknown as Json })
      .eq('id', id);

    if (updateError) {
      return NextResponse.json(
        { error: safeErrorMessage(updateError, 'Failed to update metadata') },
        { status: 500 },
      );
    }

    return NextResponse.json({ metadata: updatedMetadata });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update metadata') },
      { status: 500 },
    );
  }
}
