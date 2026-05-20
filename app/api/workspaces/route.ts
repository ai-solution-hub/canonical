import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  getAuthorisedClient,
  authFailureResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody, parseSearchParams } from '@/lib/validation';
import {
  WorkspaceCreateBodySchema,
  WorkspaceListParamsSchema,
} from '@/lib/validation/schemas';
import { logger } from '@/lib/logger';

export const maxDuration = 30;

/** GET /api/workspaces — list workspaces (active only by default, ?include_archived=true for all) */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const parsed = parseSearchParams(
      WorkspaceListParamsSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;
    const includeArchived = parsed.data.include_archived === true;

    // Post-T2: `workspaces.type` text column is dropped. The discriminator is
    // now `application_type_id` (FK to `application_types`). Project the key as
    // a flat `type` field for legacy consumers via a JOIN through
    // `application_types`.
    let query = supabase
      .from('workspaces')
      .select(
        'id, name, description, color, icon, status, domain_metadata, is_archived, created_at, created_by, updated_at, updated_by, application_types!inner(key)',
      )
      .order('name');
    if (!includeArchived) {
      query = query.eq('is_archived', false);
    }

    const { data, error } = await query;

    if (error) {
      logger.error({ err: error }, 'Failed to fetch workspaces');
      return NextResponse.json(
        { error: 'Failed to fetch workspaces' },
        { status: 500 },
      );
    }

    // Flatten the joined application_types projection to a top-level `type`
    // field. Pre-T2 callers consumed `workspace.type` as a string — preserve
    // that shape so the UI does not need to be aware of the JOIN.
    const flattened = (data ?? []).map((ws) => {
      const { application_types, ...wsRest } = ws;
      const appTypes = application_types as
        | { key: string }
        | { key: string }[]
        | null;
      const key = Array.isArray(appTypes)
        ? (appTypes[0]?.key ?? null)
        : (appTypes?.key ?? null);
      return { ...wsRest, type: key };
    });

    return NextResponse.json(flattened);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch workspaces') },
      { status: 500 },
    );
  }
}

/** POST /api/workspaces — create a workspace */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const raw = await request.json();
    const parsed = parseBody(WorkspaceCreateBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { name, description, color, icon, type } = parsed.data;

    // Post-T2: discriminator is `application_type_id`, not the dropped `type`
    // text column. Map the legacy 'bid' input alias to the 'procurement'
    // application_types row (Q-OQR1-02 umbrella rename).
    //
    // 'kb_section' was retired at T2 (no rows in either env). If clients still
    // send it, reject loudly — the legacy default has no replacement seat and
    // the migration's CHECK removal would silently produce a NULL FK insert
    // otherwise.
    const rawTypeKey = type ?? null;
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

    const { data, error } = await supabase
      .from('workspaces')
      .insert({
        name,
        description: description ?? null,
        color: color ?? '#6366f1',
        icon: icon ?? 'folder',
        application_type_id: appType.id,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `A workspace named "${name}" already exists` },
          { status: 409 },
        );
      }
      logger.error({ err: error }, 'Failed to create workspace');
      return NextResponse.json(
        { error: 'Failed to create workspace' },
        { status: 500 },
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create workspace') },
      { status: 500 },
    );
  }
}
