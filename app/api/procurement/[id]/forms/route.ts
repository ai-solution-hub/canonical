import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseBody } from '@/lib/validation';
import {
  CreateProcurementFormBodySchema,
  UpdateProcurementFormTypeBodySchema,
} from '@/lib/validation/schemas';
import { tryQuery } from '@/lib/supabase/safe';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

type FormTemplateInsert =
  Database['public']['Tables']['form_templates']['Insert'];

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ID-130 {130.13} — add-a-form (B-16 / B-19, TECH T-B16/T-B19).
 *
 * A procurement is an umbrella holding MANY forms (B-1). This collection route
 * lets the user add another form to an umbrella: the {130.12} FormTypePicker
 * confirms a `form_type` (confirm-first — the route requires a confirmed type,
 * never silently assigns one), and POST persists a new `form_templates` row
 * with that confirmed type (B-14: the confirmed choice is authoritative).
 *
 * `form_templates` requires document columns (`filename`/`storage_path`/
 * `file_size`/`mime_type`) at the DB level — for an app-created form with no
 * document yet we write `ingest_source='app_upload'` (the column comment marks
 * this value as reserved for the thin UI front-end) plus placeholder markers,
 * mirroring the {130.8} mint convention. The document is uploaded later via the
 * existing tender-upload flow targeting the form.
 */

/** Columns returned for the created/updated form (matches the GET read-shape). */
const FORM_LIST_COLUMNS =
  'id, form_type, name, workflow_state, outcome, outcome_notes, deadline, submission_date, issuing_organisation, outcome_recorded_at, outcome_recorded_by, created_at, updated_at';

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
          { error: 'Invalid procurement ID -- must be a valid UUID' },
          { status: 400 },
        );
      }

      const raw = await request.json();
      const parsed = parseBody(CreateProcurementFormBodySchema, raw);
      if (!parsed.success) return parsed.response;
      const { form_type, name } = parsed.data;

      // Verify the umbrella exists + is a procurement workspace before minting
      // a child form against it.
      const workspaceResult = await tryQuery(
        supabase
          .from('workspaces')
          .select('id, application_types!inner(key)')
          .eq('id', id)
          .eq('application_types.key', 'procurement')
          .single(),
        'procurement.forms.workspace',
      );
      if (!workspaceResult.ok) {
        if (workspaceResult.error.code === 'PGRST116') {
          return NextResponse.json(
            { error: 'Procurement not found' },
            { status: 404 },
          );
        }
        throw workspaceResult.error;
      }

      // App-created (docless) form: satisfy the NOT-NULL document columns with
      // the reserved `app_upload` provenance + placeholder markers ({130.8}
      // mint convention). `workflow_state` defaults to 'draft' (B-8); the
      // confirmed `form_type` is authoritative (B-14).
      const insert: FormTemplateInsert = {
        workspace_id: id,
        name: name ?? 'Untitled form',
        filename: 'app-created-form.pdf',
        storage_path: `app-created/${id}/${crypto.randomUUID()}`,
        file_size: 0,
        mime_type: 'application/pdf',
        ingest_source: 'app_upload',
        form_type,
        workflow_state: 'draft',
        created_by: user.id,
      };

      // `.select()` lets us VERIFY a row was actually written — a REST insert
      // that RLS blocks can otherwise return an empty body without erroring.
      const insertResult = await tryQuery<Array<Record<string, unknown>>>(
        supabase
          .from('form_templates')
          .insert(insert)
          .select(FORM_LIST_COLUMNS),
        'procurement.forms.create',
      );
      if (!insertResult.ok) {
        logger.error(
          { err: insertResult.error },
          'Failed to create procurement form',
        );
        return NextResponse.json(
          { error: 'Failed to create form' },
          { status: 500 },
        );
      }
      const createdRows = insertResult.data ?? [];
      if (createdRows.length === 0) {
        return NextResponse.json(
          { error: 'Form could not be created' },
          { status: 409 },
        );
      }

      return NextResponse.json({ form: createdRows[0] }, { status: 201 });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to create form') },
        { status: 500 },
      );
    }
  },
);

export const PATCH = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id } = await params;
      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid procurement ID -- must be a valid UUID' },
          { status: 400 },
        );
      }

      const raw = await request.json();
      const parsed = parseBody(UpdateProcurementFormTypeBodySchema, raw);
      if (!parsed.success) return parsed.response;
      const { form_id, form_type } = parsed.data;

      const workspaceResult = await tryQuery(
        supabase
          .from('workspaces')
          .select('id, application_types!inner(key)')
          .eq('id', id)
          .eq('application_types.key', 'procurement')
          .single(),
        'procurement.forms.workspace',
      );
      if (!workspaceResult.ok) {
        if (workspaceResult.error.code === 'PGRST116') {
          return NextResponse.json(
            { error: 'Procurement not found' },
            { status: 404 },
          );
        }
        throw workspaceResult.error;
      }

      // Override is scoped to a form that belongs to THIS umbrella — the
      // `workspace_id` predicate prevents re-typing a sibling umbrella's form.
      const updateResult = await tryQuery<Array<Record<string, unknown>>>(
        supabase
          .from('form_templates')
          .update({ form_type })
          .eq('id', form_id)
          .eq('workspace_id', id)
          .select(FORM_LIST_COLUMNS),
        'procurement.forms.updateType',
      );
      if (!updateResult.ok) {
        logger.error({ err: updateResult.error }, 'Failed to update form type');
        return NextResponse.json(
          { error: 'Failed to update form type' },
          { status: 500 },
        );
      }
      const updatedRows = updateResult.data ?? [];
      if (updatedRows.length === 0) {
        return NextResponse.json(
          { error: 'Form not found for this procurement' },
          { status: 404 },
        );
      }

      return NextResponse.json({ form: updatedRows[0] });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to update form type') },
        { status: 500 },
      );
    }
  },
);
