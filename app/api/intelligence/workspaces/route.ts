// app/api/intelligence/workspaces/route.ts
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import {
  INTELLIGENCE_WORKSPACE_SELECT,
  extractContextFromSatellite,
} from '@/lib/intelligence/workspace-context';
import { logger } from '@/lib/logger';
import { sb } from '@/lib/supabase/safe';
import { parseBody } from '@/lib/validation';
import {
  IntelligenceWorkspaceCreateSchema,
  IntelligenceWorkspaceSchema,
} from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const GET = defineRoute(
  z.array(IntelligenceWorkspaceSchema),
  async () => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      // Fetch intelligence workspaces via INNER JOIN through application_types
      // (post-T2: workspaces.type column dropped; discriminator is the
      // application_type_id FK). The satellite JOIN supplies the 3 typed
      // context columns in the same round-trip.
      const { data: workspaces, error: wsError } = await supabase
        .from('workspaces')
        .select(INTELLIGENCE_WORKSPACE_SELECT)
        .eq('application_types.key', 'intelligence')
        .eq('is_archived', false)
        .order('created_at', { ascending: false });

      if (wsError) {
        return NextResponse.json(
          { error: 'Failed to fetch workspaces' },
          { status: 500 },
        );
      }

      if (!workspaces?.length) {
        return NextResponse.json([]);
      }

      // Project the 3 intelligence-context fields onto each row from the satellite.
      const workspaceContexts = workspaces.map((ws) => ({
        ws,
        context: extractContextFromSatellite(ws.intelligence_workspaces),
      }));

      const profileIds = workspaceContexts
        .map(({ context }) => context.companyProfileId)
        .filter((id): id is string => id !== null);

      // Fetch profile names in bulk
      const warnings: string[] = [];
      let profileMap: Record<string, string> = {};
      if (profileIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('company_profiles')
          .select('id, name')
          .in('id', profileIds);

        if (profilesError) {
          logger.error(
            { err: profilesError },
            'Failed to fetch company profiles for workspace list',
          );
          warnings.push(
            'Company profile names could not be loaded: ' +
              safeErrorMessage(profilesError, 'profiles fetch failed'),
          );
        }
        if (profiles) {
          profileMap = Object.fromEntries(profiles.map((p) => [p.id, p.name]));
        }
      }

      // Fetch source counts per workspace
      const workspaceIds = workspaces.map((ws) => ws.id);
      const { data: sourceCounts, error: sourceCountsError } = await supabase
        .from('feed_sources')
        .select('workspace_id')
        .in('workspace_id', workspaceIds)
        .eq('is_active', true);

      if (sourceCountsError) {
        logger.error(
          { err: sourceCountsError },
          'Failed to fetch feed source counts for workspace list',
        );
        warnings.push(
          'Source counts could not be loaded: ' +
            safeErrorMessage(sourceCountsError, 'source count fetch failed'),
        );
      }

      const sourceCountMap: Record<string, number> = {};
      for (const row of sourceCounts ?? []) {
        sourceCountMap[row.workspace_id] =
          (sourceCountMap[row.workspace_id] ?? 0) + 1;
      }

      // Fetch article counts per workspace
      const { data: articleCounts, error: articleCountsError } = await supabase
        .from('feed_articles')
        .select('workspace_id, passed')
        .in('workspace_id', workspaceIds);

      if (articleCountsError) {
        logger.error(
          { err: articleCountsError },
          'Failed to fetch article counts for workspace list',
        );
        warnings.push(
          'Article counts could not be loaded: ' +
            safeErrorMessage(articleCountsError, 'article count fetch failed'),
        );
      }

      const articleCountMap: Record<string, { total: number; passed: number }> =
        {};
      for (const row of articleCounts ?? []) {
        if (!articleCountMap[row.workspace_id]) {
          articleCountMap[row.workspace_id] = { total: 0, passed: 0 };
        }
        articleCountMap[row.workspace_id].total += 1;
        if (row.passed) {
          articleCountMap[row.workspace_id].passed += 1;
        }
      }

      // Enrich workspaces with typed top-level context, profile name, and counts.
      // Drop the joined `application_types` + `intelligence_workspaces` projections
      // from the response shape — callers consume the flat typed fields below.
      const enriched = workspaceContexts.map(({ ws, context }) => {
        const {
          application_types: _appTypes,
          intelligence_workspaces: _intelSat,
          ...wsRest
        } = ws;
        return {
          ...wsRest,
          company_profile_id: context.companyProfileId,
          guide_id: context.guideId,
          relevance_threshold: context.relevanceThreshold,
          company_profile_name: context.companyProfileId
            ? (profileMap[context.companyProfileId] ?? null)
            : null,
          source_count: sourceCountMap[ws.id] ?? 0,
          article_count: articleCountMap[ws.id]?.total ?? 0,
          passed_article_count: articleCountMap[ws.id]?.passed ?? 0,
        };
      });

      // Surface warnings via response header to preserve the existing
      // array contract consumed by hooks/intelligence/use-intelligence-workspaces.
      // The header is also logged above for server-side observability.
      if (warnings.length > 0) {
        return NextResponse.json(enriched, {
          headers: { 'X-Partial-Failure': warnings.join(' | ') },
        });
      }
      return NextResponse.json(enriched);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch workspaces') },
        { status: 500 },
      );
    }
  },
);

export const POST = defineRoute(
  IntelligenceWorkspaceSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase, user } = auth;

      const raw = await request.json();
      const parsed = parseBody(IntelligenceWorkspaceCreateSchema, raw);
      if (!parsed.success) return parsed.response;

      // Fetch company profile to generate initial prompt
      const { data: profile, error: profileError } = await supabase
        .from('company_profiles')
        .select('*')
        .eq('id', parsed.data.company_profile_id)
        .eq('is_active', true)
        .single();

      if (profileError || !profile) {
        return NextResponse.json(
          { error: 'Company profile not found' },
          { status: 404 },
        );
      }

      // Resolve the intelligence application_type id (seeded as a `core` row in
      // sub-task 1.2 of the T2 migration — should always resolve).
      const appType = await sb(
        supabase
          .from('application_types')
          .select('id')
          .eq('key', 'intelligence')
          .maybeSingle(),
        'application_types.byKey',
      );
      if (!appType) {
        return NextResponse.json(
          { error: 'Intelligence application_type not seeded' },
          { status: 500 },
        );
      }

      // Create the workspace (post-T2: discriminator is application_type_id, not
      // type text col; satellite carries the 3 typed context fields).
      const { data: workspace, error: wsError } = await supabase
        .from('workspaces')
        .insert({
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          application_type_id: appType.id,
          color: '#059669',
          icon: 'globe',
          created_by: user.id,
        })
        .select()
        .single();

      if (wsError || !workspace) {
        return NextResponse.json(
          { error: 'Failed to create workspace' },
          { status: 500 },
        );
      }

      // Create the intelligence_workspaces satellite row with the company profile
      // binding. relevance_threshold is left NULL (admin sets via PATCH).
      const { error: satelliteError } = await supabase
        .from('intelligence_workspaces')
        .insert({
          workspace_id: workspace.id,
          company_profile_id: parsed.data.company_profile_id,
        });
      if (satelliteError) {
        logger.error(
          { err: satelliteError, workspaceId: workspace.id },
          'Failed to create intelligence_workspaces satellite row',
        );
        return NextResponse.json(
          { error: 'Failed to bind workspace to company profile' },
          { status: 500 },
        );
      }

      // Auto-generate the initial feed prompt from profile
      const sectors =
        (profile.sectors as string[])?.join(', ') ?? 'their sector';
      const services = (profile.services as string[])?.join(', ') ?? '';
      const keyTopics = (profile.key_topics as string[])?.join(', ') ?? '';

      let promptText = `Score articles for relevance to ${profile.name}'s business in ${sectors}.`;
      if (services) {
        promptText += ` Focus on articles related to these services: ${services}.`;
      }
      if (keyTopics) {
        promptText += ` Key topics of interest: ${keyTopics}.`;
      }
      promptText +=
        ' Prioritise articles that could inform bids, sales conversations, or strategic decisions.';

      await supabase.from('feed_prompts').insert({
        workspace_id: workspace.id,
        prompt_text: promptText,
        version: 1,
        is_active: true,
        created_by: user.id,
        change_notes: 'Auto-generated from company profile',
      });

      // Auto-create intelligence guide (non-blocking — failure does not prevent workspace creation)
      let guideCreated = false;
      let guideId: string | null = null;

      try {
        const { createIntelligenceGuide } =
          await import('@/lib/intelligence/guide-generator');
        const guideResult = await createIntelligenceGuide(
          supabase,
          workspace.id,
          parsed.data.name,
          {
            id: profile.id,
            name: profile.name,
            sectors: (profile.sectors as string[]) ?? [],
            services: (profile.services as string[]) ?? [],
            key_topics: (profile.key_topics as string[]) ?? [],
          },
          user.id,
        );

        if (guideResult) {
          guideCreated = true;
          guideId = guideResult.guideId;

          // Bind the guide to the satellite (typed column, not JSONB).
          await supabase
            .from('intelligence_workspaces')
            .update({ guide_id: guideResult.guideId })
            .eq('workspace_id', workspace.id);
        }
      } catch {
        // Guide creation failed — workspace still succeeds
      }

      // Project typed top-level context onto the response shape. company_profile_id
      // is the create-time input; guide_id is conditional on guide-creation
      // success; relevance_threshold is always null at create time.
      return NextResponse.json(
        {
          ...workspace,
          company_profile_id: parsed.data.company_profile_id,
          guide_id: guideId,
          relevance_threshold: null,
          guide_created: guideCreated,
        },
        { status: 201 },
      );
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to create workspace') },
        { status: 500 },
      );
    }
  },
);
