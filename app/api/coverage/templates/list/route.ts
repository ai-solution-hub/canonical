import { NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  authFailureResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { listAvailableTemplates } from '@/lib/templates/template-coverage';

export const maxDuration = 30;

export async function GET() {
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
}
