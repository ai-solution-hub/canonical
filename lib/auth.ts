import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { User, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

interface AuthenticatedClient {
  user: User;
  supabase: SupabaseClient<Database>;
}

/**
 * Returns an authenticated Supabase client and user in a single operation.
 * Creates a single cookie-based client used for both auth verification
 * and subsequent data operations. Use this for routes that need Supabase
 * data access after authentication.
 */
export async function getAuthenticatedClient(): Promise<AuthenticatedClient | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { user, supabase };
}

/** Standard 401 response for unauthorised requests */
export function unauthorisedResponse() {
  return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
}

/** Standard 429 response for rate-limited requests */
export function rateLimitResponse() {
  return NextResponse.json(
    { error: 'Rate limit exceeded. Try again shortly.' },
    { status: 429 },
  );
}
