import { defineRoute } from "@/lib/api/define-route";
import {
    authFailureResponse,
    getAuthenticatedClient,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { listAvailableTemplates } from '@/lib/templates/template-coverage';
import { NextResponse } from 'next/server';
import { z } from "zod";

export const maxDuration = 30;

// TODO(OPS-T1): author ResponseSchema
export const GET = defineRoute(z.unknown(), async () => {
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
