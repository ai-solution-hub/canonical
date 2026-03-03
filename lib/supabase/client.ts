import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/supabase/types/database.types';

// Placeholder values used during static generation (e.g. /_not-found at build
// time) when NEXT_PUBLIC_* env vars are not available.  The client will be
// created but never make a real request — all Supabase calls happen inside
// useEffect hooks which only run in the browser where the real env vars exist.
const PLACEHOLDER_URL = 'http://localhost:54321';
const PLACEHOLDER_KEY = 'placeholder-key-for-static-generation';

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL || PLACEHOLDER_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || PLACEHOLDER_KEY,
  );
}
