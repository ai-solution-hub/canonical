import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { clientEnv } from '@/lib/env-client';

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
    );
  }
  return browserClient;
}
