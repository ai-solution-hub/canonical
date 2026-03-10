/**
 * GET /api/oauth/grants
 *
 * Lists all active OAuth grants for the authenticated user.
 * Used by the Connected Apps section of the settings page.
 */
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { data, error } = await supabase.auth.oauth.listGrants();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ grants: data ?? [] });
}
