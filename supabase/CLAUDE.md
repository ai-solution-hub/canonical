# Supabase / Migrations — directory context

- **DDL via CLI only** (`supabase migration new` + `db push`) — never MCP
  `execute_sql` / `apply_migration` for DDL.
- **Always `cat supabase/.temp/project-ref` before any push**; relink via
  `supabase link --project-ref <correct>` if drifted. The main repo's link persists
  across sessions and can drift to **prod** — unverified pushes land there silently.
  `supabase/.temp/` is gitignored, so worktrees inherit NO link state: a worktree
  agent's first action MUST be `supabase link --project-ref <platform-project-ref>`
  (Platform **staging** — the `PLATFORM_PROJECT_REF` from `.env.local`. Platform prod
  is a separate project; see `reference/platform-context.md` for the four-DB topology).
- **`supabase db push` prompts interactively** — never run it in a background shell
  (it hangs); run foreground and answer the prompt.
- **Migration stamps (S481 cross-lane collisions):** allocate the stamp against the
  **remote** `supabase_migrations.schema_migrations` max, not the local
  `supabase/migrations/` dir — parallel lanes share the Platform staging DB, so the
  fleet-wide pending set includes other lanes' already-applied versions. Stamps are
  time-anchored and **non-round** (`…164512`, never `…000000`; both S481 collisions
  were round numbers). Verify application by **object existence** (`to_regclass`),
  never by `supabase migration list` parity, which is version-number-blind to
  collisions. When `db push` refuses because the remote holds a version absent
  locally, adopt the other lane's migration file verbatim from its source branch —
  never `migration repair --status reverted` another lane's applied version.
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
- **Storage buckets are DECLARED, not scripted:** `[storage.buckets.*]` in
  `supabase/config.toml` (`corpus`, `documents`, `templates`, `tender-documents`,
  `onprem-backups`; `branding` is still script-created on client projects only —
  id-367). Apply with `supabase link --project-ref <ref> && supabase seed buckets
  --linked`. **`supabase config push` does NOT create buckets** — its storage leg
  carries project-level settings only, and the `Buckets` field is never read by the
  update path. Note the flag asymmetry: `config push` takes `--project-ref` and needs
  no link; `seed buckets` is `--linked`-only and does. **`config push` at the two
  long-lived Platform projects is now SAFE (S496)** via the
  `[remotes.staging]`/`[remotes.prod]` blocks — selection by `project_id` match is
  proven, each block mirrors live values so a push is a no-op until a value
  deliberately changes. Constraints: CLI >= 2.109.1 (2.108.0 dies mid-push at the
  storage leg AFTER applying auth — non-atomic), and **non-tty `config push`
  AUTO-APPLIES with no confirmation and no dry-run** — never run it at a ref with
  no matching remote block (base `[auth]` is local-dev-shaped, `site_url`
  127.0.0.1). Bucket reach is split: git-triggered preview branches (PR required)
  DO seed all declared buckets; dashboard/CLI-created branches get ZERO (Seed +
  Configure are git-PR-integration-exclusive). CI E2E lanes run the LOCAL stack
  on the runner (DR-096, {365.5}) — `supabase db reset` creates every declared
  bucket there; the psql-replay `scripts/e2e-ephemeral-branch.ts` path is
  retired and deleted.
- **RLS** is role-based via `get_user_role()`.
- **Table grants + policy roles (id-347, S492/S493):** the squash baseline set
  `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon`
  (`20260617130000_squash_baseline.sql:13745-13747`), so 70 public tables were born
  anon-readable over the public Data API. `20260724233500_id347_anon_lockdown.sql`
  retracts it on `public` + `api`. **Unlike the function case below there is NO event
  trigger here** — this is authoring discipline, and a migration that re-adds a
  default GRANT re-opens the surface silently. Every new SELECT policy MUST name its
  roles explicitly (`TO authenticated, service_role`): six policies written with no
  `TO` clause targeted PUBLIC with `USING (true)`, which was the actual exposure. No
  CI gate covers this — `check-api-view-coverage.ts` INV-10 asserts only that anon has
  no *write* on api views, and anon SELECT is explicitly permitted by that invariant,
  which is why nothing caught id-347.
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
- **Born-locked functions (DR-035, {61.14}) — function EXECUTE only; tables are the
  bullet above, with a different mechanism:** every function in `public`/`api` is
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
