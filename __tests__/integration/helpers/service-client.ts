/**
 * Real DB Service Client for Phase 3b Integration Tests
 *
 * Loads env vars from .env using dotenv and creates a Supabase service client
 * using SUPABASE_SECRET_KEY (bypasses RLS). This is the foundation for real DB
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

// Load .env and .env.local from project root.
// Worktrees under .claude/worktrees/<name>/ don't have their own .env files,
// so we walk up from cwd to find the main repo root.
function findProjectRoot(): string {
  // cwd is typically the worktree or repo root
  let dir = process.cwd();
  // Walk up until we find a .env file (max 5 levels)
  for (let i = 0; i < 5; i++) {
    try {
      const result = config({ path: resolve(dir, '.env') });
      if (!result.error) return dir;
    } catch { /* continue searching */ }
    dir = resolve(dir, '..');
  }
  return process.cwd();
}

const projectRoot = findProjectRoot();
// Load both .env and .env.local (Next.js convention)
config({ path: resolve(projectRoot, '.env') });
config({ path: resolve(projectRoot, '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;

if (!url || !key) {
  throw new Error(
    'Real DB integration tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env',
  );
}

/**
 * Service-role Supabase client for integration tests.
 * Bypasses RLS — all test data must be cleaned up in afterAll.
 */
export const serviceClient: SupabaseClient<Database> = createClient<Database>(url, key);
