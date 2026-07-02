---
name: run-canonical
description: Launch recipe for the Canonical Next.js app locally. Use when the /run or /verify skill needs a deterministic local launch path for Canonical — install commands, environment setup, the launch command, and the port to observe — instead of re-deriving the dev-server invocation each time. Also use when a human asks how to start the Canonical dev server locally.
---

# Run Canonical (launch recipe)

This is a **launch recipe**, not a general-purpose skill. It captures the exact
sequence to bring the Canonical Next.js app up locally so that `/run` and
`/verify` have one deterministic launch path and do not re-derive it per
invocation. Keep it tight: install → environment → launch → observe.

Canonical sources cross-checked: the CLAUDE.md Commands table and
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/runbooks/local-development.md`.
If either diverges from this recipe, those are authoritative — update this file.

## What launches

- **App:** Canonical — Next.js 16 (App Router) via Turbopack.
- **Port:** `3000`. **URL to observe:** `http://localhost:3000`.
- **Backend:** Supabase. Local dev hits the Platform **staging** branch by default
  (the staging project ref recorded in `.env.local`) — never prod. Prod is
  opt-in only.

## Prerequisites

- `bun` installed (the project's package manager and task runner — use `bun`,
  not `npm`/`pnpm`).
- The Supabase CLI at `/opt/homebrew/bin/supabase` (use the canonical path; a
  `supabase` on `PATH` may be a different version).
- A `.env.local` file at the repo root pointing at staging (see below).
  `.env.local` is gitignored, so a fresh clone or a worktree subagent will not
  have one — it must be present before the app can authenticate against
  Supabase.

## Step 1 — Install dependencies

```bash
bun install
```

Run once after a clone, after a lockfile change, or when modules are missing.

## Step 2 — Environment (`.env.local`, staging by default)

The app reads `.env.local`. Post-flip, **staging is the default** — the file
points at the staging Supabase branch. The launch- and
runtime-critical variables (use the staging values recorded in `.env.local`):

```text
# Supabase — STAGING (default)
SUPABASE_URL=https://<platform-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_URL=https://<platform-project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_iqF62OuENdcmScqijL1uZA_VUlcLOyB
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_iqF62OuENdcmScqijL1uZA_VUlcLOyB
SUPABASE_SERVICE_ROLE_KEY=<staging service-role JWT>
POSTGRES_PASSWORD=<staging DB password>

# App URL + client (must be set or BRANDING falls back and corrupts holder derivation)
NEXT_PUBLIC_APP_URL=https://canonical-platform-git-staging-tw-group.vercel.app
NEXT_PUBLIC_CLIENT_ID=<client-id>   # use the value from .env.local

# Upstream APIs (same values either env)
ANTHROPIC_API_KEY=<key>
OPENAI_API_KEY=<key>
```

`NEXT_PUBLIC_CLIENT_ID=<client-id>` (use the value recorded in `.env.local`) is load-bearing: if it is missing, branding falls
back to "Canonical" and downstream holder derivation breaks. Full variable
matrix + how to source each staging value:
`local-development.md` §2 (`${KH_PRIVATE_DOCS_DIR}/src/content/docs/runbooks/local-development.md`).

## Step 3 — Link the Supabase CLI to staging

Only needed for CLI work that reads `supabase/.temp/project-ref` (`db push`,
`migration new`, `gen types`) — the dev server itself reads `.env.local`, not
the CLI link. The CLI link is independent of `.env.local` and can silently go
stale (or point at prod from a prior session), so link explicitly:

```bash
/opt/homebrew/bin/supabase link --project-ref <platform-project-ref>
cat supabase/.temp/project-ref   # expect: the staging project ref from .env.local
```

Worktree subagents inherit no link state (`supabase/.temp/` is gitignored), so
this is the recommended first action in a worktree.

## Step 4 — Launch the dev server

```bash
bun dev
```

Starts Next.js with Turbopack on `http://localhost:3000`. Run it in the
background (or a dedicated pane) so you can keep observing while it serves.

If the server OOMs or behaves oddly after a dependency or config change, clear
the Next cache and relaunch:

```bash
bun run dev:clean
```

## Step 5 — Observe

Open / navigate `http://localhost:3000` and confirm the changed surface
actually renders and behaves. For `/verify`, this is the runtime-behaviour
check that complements (does not replace) the spec Checker.

## Opt-in: hitting prod

Staging is the safe default. Targeting prod is deliberate and per-invocation —
never a global flip. Use a script's `--env=prod` flag (top-10 scripts) or an
explicit env override at invocation, per
`local-development.md` §3 (`${KH_PRIVATE_DOCS_DIR}/src/content/docs/runbooks/local-development.md`). Do not
edit `.env.local` to prod for a routine local launch.

## One-shot launch sequence

```bash
bun install                                                      # deps (first run / lockfile change)
/opt/homebrew/bin/supabase link --project-ref <platform-project-ref>  # staging link (CLI work)
bun dev                                                          # Turbopack → http://localhost:3000
# observe http://localhost:3000
```
