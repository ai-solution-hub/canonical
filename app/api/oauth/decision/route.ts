/**
 * OAuth consent decision handler.
 *
 * Receives POST from the consent page form with the user's approve/deny
 * decision. Calls Supabase Auth OAuth methods and redirects back to the
 * OAuth client with the authorization code or error.
 */
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { parseBody } from '@/lib/validation';
import { OAuthDecisionBodySchema } from '@/lib/validation/schemas';

export async function POST(request: Request) {
  const formData = await request.formData();

  // Validate form data with Zod schema
  const parsed = parseBody(OAuthDecisionBodySchema, {
    decision: formData.get('decision'),
    authorization_id: formData.get('authorization_id'),
  });
  if (!parsed.success) return parsed.response;
  const { decision, authorization_id: authorizationId } = parsed.data;

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
