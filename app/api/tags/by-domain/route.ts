import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseSearchParams } from '@/lib/validation';
import { TagByDomainParamsSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// TODO(OPS-T1): author ResponseSchema
export const GET = defineRoute(z.unknown(), async (request: NextRequest) => {
  try {
    const auth = await getAuthorisedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { allowed } = checkRateLimit(`tags:by-domain:${user.id}`, 20, 60_000);
    if (!allowed) return rateLimitResponse();

    const parsed = parseSearchParams(
      TagByDomainParamsSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;

    const { type } = parsed.data;

    const { data, error } = await supabase.rpc('get_tags_by_domain', {
      p_type: type,
    });

    if (error) {
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to fetch tags by domain') },
        { status: 500 },
      );
    }

    // Group flat rows into { domain, tags: [{tag, count}] } structure
    const grouped: Record<string, { tag: string; count: number }[]> = {};
    for (const row of data ?? []) {
      const domain = row.domain ?? 'Uncategorised';
      if (!grouped[domain]) grouped[domain] = [];
      grouped[domain].push({ tag: row.tag, count: Number(row.count) });
    }

    const result = Object.entries(grouped).map(([domain, tags]) => ({
      domain,
      tags,
    }));

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch tags by domain') },
      { status: 500 },
    );
  }
});
