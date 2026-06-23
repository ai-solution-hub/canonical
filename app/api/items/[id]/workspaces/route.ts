import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthenticatedClient,
  getAuthorisedClient,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { tryQuery } from '@/lib/supabase/safe';
import { parseBody } from '@/lib/validation';
import {
  ItemWorkspaceBodySchema,
  WorkspaceCreateBodySchema,
} from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthenticatedClient();
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id } = await params;
      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid item ID — must be a valid UUID' },
          { status: 400 },
        );
      }

      const { data, error } = await supabase.rpc('get_item_workspaces', {
        p_item_id: id,
      });

      if (error) {
        logger.error({ err: error }, 'Failed to fetch item workspaces');
        return NextResponse.json(
          { error: 'Failed to fetch item workspaces' },
          { status: 500 },
        );
      }

      return NextResponse.json(data ?? []);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch item workspaces') },
        { status: 500 },
      );
    }
  },
);

export const POST = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      const { id } = await params;
      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid item ID — must be a valid UUID' },
          { status: 400 },
        );
      }

      const raw = await request.json();

      // Check if this is a create+assign request
      if (raw.create) {
        const parsed = parseBody(WorkspaceCreateBodySchema, raw);
        if (!parsed.success) return parsed.response;

        // Post-T2 discriminator: application_type_id FK (legacy `type` text col
        // dropped). Mirror the pattern from app/api/workspaces/route.ts POST.
        const rawTypeKey = parsed.data.type ?? null;
        if (rawTypeKey === 'kb_section' || rawTypeKey === null) {
          return NextResponse.json(
            {
              error:
                'Workspace `type` is required and must reference a seeded application_types key (procurement, intelligence, sales_proposal, product_guide, competitor_research, training_onboarding).',
            },
            { status: 400 },
          );
        }
        const appTypeKey = rawTypeKey;

        const { data: appType, error: appTypeError } = await supabase
          .from('application_types')
          .select('id')
          .eq('key', appTypeKey)
          .maybeSingle();
        if (appTypeError || !appType) {
          logger.error(
            { err: appTypeError, appTypeKey },
            'Failed to resolve application_type for workspace create',
          );
          return NextResponse.json(
            {
              error: `application_type "${appTypeKey}" not seeded — cannot create workspace`,
            },
            { status: 500 },
          );
        }

        // Create the workspace
        const { data: workspace, error: createError } = await supabase
          .from('workspaces')
          .insert({
            name: parsed.data.name,
            description: parsed.data.description ?? null,
            color: parsed.data.color ?? '#6366f1',
            icon: parsed.data.icon ?? 'folder',
            application_type_id: appType.id,
            created_by: user.id,
          })
          .select()
          .single();

        if (createError) {
          if (createError.code === '23505') {
            return NextResponse.json(
              {
                error: `A workspace named "${parsed.data.name}" already exists`,
              },
              { status: 409 },
            );
          }
          logger.error({ err: createError }, 'Failed to create workspace');
          return NextResponse.json(
            { error: 'Failed to create workspace' },
            { status: 500 },
          );
        }

        // Assign the new workspace to the item
        const assignResult = await tryQuery(
          supabase.from('content_item_workspaces').insert({
            content_item_id: id,
            workspace_id: workspace.id,
          }),
          'content_item_workspaces.assign',
        );

        if (!assignResult.ok) {
          logger.error(
            { err: assignResult.error },
            'Failed to assign workspace',
          );
          return NextResponse.json(
            { error: 'Workspace created but failed to assign to item' },
            { status: 500 },
          );
        }

        return NextResponse.json(workspace, { status: 201 });
      }

      // Standard assign/unassign
      const parsed = parseBody(ItemWorkspaceBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const { workspace_id, action } = parsed.data;

      if (action === 'assign') {
        const assignResult = await tryQuery(
          supabase.from('content_item_workspaces').insert({
            content_item_id: id,
            workspace_id,
          }),
          'content_item_workspaces.assign',
        );

        if (!assignResult.ok) {
          if (assignResult.error.code === '23505') {
            return NextResponse.json(
              { error: 'Workspace already assigned to this item' },
              { status: 409 },
            );
          }
          logger.error(
            { err: assignResult.error },
            'Failed to assign workspace',
          );
          return NextResponse.json(
            { error: 'Failed to assign workspace' },
            { status: 500 },
          );
        }
      } else {
        const { error } = await supabase
          .from('content_item_workspaces')
          .delete()
          .eq('content_item_id', id)
          .eq('workspace_id', workspace_id);

        if (error) {
          logger.error({ err: error }, 'Failed to unassign workspace');
          return NextResponse.json(
            { error: 'Failed to unassign workspace' },
            { status: 500 },
          );
        }
      }

      return NextResponse.json({ success: true });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to update item workspaces') },
        { status: 500 },
      );
    }
  },
);
