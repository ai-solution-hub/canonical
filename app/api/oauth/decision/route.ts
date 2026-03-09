/**
 * OAuth consent decision handler.
 *
 * Receives POST from the consent page form with the user's approve/deny
 * decision. Calls Supabase Auth OAuth methods and redirects back to the
 * OAuth client with the authorization code or error.
 */
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const formData = await request.formData();
  const decision = formData.get('decision') as string;
  const authorizationId = formData.get('authorization_id') as string;

  if (!authorizationId) {
    return NextResponse.json(
      { error: 'Missing authorization_id' },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  if (decision === 'approve') {
    const { data, error } =
      await supabase.auth.oauth.approveAuthorization(authorizationId, {
        skipBrowserRedirect: true,
      });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // 303 See Other — converts POST to GET for the callback redirect
    return NextResponse.redirect(data.redirect_url, 303);
  } else {
    const { data, error } =
      await supabase.auth.oauth.denyAuthorization(authorizationId, {
        skipBrowserRedirect: true,
      });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.redirect(data.redirect_url, 303);
  }
}
