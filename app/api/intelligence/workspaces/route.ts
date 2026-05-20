// app/api/intelligence/workspaces/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { IntelligenceWorkspaceCreateSchema } from '@/lib/validation/schemas';
import { logger } from '@/lib/logger';
import { extractContextFromDomainMetadata } from '@/lib/intelligence/workspace-context';

/** GET /api/intelligence/workspaces — list intelligence workspaces with profile info */
export async function GET() {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    // Fetch intelligence workspaces
    const { data: workspaces, error: wsError } = await supabase
      .from('workspaces')
      .select('*')
      .eq('type', 'intelligence')
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

    // Project the 3 intelligence-context fields onto each row via the
    // canonical helper (workspace-context). Pre-T2 reads JSONB; post-T2
    // (S246 WP2b) reads the typed satellite columns — call sites unchanged.
    const workspaceContexts = workspaces.map((ws) => ({
      ws,
      context: extractContextFromDomainMetadata(ws.domain_metadata),
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
    const enriched = workspaceContexts.map(({ ws, context }) => ({
      ...ws,
      company_profile_id: context.companyProfileId,
      guide_id: context.guideId,
      relevance_threshold: context.relevanceThreshold,
      company_profile_name: context.companyProfileId
        ? (profileMap[context.companyProfileId] ?? null)
        : null,
      source_count: sourceCountMap[ws.id] ?? 0,
      article_count: articleCountMap[ws.id]?.total ?? 0,
      passed_article_count: articleCountMap[ws.id]?.passed ?? 0,
    }));

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
}

/** POST /api/intelligence/workspaces — create intelligence workspace with auto-generated prompt */
export async function POST(request: NextRequest) {
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

    // Create the workspace
    const { data: workspace, error: wsError } = await supabase
      .from('workspaces')
      .insert({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        type: 'intelligence',
        color: '#059669',
        icon: 'globe',
        created_by: user.id,
        domain_metadata: {
          company_profile_id: parsed.data.company_profile_id,
        },
      })
      .select()
      .single();

    if (wsError || !workspace) {
      return NextResponse.json(
        { error: 'Failed to create workspace' },
        { status: 500 },
      );
    }

    // Auto-generate the initial feed prompt from profile
    const sectors = (profile.sectors as string[])?.join(', ') ?? 'their sector';
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

        // Store guide_id in workspace domain_metadata
        await supabase
          .from('workspaces')
          .update({
            domain_metadata: {
              company_profile_id: parsed.data.company_profile_id,
              guide_id: guideResult.guideId,
            },
          })
          .eq('id', workspace.id);
      }
    } catch {
      // Guide creation failed — workspace still succeeds
    }

    // Project typed top-level context onto the response. Use the
    // post-update JSONB shape (`company_profile_id` + optional `guide_id`)
    // since the DB row's `domain_metadata` was updated above; the relevance
    // threshold is always null at create-time.
    const createContext = extractContextFromDomainMetadata({
      company_profile_id: parsed.data.company_profile_id,
      ...(guideId ? { guide_id: guideId } : {}),
    });
    return NextResponse.json(
      {
        ...workspace,
        company_profile_id: createContext.companyProfileId,
        guide_id: createContext.guideId,
        relevance_threshold: createContext.relevanceThreshold,
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
}
