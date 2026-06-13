# Supabase / Migrations — directory context

- **DDL via CLI only** (`supabase migration new` + `db push`) — never MCP
  `execute_sql` / `apply_migration` for DDL.
- **Always `cat supabase/.temp/project-ref` before any push**; relink via
  `supabase link --project-ref <correct>` if drifted. The main repo's link persists
  across sessions and can drift to **prod** — unverified pushes land there silently.
  `supabase/.temp/` is gitignored, so worktrees inherit NO link state: a worktree
  agent's first action MUST be `supabase link --project-ref turayklvaunphgbgscat`
  (staging).
- **`supabase db push` prompts interactively** — never run it in a background shell
  (it hangs); run foreground and answer the prompt.
- **Function search_path:** all new PL/pgSQL functions MUST include
  `SET search_path = public, extensions`.
- **Embeddings:** `vector(1024)` (text-embedding-3-large); serialise with
  `JSON.stringify(embedding)` for RPC vector params, not a raw array. Canonical
  constants: `lib/validation/schemas.ts`.
- **RLS** is role-based via `get_user_role()`.
- **No client/counterparty names in migration filenames or any committed artifact**
  (IP leak) — enforced by the `ip-leak-filename-guard` hook against the private
  denylist (`$KH_PRIVATE_DOCS_DIR/.config/ip-denylist.txt`).
- **Types regen after schema change:**
  `/opt/homebrew/bin/supabase gen types typescript --project-id rovrymhhffssilaftdwd --schema public > supabase/types/database.types.ts`
  — never edit `database.types.ts` manually. JSONB domain overrides:
  `supabase/types/database-overrides.ts`.
