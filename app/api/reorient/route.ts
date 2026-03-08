import { NextResponse } from 'next/server';
import { getAuthorisedClient, unauthorisedResponse } from '@/lib/auth';
import { fetchReorientData } from '@/lib/reorient';
import { safeErrorMessage } from '@/lib/error';

export async function GET() {
  try {
    const auth = await getAuthorisedClient();
    if (!auth) return unauthorisedResponse();

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
}
