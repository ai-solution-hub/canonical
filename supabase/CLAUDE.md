# Supabase / Migrations — directory context

- **DDL via CLI only** (`supabase migration new` + `db push`) — never MCP
  `execute_sql` / `apply_migration` for DDL.
- **Always `cat supabase/.temp/project-ref` before any push**; relink via
  `supabase link --project-ref <correct>` if drifted. The main repo's link persists
  across sessions and can drift to **prod** — unverified pushes land there silently.
  `supabase/.temp/` is gitignored, so worktrees inherit NO link state: a worktree
  agent's first action MUST be `supabase link --project-ref <platform-project-ref>`
  (platform development DB - currently used as staging/prod — the ref from `.env.local`).
- **`supabase db push` prompts interactively** — never run it in a background shell
  (it hangs); run foreground and answer the prompt.
- **Function search_path:** all new PL/pgSQL functions MUST include
  `SET search_path = public, extensions` — this holds for the `api`-schema
  INVOKER wrappers/entrypoints too (ID-115). Do **not** add `api`: it is the
  Data-API *exposed* schema (`config.toml schemas = ["api"]`), which is
  orthogonal to name resolution. Function bodies reference `public.*` base
  tables + sibling fns, so `public, extensions` is the complete resolution path.
  Exposure is the boundary; search_path is the plumbing.
- **Embeddings:** `vector(1024)` (text-embedding-3-large); serialise with
  `JSON.stringify(embedding)` for RPC vector params, not a raw array. Canonical
  constants: `lib/validation/schemas.ts`.
- **RLS** is role-based via `get_user_role()`.
- **No client/counterparty names in migration filenames or any committed artifact**
  (IP leak) — enforced by the `ip-leak-filename-guard` hook against the private
  denylist (`$KH_PRIVATE_DOCS_DIR/.config/ip-denylist.txt`).
- **Types regen after schema change (ID-115: `--schema public,api`):**
  `/opt/homebrew/bin/supabase gen types typescript --project-id <platform-project-ref> --schema public,api > supabase/types/database.types.ts`
  — both schemas, deterministic order (`public` then `api`). `public` carries the
  base-table row shapes the app consumes (clients route to `api` at runtime but
  stay typed against `public` — see `lib/supabase/schema.ts`); `api` is generated
  for the drift check + docs. Never edit `database.types.ts` manually. JSONB
  domain overrides: `supabase/types/database-overrides.ts`.
- **Born-locked functions (DR-035, {61.14}):** every function in `public`/`api` is
  born with ZERO PUBLIC/anon EXECUTE — enforced by an event trigger
  (`dr035_born_locked_functions`, `20260707190500_id61_dr035_default_privileges.sql`),
  not by per-migration REVOKE discipline (that discipline demonstrably regressed
  S410→S450 within days: 34 `api` + 68 `public` fns drifted back to anon-callable
  because Supabase's platform bootstrap grants `EXECUTE` to `anon` by default for
  every `public` fn `postgres` creates). You do **not** need to hand-write a
  `REVOKE EXECUTE ... FROM PUBLIC, anon` after `CREATE FUNCTION` — the trigger does
  it automatically. Only `set_config` is exempt (INV-20 — PostgREST's RLS GUC
  setter, the sole intended anon entrypoint); if you author a function that
  genuinely needs anon EXECUTE, that is almost certainly a product-level decision,
  not a migration-authoring default — escalate rather than working around the
  trigger. `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`
  does **not** suppress this on its own (verified empirically on staging, {61.14}
  — REVOKEing a grant that was never explicitly present in the default-ACL row is
  a no-op; `anon`'s inherited PUBLIC access survives) — the event trigger is the
  load-bearing mechanism, default privileges are defense-in-depth only. If you
  add a NEW app role that creates functions in migrations (currently only
  `postgres` does), extend the trigger's `schema_name IN ('public', 'api')` scope
  check, not a fresh default-privileges statement. `generate-api-views.ts`'s
  `emitFunction()` also filters `anon` out of its mirrored-grant list (except
  `set_config`) so a drifted base-fn ACL can never re-propagate onto an `api`
  wrapper on regen. Gate: `bun scripts/check-api-view-coverage.ts` (INV-20) — wired
  into `.github/workflows/api-view-coverage.yml` (nightly + migration-path-filtered
  push, staging-scoped), no longer ad-hoc/local-only.
