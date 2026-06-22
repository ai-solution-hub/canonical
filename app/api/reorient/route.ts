import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { fetchReorientData } from '@/lib/reorient';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 60;

// TODO(OPS-T1): author ResponseSchema
export const GET = defineRoute(z.unknown(), async () => {
  try {
    const auth = await getAuthorisedClient();
    if (!auth.success) return authFailureResponse(auth);

    const { user, supabase, role } = auth;
    const isAdmin = role === 'admin';

    const data = await fetchReorientData(supabase, user.id, isAdmin, role);

    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch reorientation data') },
      { status: 500 },
    );
  }
});
