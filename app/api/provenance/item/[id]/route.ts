import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { logger } from '@/lib/logger';
import { getItemProvenance } from '@/lib/provenance/item-provenance';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 15;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// TODO(OPS-T1): author ResponseSchema
export const GET = defineRoute(
  z.unknown(),
  async (
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid item ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    try {
      const provenance = await getItemProvenance(auth.supabase, id);
      if (!provenance) {
        return NextResponse.json(
          { error: 'Content item not found' },
          { status: 404 },
        );
      }

      return NextResponse.json(provenance);
    } catch (err) {
      logger.error({ err }, '[provenance/item] Failed');
      return NextResponse.json(
        { error: 'Failed to fetch provenance data' },
        { status: 500 },
      );
    }
  },
);
