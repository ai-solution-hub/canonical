import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

// Placeholder values used during static generation (e.g. /_not-found at build
// time) when NEXT_PUBLIC_* env vars are not available.  The client will be
// created but never make a real request — all Supabase calls happen inside
// useEffect hooks which only run in the browser where the real env vars exist.
const PLACEHOLDER_URL = 'http://localhost:54321';
const PLACEHOLDER_KEY = 'placeholder-key-for-static-generation';

// Singleton browser client. The Supabase auth helpers / @supabase/ssr docs
// recommend a single browser client per tab — multiple instances waste
// auth-state subscriptions and (more importantly here) yield a fresh
// reference on every render, which busts TanStack Query cache keys when
// callers naively put the client in a queryKey dependency.
//
// `createClient()` is kept as the public API so the existing 30+ call sites
// don't need to migrate; it now returns the same instance on every call.
let browserClient: SupabaseClient<Database> | null = null;

export function createClient(): SupabaseClient<Database> {
  if (!browserClient) {
    browserClient = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL || PLACEHOLDER_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || PLACEHOLDER_KEY,
    );
  }
  return browserClient;
}
