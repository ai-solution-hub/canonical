import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { clientEnv } from '@/lib/env-client';
import { DB_OPTION } from '@/lib/supabase/schema';

// Singleton browser client. The Supabase auth helpers / @supabase/ssr docs
// recommend a single browser client per tab — multiple instances waste
// auth-state subscriptions and (more importantly here) yield a fresh
// reference on every render, which busts TanStack Query cache keys when
// callers naively put the client in a queryKey dependency.
//
// `createClient()` is kept as the public API so the existing 30+ call sites
// don't need to migrate; it now returns the same instance on every call.
//
// URL + PUBLISHABLE_KEY come from `clientEnv` (Zod-validated at boot in
// `lib/env-client.ts`) — no defensive placeholder-fallback needed because
// the build fails fast if either var is missing.
let browserClient: SupabaseClient<Database> | null = null;

export function createClient(): SupabaseClient<Database> {
  if (!browserClient) {
    browserClient = createBrowserClient<Database>(
      clientEnv.NEXT_PUBLIC_SUPABASE_URL,
      clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      { ...DB_OPTION },
    );
  }
  return browserClient;
}

/**
 * Whether the browser currently holds a Supabase session.
 *
 * Root-layout providers (`TaxonomyProvider`, `LayerVocabularyProvider`) mount
 * on EVERY route, including the unauthenticated ones (`lib/routes.ts`
 * PUBLIC_ROUTES: /login, /auth/callback, /oauth/consent). Since the id-347
 * anon lockdown, `anon` reaches no relation at all, so a reference-data fetch
 * from those routes can only 401 — it cannot succeed and never could have
 * carried a signed-in user's data. Callers use this to skip the round trip and
 * fall back to their static defaults instead of firing a request that is
 * guaranteed to fail (and, for anything under a console gate, to log).
 *
 * Reads local storage only — no network call — so it is cheap enough to sit in
 * a TanStack Query `queryFn`.
 */
export async function hasBrowserSession(): Promise<boolean> {
  const {
    data: { session },
  } = await createClient().auth.getSession();
  return session !== null;
}
