import { defineRoute } from "@/lib/api/define-route";
import {
    authFailureResponse,
    getAuthenticatedClient,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { listAvailableTemplates } from '@/lib/domains/procurement/form-templating/template-coverage';
import { NextResponse } from 'next/server';
import { z } from "zod";

export const maxDuration = 30;

const TemplateListResponseSchema = z.object({
  templates: z.array(
    z.object({
      template_name: z.string(),
      template_version: z.string().nullable(),
      template_type: z.string(),
      requirement_count: z.number(),
      is_current: z.boolean(),
    }),
  ),
});

export const GET = defineRoute(TemplateListResponseSchema, async () => {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);

    const templates = await listAvailableTemplates(auth.supabase);

    return NextResponse.json({ templates });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to list templates') },
      { status: 500 },
    );
  }
});
