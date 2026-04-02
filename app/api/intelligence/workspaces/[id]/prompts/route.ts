// app/api/intelligence/workspaces/[id]/prompts/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { FeedPromptCreateSchema } from '@/lib/validation/schemas';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/supabase/types/database.types';

type DbClient = SupabaseClient<Database>;

type RouteContext = { params: Promise<{ id: string }> };

const RollbackSchema = z.object({
  action: z.literal('rollback'),
  from_version_id: z.string().uuid(),
});

/** GET /api/intelligence/workspaces/:id/prompts — list all prompt versions */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { data, error } = await supabase
      .from('feed_prompts')
      .select(
        'id, workspace_id, version, prompt_text, is_active, performance_snapshot, change_notes, created_at, created_by',
      )
      .eq('workspace_id', id)
      .order('version', { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch prompts' },
        { status: 500 },
      );
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch prompts') },
      { status: 500 },
    );
  }
}

/** POST /api/intelligence/workspaces/:id/prompts — create new version or rollback */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase, user } = auth;

    const body = await request.json();

    // Check if this is a rollback action
    if (body?.action === 'rollback') {
      const rollbackParsed = parseBody(RollbackSchema, body);
      if (!rollbackParsed.success) return rollbackParsed.response;

      return await handleRollback(
        supabase,
        id,
        rollbackParsed.data.from_version_id,
        user.id,
      );
    }

    // Normal prompt creation
    const parsed = parseBody(FeedPromptCreateSchema, body);
    if (!parsed.success) return parsed.response;

    return await handleCreate(supabase, id, parsed.data, user.id);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create prompt version') },
      { status: 500 },
    );
  }
}

async function handleCreate(
  supabase: DbClient,
  workspaceId: string,
  data: { prompt_text: string; change_notes?: string },
  userId: string,
) {
  // 1. Get the current max version number
  const { data: maxRow } = await supabase
    .from('feed_prompts')
    .select('version')
    .eq('workspace_id', workspaceId)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  const nextVersion = (maxRow?.version ?? 0) + 1;

  // 2. Deactivate all active prompts for this workspace
  await supabase
    .from('feed_prompts')
    .update({ is_active: false })
    .eq('workspace_id', workspaceId)
    .eq('is_active', true);

  // 3. Capture performance snapshot from feed_articles
  const snapshot = await capturePerformanceSnapshot(supabase, workspaceId);

  // 4. Insert new prompt version
  const { data: newPrompt, error } = await supabase
    .from('feed_prompts')
    .insert({
      workspace_id: workspaceId,
      version: nextVersion,
      prompt_text: data.prompt_text,
      is_active: true,
      change_notes: data.change_notes ?? null,
      performance_snapshot: snapshot,
      created_by: userId,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'Failed to create prompt version' },
      { status: 500 },
    );
  }

  return NextResponse.json(newPrompt, { status: 201 });
}

async function handleRollback(
  supabase: DbClient,
  workspaceId: string,
  fromVersionId: string,
  userId: string,
) {
  // 1. Fetch the old prompt
  const { data: oldPrompt, error: fetchError } = await supabase
    .from('feed_prompts')
    .select('prompt_text, version')
    .eq('id', fromVersionId)
    .eq('workspace_id', workspaceId)
    .single();

  if (fetchError || !oldPrompt) {
    return NextResponse.json(
      { error: 'Source prompt version not found' },
      { status: 404 },
    );
  }

  // 2. Get current max version
  const { data: maxRow } = await supabase
    .from('feed_prompts')
    .select('version')
    .eq('workspace_id', workspaceId)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  const nextVersion = (maxRow?.version ?? 0) + 1;

  // 3. Deactivate current active
  await supabase
    .from('feed_prompts')
    .update({ is_active: false })
    .eq('workspace_id', workspaceId)
    .eq('is_active', true);

  // 4. Capture performance snapshot
  const snapshot = await capturePerformanceSnapshot(supabase, workspaceId);

  // 5. Create new version with the old text
  const { data: newPrompt, error } = await supabase
    .from('feed_prompts')
    .insert({
      workspace_id: workspaceId,
      version: nextVersion,
      prompt_text: oldPrompt.prompt_text,
      is_active: true,
      change_notes: `Rollback to version ${oldPrompt.version}`,
      performance_snapshot: snapshot,
      created_by: userId,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'Failed to rollback prompt' },
      { status: 500 },
    );
  }

  return NextResponse.json(newPrompt, { status: 201 });
}

async function capturePerformanceSnapshot(
  supabase: DbClient,
  workspaceId: string,
): Promise<{ [key: string]: Json | undefined }> {
  // Get article stats for the last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { count: totalArticles } = await supabase
    .from('feed_articles')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .gte('ingested_at', thirtyDaysAgo.toISOString());

  const { count: passedArticles } = await supabase
    .from('feed_articles')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('passed', true)
    .gte('ingested_at', thirtyDaysAgo.toISOString());

  const total = totalArticles ?? 0;
  const passed = passedArticles ?? 0;

  return {
    total_articles: total,
    passed_articles: passed,
    filtered_articles: total - passed,
    pass_rate: total > 0 ? Math.round((passed / total) * 100) : 0,
    captured_at: new Date().toISOString(),
    period: '30d',
  };
}
