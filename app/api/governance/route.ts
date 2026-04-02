import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { GovernanceConfigBodySchema } from '@/lib/validation/schemas';

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
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const { data, error } = await supabase
      .from('governance_config')
      .select(
        'id, domain, posture, reviewer_id, timeout_days, quality_score_threshold, auto_flag_on_quality_drop, auto_flag_on_freshness_transition, auto_flag_cooldown_days, created_at, created_by, updated_at, updated_by',
      )
      .order('domain', { ascending: true });

    if (error) {
      console.error('Failed to fetch governance config:', error);
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
 * Create or update a governance configuration entry.
 * Admin-only.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const raw = await request.json();
    const parsed = parseBody(GovernanceConfigBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const {
      domain,
      posture,
      reviewer_id,
      timeout_days,
      quality_score_threshold,
      auto_flag_on_quality_drop,
      auto_flag_on_freshness_transition,
      auto_flag_cooldown_days,
    } = parsed.data;

    // Upsert: if domain already exists, update it
    const { data: existing } = await supabase
      .from('governance_config')
      .select('id')
      .eq('domain', domain)
      .single();

    if (existing) {
      // Update existing
      const updatePayload: Record<string, unknown> = {
        posture,
        reviewer_id: reviewer_id ?? null,
        timeout_days: timeout_days ?? 7,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      };
      if (quality_score_threshold !== undefined)
        updatePayload.quality_score_threshold = quality_score_threshold;
      if (auto_flag_on_quality_drop !== undefined)
        updatePayload.auto_flag_on_quality_drop = auto_flag_on_quality_drop;
      if (auto_flag_on_freshness_transition !== undefined)
        updatePayload.auto_flag_on_freshness_transition =
          auto_flag_on_freshness_transition;
      if (auto_flag_cooldown_days !== undefined)
        updatePayload.auto_flag_cooldown_days = auto_flag_cooldown_days;

      const { error } = await supabase
        .from('governance_config')
        .update(updatePayload)
        .eq('id', existing.id);

      if (error) {
        console.error('Failed to update governance config:', error);
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
        posture,
        reviewer_id: reviewer_id ?? null,
        timeout_days: timeout_days ?? 7,
        created_by: user.id,
        updated_by: user.id,
        ...(quality_score_threshold !== undefined && {
          quality_score_threshold,
        }),
        ...(auto_flag_on_quality_drop !== undefined && {
          auto_flag_on_quality_drop,
        }),
        ...(auto_flag_on_freshness_transition !== undefined && {
          auto_flag_on_freshness_transition,
        }),
        ...(auto_flag_cooldown_days !== undefined && {
          auto_flag_cooldown_days,
        }),
      });

      if (error) {
        console.error('Failed to create governance config:', error);
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
