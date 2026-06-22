import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseBody } from '@/lib/validation';
import { ArchiveBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// TODO(OPS-T1): author ResponseSchema
export const POST = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      const { id } = await params;

      // Validate UUID format
      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid item ID — must be a valid UUID' },
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

      const parsed = parseBody(ArchiveBodySchema, raw);
      if (!parsed.success) return parsed.response;
      const { reason } = parsed.data;

      // Archive the content item
      const { data, error } = await supabase
        .from('content_items')
        .update({
          archived_at: new Date().toISOString(),
          archived_by: user.id,
          archive_reason: reason,
        })
        .eq('id', id)
        .select('id, title, archived_at, archived_by, archive_reason')
        .single();

      if (error) {
        logger.error({ err: error }, 'Failed to archive content item');
        return NextResponse.json(
          { error: 'Failed to archive item' },
          { status: 500 },
        );
      }

      if (!data) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      }

      return NextResponse.json(data);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to archive item') },
        { status: 500 },
      );
    }
  },
);
