/**
 * POST /api/intelligence/workspaces/:id/seed-starter-pack
 *
 * Seeds a workspace with feeds from a predefined starter pack.
 * Admin-only. Idempotent — skips feeds that already exist (by URL).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { sb } from '@/lib/supabase/safe';
import {
  createWarningsCollector,
  warningsEnvelope,
} from '@/lib/supabase/warnings';
import { getStarterPack } from '@/lib/intelligence/starter-packs';

const SeedBodySchema = z.object({
  starter_pack_id: z.string().min(1, 'starter_pack_id is required'),
});

type RouteContext = { params: Promise<{ id: string }> };

interface SeedResult {
  seeded: string[];
  skipped_existing: string[];
  failed: Array<{ url: string; error: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: workspaceId } = await context.params;

    // Auth — admin only (per spec §3.4)
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase, user } = auth;

    // Parse and validate body
    const raw = await request.json();
    const parsed = parseBody(SeedBodySchema, raw);
    if (!parsed.success) return parsed.response;
    const packId = parsed.data.starter_pack_id;

    // Load starter pack
    const pack = getStarterPack(packId);
    if (!pack) {
      return NextResponse.json(
        { error: `Starter pack not found: ${packId}` },
        { status: 404 },
      );
    }

    // Verify workspace exists and is intelligence type
    const workspace = await sb(
      supabase
        .from('workspaces')
        .select('id, type')
        .eq('id', workspaceId)
        .eq('type', 'intelligence')
        .eq('is_archived', false)
        .maybeSingle(),
      'workspaces.verify',
    );

    if (!workspace) {
      return NextResponse.json(
        { error: 'Intelligence workspace not found' },
        { status: 404 },
      );
    }

    const warnings = createWarningsCollector();
    const result: SeedResult = {
      seeded: [],
      skipped_existing: [],
      failed: [],
    };

    // Process each feed with SELECT-before-INSERT idempotency (per spec §3.2 step 3)
    for (const feed of pack.feeds) {
      try {
        // Check if feed already exists by URL
        const existing = await sb(
          supabase
            .from('feed_sources')
            .select('id')
            .eq('workspace_id', workspaceId)
            .eq('url', feed.url)
            .maybeSingle(),
          'feed_sources.check_existing',
        );

        if (existing) {
          result.skipped_existing.push(feed.url);
          continue;
        }

        // Insert new feed source
        await sb(
          supabase
            .from('feed_sources')
            .insert({
              workspace_id: workspaceId,
              name: feed.name,
              url: feed.url,
              source_type: feed.source_type,
              polling_interval_minutes: feed.polling_interval_minutes ?? 60,
              is_active: feed.enabled ?? true,
              created_by: user.id,
            })
            .select()
            .single(),
          'feed_sources.seed_insert',
        );

        result.seeded.push(feed.url);
      } catch (err) {
        const message = safeErrorMessage(
          err,
          `Failed to seed feed: ${feed.name}`,
        );
        result.failed.push({ url: feed.url, error: message });
        warnings.add(`Feed "${feed.name}" failed: ${message}`);
      }
    }

    return warningsEnvelope(
      {
        starter_pack_id: packId,
        starter_pack_name: pack.name,
        ...result,
      },
      warnings,
    );
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to seed starter pack') },
      { status: 500 },
    );
  }
}
