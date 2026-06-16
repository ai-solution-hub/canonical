/**
 * ID-115 — the single source of truth for the Data API default schema.
 *
 * After the PostgREST schema-isolation cutover, `public` is UNEXPOSED and the
 * dedicated `api` schema (60 security_invoker views + INVOKER RPC entrypoints)
 * is the only exposed Data API surface. Every supabase-js client threads this
 * option so `.from('x')` resolves to `api.x` and `.rpc('y')` to `api.y` at
 * RUNTIME, with ZERO per-call-site rewrites — including the 22 dynamic
 * `.from(variable)` sites.
 *
 * ── Why the client stays TYPED against `public` (the type seam below) ──
 * The api views are 1:1 over the public base tables, so they return the same
 * rows. But `supabase gen types` cannot see a view's NOT NULL constraints (a
 * Postgres view carries none), so every `Database['api']` view column is typed
 * `T | null`, and view FK Relationships are weaker — typed embeds degrade to
 * `SelectQueryError`. Typing the client against `Database['api']` would thus
 * make the app LESS type-safe (null-checks everywhere, broken embeds — ~800 tsc
 * errors). The `public` base-table types describe the same runtime rows with
 * accurate nullability + FK Relationships, so we route to `api` at runtime while
 * keeping the `public` types. `Database['api']` is still generated (for the
 * drift check + documentation). This realises the spec's R5/R6 cast-fallback
 * (TECH §f) and satisfies INV-11 (factories thread the schema) + INV-13's intent
 * (clean tsc, accurate shapes).
 *
 * Rare direct-admin/service paths needing a `public`-only object would use a
 * per-call `.schema('public')` override on the SERVER/SERVICE client only
 * (INV-12); the S4 audit found ZERO such paths (every service write works
 * through the api views/RPC wrappers).
 */
// Internal — consumed in-file by DB_OPTION below. Not exported: external code
// routes via DB_OPTION (the documented seam), so the raw value has no importer.
const API_SCHEMA = 'api';

/**
 * Spread into a `createClient` / `createBrowserClient` / `createServerClient`
 * options object to route the client to the `api` schema at runtime. Typed as
 * `{ schema: 'public' }` (the seam) so the client's generic stays on the
 * `public` base-table types — see the module doc for why. `API_SCHEMA` is the
 * runtime value PostgREST actually receives.
 *
 *   createClient<Database>(url, key, { ...DB_OPTION, auth: { ... } })
 */
export const DB_OPTION = { db: { schema: API_SCHEMA } } as unknown as {
  db: { schema: 'public' };
};
