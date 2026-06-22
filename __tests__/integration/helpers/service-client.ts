/**
 * Real DB Service Client for Phase 3b Integration Tests
 *
 * Loads env vars from .env using dotenv and creates a Supabase service client
 * using SUPABASE_SERVICE_ROLE_KEY (bypasses RLS). This is the foundation for real DB
 * integration tests that verify end-to-end data flow.
 *
 * This differs from supabase-client.ts (Phase 3a) in that it eagerly loads
 * dotenv at import time, ensuring env vars are available without the caller
 * needing to configure anything.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { DB_OPTION } from '@/lib/supabase/schema';
import { findProjectRoot } from './find-project-root';

// Resolve the project root from a dotenv marker file. In CI the env vars are
// injected directly into the process environment (no .env/.env.local on disk),
// so findProjectRoot() throws — fall back to the ambient process.env in that
// case. The url/key guard below is the real loud config gate, so a missing
// dotenv file with the required vars already set is a valid (CI) state.
let projectRoot: string | null = null;
try {
  projectRoot = findProjectRoot();
} catch {
  projectRoot = null;
}
if (projectRoot) {
  // Load .env then .env.local with override (Next.js convention — .env.local wins).
  // Without override:true the second load is a no-op for keys already set by .env,
  // so stale .env values silently win. Surfaced post-S201 SUPABASE_SERVICE_ROLE_KEY
  // rotation when .env carried the old value and integration tests called
  // auth.admin.listUsers against the wrong project.
  config({ path: resolve(projectRoot, '.env') });
  config({ path: resolve(projectRoot, '.env.local'), override: true });
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error(
    'Real DB integration tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env',
  );
}

/**
 * Service-role Supabase client for integration tests.
 * Bypasses RLS — all test data must be cleaned up in afterAll.
 */
// ID-115 (S9): route to the exposed `api` schema at runtime (public is
// unexposed post-cutover); the `Database` generic stays on the `public` base
// types via the `DB_OPTION` seam (see lib/supabase/schema.ts).
export const serviceClient: SupabaseClient<Database> = createClient<Database>(
  url,
  key,
  { ...DB_OPTION },
);
