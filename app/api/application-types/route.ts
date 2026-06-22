/**
 * GET /api/application-types — list all application types from the DB.
 *
 * ID-29.6 (TECH.md §3 P-1 + §5 step 3).
 * Auth posture: authenticated, any role (Q-3 ratification S251 — TECH.md §7).
 * This route is NOT added to publicRoutes in proxy.ts (not a public endpoint).
 *
 * Returns snake_case rows verbatim (ApplicationTypeRowWire shape).
 * The hook's select: callback normalises snake_case → camelCase and joins
 * static client config + Lucide icon — see hooks/workspaces/use-application-types.ts.
 *
 * Columns selected: key, label, label_plural, description, default_icon, default_colour.
 * Ordered by label ascending.
 */
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const ApplicationTypeRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  label_plural: z.string().nullable(),
  description: z.string().nullable(),
  default_icon: z.string().nullable(),
  default_colour: z.string().nullable(),
});
const ApplicationTypesResponseSchema = z.array(ApplicationTypeRowSchema);
export const GET = defineRoute(ApplicationTypesResponseSchema, async () => {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor', 'viewer']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { data, error } = await supabase
      .from('application_types')
      .select(
        'key, label, label_plural, description, default_icon, default_colour',
      )
      .order('label');

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch application types' },
        { status: 500 },
      );
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch application types') },
      { status: 500 },
    );
  }
});
