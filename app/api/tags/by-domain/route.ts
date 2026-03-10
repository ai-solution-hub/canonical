import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  forbiddenResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { TagByDomainParamsSchema } from '@/lib/validation/schemas';

/**
 * GET /api/tags/by-domain — returns tags grouped by content primary_domain.
 * Auth: any authenticated user.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient();
    if (!auth) return forbiddenResponse();
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
}
