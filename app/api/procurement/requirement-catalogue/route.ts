import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { REQUIREMENT_TYPES } from '@/lib/query/requirement-catalogue';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * Server-side write surface for the reusable requirement catalogue
 * (`form_requirement_templates`) — ID-147 {147.16} fix-mode remediation
 * (Checker FAIL, TECH §7/§H1, PRODUCT §H3, BI-47).
 *
 * The original {147.16} executor commit (5088e664) wrote directly through
 * the browser Supabase client, gated only by RLS + client-side UI-hiding —
 * a deviation from the brief's `auth.success` + `authFailureResponse(auth)`
 * server-side pattern and from the sibling {147.17} editor's convention
 * (reuses `getAuthorisedClient`-gated routes). This route restores that
 * convention: admin/editor-gated create (POST) and update (PATCH), matching
 * the model in `app/api/layers/route.ts` /
 * `app/api/procurement/[id]/questions/[qId]/route.ts`. RLS
 * (`template_requirements_insert`/`_update`, admin+editor) remains
 * defence-in-depth underneath.
 *
 * No DELETE handler: the {147.16} editor exposes no delete affordance (no
 * `useDeleteRequirementTemplate` mutation, no delete button in
 * `components/procurement/requirement-catalogue-editor.tsx`) — adding one
 * here would be an unreferenced, untested handler outside this fix's bounded
 * scope. `template_requirements_delete` (admin-only) RLS policy already
 * exists at the DB layer for when a delete surface is built.
 *
 * A single flat `route.ts` (no `[id]` segment, per the fix-mode dispatch
 * brief) — PATCH identifies the row via `id` in the JSON body rather than a
 * path segment.
 */

export const maxDuration = 30;

const RequirementTemplateCreateSchema = z.object({
  template_name: z.string().trim().min(1, 'Template name is required'),
  template_version: z.string().trim().nullable().optional(),
  template_type: z.string().trim().min(1, 'Template type is required'),
  section_ref: z.string().trim().min(1, 'Section ref is required'),
  section_name: z.string().trim().min(1, 'Section name is required'),
  question_number: z.number().int().nullable().optional(),
  requirement_text: z.string().trim().min(1, 'Requirement text is required'),
  description: z.string().trim().nullable().optional(),
  requirement_type: z.enum(REQUIREMENT_TYPES),
  primary_domain: z.string().trim().nullable().optional(),
  primary_subtopic: z.string().trim().nullable().optional(),
  secondary_domain: z.string().trim().nullable().optional(),
  secondary_subtopic: z.string().trim().nullable().optional(),
  matching_keywords: z.array(z.string()).nullable().optional(),
  matching_guidance: z.string().trim().nullable().optional(),
  is_mandatory: z.boolean().optional(),
  is_current: z.boolean().optional(),
  sector_applicability: z.array(z.string()).nullable().optional(),
  word_limit_guidance: z.number().int().nullable().optional(),
  display_order: z.number().int().optional(),
});

const RequirementTemplateUpdateSchema =
  RequirementTemplateCreateSchema.partial()
    .extend({
      id: z.string().uuid('A valid requirement id is required'),
    })
    .refine((data) => Object.keys(data).some((key) => key !== 'id'), {
      message: 'At least one field must be provided',
    });

/** POST /api/procurement/requirement-catalogue — create a catalogue row. */
export const POST = defineRoute(z.unknown(), async (request: NextRequest) => {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const raw = await request.json();
    const parsed = parseBody(RequirementTemplateCreateSchema, raw);
    if (!parsed.success) return parsed.response;

    const { data, error } = await supabase
      .from('form_requirement_templates')
      .insert(parsed.data)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to create requirement') },
        { status: 500 },
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create requirement') },
      { status: 500 },
    );
  }
});

/** PATCH /api/procurement/requirement-catalogue — update a catalogue row (`id` in the body). */
export const PATCH = defineRoute(z.unknown(), async (request: NextRequest) => {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const raw = await request.json();
    const parsed = parseBody(RequirementTemplateUpdateSchema, raw);
    if (!parsed.success) return parsed.response;

    const { id, ...updates } = parsed.data;

    const { data, error } = await supabase
      .from('form_requirement_templates')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      // PGRST116 = no rows found
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Requirement not found' },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to update requirement') },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Requirement not found' },
        { status: 404 },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update requirement') },
      { status: 500 },
    );
  }
});
