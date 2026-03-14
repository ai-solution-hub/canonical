import { NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { listAvailableTemplates } from '@/lib/template-coverage';

export const maxDuration = 30;

export async function GET() {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();

    const templates = await listAvailableTemplates(auth.supabase);

    return NextResponse.json({ templates });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to list templates') },
      { status: 500 },
    );
  }
}
