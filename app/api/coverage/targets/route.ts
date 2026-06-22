import { defineRoute } from "@/lib/api/define-route";
import {
    authFailureResponse,
    getAuthorisedClient,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseBody } from '@/lib/validation';
import { CoverageTargetPutBodySchema, CoverageTargetsPutResponseSchema, TargetsResponseSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

// ---------------------------------------------------------------------------
// GET — fetch all coverage targets (any authenticated user)
// ---------------------------------------------------------------------------

export const GET = defineRoute(TargetsResponseSchema, async () => {
  try {
    const auth = await getAuthorisedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { data, error } = await supabase
      .from('coverage_targets')
      .select('id, domain_id, metric_name, target_value, taxonomy_domains(name)')
      .order('domain_id');

    if (error) {
      logger.error({ err: error }, 'Coverage targets fetch error');
      return NextResponse.json(
        { error: 'Failed to load coverage targets' },
        { status: 500 },
      );
    }

    // Flatten the join: add domain_name from the taxonomy_domains relation
    const targets = (data ?? []).map((row) => {
      const domainRelation = row.taxonomy_domains as unknown as { name: string } | null;
      return {
        id: row.id,
        domain_id: row.domain_id,
        metric_name: row.metric_name,
        target_value: row.target_value,
        domain_name: domainRelation?.name ?? null,
      };
    });

    return NextResponse.json({ targets });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Coverage targets failed') },
      { status: 500 },
    );
  }
});

// ---------------------------------------------------------------------------
// PUT — upsert coverage targets (admin only)
// ---------------------------------------------------------------------------

export const PUT = defineRoute(CoverageTargetsPutResponseSchema, async (request: NextRequest) => {
  try {
    const auth = await getAuthorisedClient();
    if (!auth.success) return authFailureResponse(auth);

    if (auth.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { supabase, user } = auth;
    const body = await request.json();
    const parsed = parseBody(CoverageTargetPutBodySchema, body);
    if (!parsed.success) return parsed.response;

    const now = new Date().toISOString();
    let upsertCount = 0;

    for (const target of parsed.data.targets) {
      const { error } = await supabase.from('coverage_targets').upsert(
        {
          domain_id: target.domain_id,
          metric_name: target.metric_name,
          target_value: target.target_value,
          updated_by: user.id,
          updated_at: now,
        },
        { onConflict: 'domain_id,metric_name' },
      );

      if (error) {
        logger.error({ err: error }, 'Coverage target upsert error');
        return NextResponse.json(
          { error: 'Failed to save coverage target' },
          { status: 500 },
        );
      }
      upsertCount++;
    }

    return NextResponse.json({ success: true, count: upsertCount });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Coverage targets update failed') },
      { status: 500 },
    );
  }
});
