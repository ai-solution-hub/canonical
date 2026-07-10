/**
 * ID-115 (S8) — the shared `createClient` wrapper for standalone scripts.
 *
 * Background: after the PostgREST schema-isolation cutover `public` is
 * UNEXPOSED and the dedicated `api` schema is the only Data API surface. The
 * app factories (`lib/supabase/{client,server}.ts`, `lib/mcp/auth.ts`) thread
 * `DB_OPTION` so every `.from('x')` resolves to `api.x` and `.rpc('y')` to
 * `api.y`. Standalone scripts under `scripts/` build their own clients with the
 * raw `@supabase/supabase-js` `createClient`, bypassing those factories — this
 * wrapper is the single place that re-applies `DB_OPTION` for them.
 *
 * Usage — drop-in for `createClient(url, key[, options])`:
 *
 *   import { createScriptClient } from './lib/supabase-script-client';
 *   const supabase = createScriptClient(url, key);
 *   const supabase = createScriptClient(url, key, { auth: { persistSession: false } });
 *
 * The client is typed against `Database` (the `public` base-table types) — the
 * same cast seam the app factories use (see `lib/supabase/schema.ts` for why we
 * route to `api` at runtime but stay typed against `public`).
 *
 * A script that must speak to `public` directly (raw DDL, `information_schema`
 * / `pg_catalog` reads, or anything else PostgREST cannot reach) is NOT this
 * wrapper's job to route around: `db.schema: 'public'` still overrides the
 * `api` default mechanically (see `apiOptions` below), but a script that needs
 * to see every base table including ones with no `api` view — including the
 * INTERNAL_ONLY_TABLES that PostgREST never exposes — should use the
 * Supabase Management API's read-only query endpoint instead (direct SQL via
 * `fetch()` + PAT; see `scripts/db-row-count-diff.ts` / ID-143.1 for the
 * pattern). That endpoint sees `public` unconditionally and needs no
 * `supabase-js` client at all.
 */
import {
  createClient,
  type SupabaseClientOptions,
} from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { DB_OPTION } from '@/lib/supabase/schema';

const apiOptions = (options: SupabaseClientOptions<'public'>) => ({
  ...options,
  db: { ...DB_OPTION.db, ...options.db },
});

/**
 * Create a script-side Supabase client routed to the `api` schema at runtime
 * (typed against `Database` via the `DB_OPTION` seam — same posture the app
 * factories use). Any caller-supplied options pass through; a caller-supplied
 * `db.schema` overrides the `api` default, but see the module doc-comment
 * above for why a script needing full unfiltered `public` visibility should
 * reach for the Management API pattern instead of this override.
 */
export function createScriptClient(
  url: string,
  key: string,
  options: SupabaseClientOptions<'public'> = {},
) {
  return createClient<Database>(url, key, apiOptions(options));
}

/**
 * Loose (`any`-typed) variant for the handful of scripts that were historically
 * built from a bare `@supabase/supabase-js` `createClient(url, key)` and
 * deliberately use idioms that cannot be statically typed against the schema —
 * dynamic `.from(variableTableName)`, dead-RPC-with-fallback calls, or raw JSONB
 * writes. Same runtime `api` routing; the loose client type preserves their
 * pre-cutover posture (the script-side expression of the cast-seam philosophy in
 * `lib/supabase/schema.ts` — routing to `api` must not force a type rewrite).
 * Prefer `createScriptClient` (typed) for everything else.
 */
export function createLooseScriptClient(
  url: string,
  key: string,
  options: SupabaseClientOptions<'public'> = {},
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional loose posture (see JSDoc)
  return createClient<any>(url, key, apiOptions(options));
}
