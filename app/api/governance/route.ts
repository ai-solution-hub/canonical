import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { getAuthenticatedClient } from '@/lib/auth';
import { sb } from '@/lib/supabase/safe';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { GovernanceConfigBodySchema } from '@/lib/validation/schemas';
import { PRESET_VALUES } from '@/lib/governance/presets';
import { logger } from '@/lib/logger';

export const maxDuration = 30;

/**
 * GET /api/governance
 *
 * List all governance configuration entries.
 * Available to all authenticated users.
 */
export async function GET() {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { data, error } = await supabase
      .from('governance_config')
      .select(
        'id, domain, posture, preset, reviewer_id, timeout_days, quality_score_threshold, auto_flag_on_quality_drop, auto_flag_on_freshness_transition, auto_flag_cooldown_days, created_at, created_by, updated_at, updated_by',
      )
      .order('domain', { ascending: true });

    if (error) {
      logger.error({ err: error }, 'Failed to fetch governance config');
      return NextResponse.json(
        { error: 'Failed to fetch governance configuration' },
        { status: 500 },
      );
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch governance config') },
      { status: 500 },
    );
  }
}

/**
 * POST /api/governance
 *
 * Create or update a governance configuration entry via preset.
 * Admin-only. Accepts { domain, preset } — maps preset to concrete
 * column values using PRESET_VALUES.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const raw = await request.json();
    const parsed = parseBody(GovernanceConfigBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { domain, preset } = parsed.data;
    const values = PRESET_VALUES[preset];

    // Upsert: if domain already exists, update it. Use .maybeSingle() so
    // a real DB failure throws (->500 via outer catch) but a no-row result
    // (`existing === null`) falls through to the insert branch below.
    const existing = await sb(
      supabase
        .from('governance_config')
        .select('id')
        .eq('domain', domain)
        .maybeSingle(),
      'governance.config.existing_domain',
    );

    if (existing) {
      // Update existing
      const { error } = await supabase
        .from('governance_config')
        .update({
          preset,
          posture: values.posture,
          timeout_days: values.timeout_days,
          quality_score_threshold: values.quality_score_threshold,
          auto_flag_on_quality_drop: values.auto_flag_on_quality_drop,
          auto_flag_on_freshness_transition:
            values.auto_flag_on_freshness_transition,
          auto_flag_cooldown_days: values.auto_flag_cooldown_days,
          reviewer_id: null,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (error) {
        logger.error({ err: error }, 'Failed to update governance config');
        return NextResponse.json(
          { error: 'Failed to update governance configuration' },
          { status: 500 },
        );
      }

      return NextResponse.json({ success: true, action: 'updated' });
    } else {
      // Create new
      const { error } = await supabase.from('governance_config').insert({
        domain,
        preset,
        posture: values.posture,
        timeout_days: values.timeout_days,
        quality_score_threshold: values.quality_score_threshold,
        auto_flag_on_quality_drop: values.auto_flag_on_quality_drop,
        auto_flag_on_freshness_transition:
          values.auto_flag_on_freshness_transition,
        auto_flag_cooldown_days: values.auto_flag_cooldown_days,
        reviewer_id: null,
        created_by: user.id,
        updated_by: user.id,
      });

      if (error) {
        logger.error({ err: error }, 'Failed to create governance config');
        return NextResponse.json(
          { error: 'Failed to create governance configuration' },
          { status: 500 },
        );
      }

      return NextResponse.json({ success: true, action: 'created' });
    }
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to save governance config') },
      { status: 500 },
    );
  }
}
