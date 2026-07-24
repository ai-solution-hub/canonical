---
name: sync-intent-notes
description:
  Move an Intent workspace's on-disk notes into the matching docs-site
  specs/id-N-<slug>/notes/ folder — preserving a task's working artefacts
  point-in-time when a workspace or wave closes. Wraps the deterministic
  scripts/sync-intent-notes.ts (copy *.md, normalise frontmatter YAML, rewrite
  intent:// links to relative ./<id>.md, hash-skip unchanged, denylist-scan
  bodies for IP leaks) and adds the judgment layer — triaging leak hits and
  dangling refs with the owner. Use this whenever an Intent workspace is
  closing, a wave lands, or the owner says "sync the notes", "preserve the
  workspace notes", "move notes into the spec folder", or the handoff checklist
  reaches its notes-sync step. Chain to it from /handoff at session close.
allowed-tools: Read, Bash, Grep, Glob
---

# Sync Intent notes → docs-site

Intent stores each workspace's notes as plain markdown on disk
(`<workspace>/.workspace/notes/*.md` — UUID-named notes + a `spec.md`, with
`.meta/` machine noise alongside). Those notes are a task's real working memory,
but they only live in the ephemeral Intent workspace. When work lands, they need
to be preserved in the durable docs-site spec folder for the task
(`${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/id-N-<slug>/notes/`) — the same
preserve-then-compact cadence as the id-165 OQ-4 flow. This is point-in-time
preservation when work lands, **not** continuous mirroring.

The heavy lifting is deterministic and lives in the script; your job is the
judgment the script deliberately refuses to make on its own — deciding what to
do about IP-leak hits and links that no longer resolve.

## When to run

- An Intent workspace is closing, or a wave/task has landed and you want its
  notes preserved.
- The `/handoff` checklist reaches its notes-sync step (chain to this skill
  there).
- The owner asks to sync / preserve / move workspace notes.

It is safe to run any time: re-runs are idempotent (a note whose transformed
output already matches the target is skipped), so running it "just in case"
costs nothing.

## How to run

Invoke the script with the Intent workspace path. Omit the target and it is
resolved from `workspace.json`'s `branch` (e.g. `id-165-ordna-adoption-kickoff`
→ the `specs/id-165-*` spec dir):

```bash
bun run scripts/sync-intent-notes.ts <workspace-path> [id-N | id-N-slug] [--dry-run]
```

- `<workspace-path>` — the Intent workspace root (the dir holding
  `.workspace/`), e.g. `~/intent/workspaces/<name>`. A `.workspace` dir or a
  notes dir directly also work.
- `[id-N | id-N-slug]` — optional target override. Pass `id-165` to resolve the
  spec dir by prefix, or a full `id-165-ordna-adoption` slug to pin it exactly.
  Needed only when the branch is unparseable or the prefix is ambiguous (the
  script tells you which).
- `--dry-run` — report the plan and the leak/ref findings without writing. Reach
  for this first when you are unsure what will move.

The docs-site root is resolved from `KH_PRIVATE_DOCS_DIR`; the IP denylist from
`KH_IP_DENYLIST_PATH` (falling back to
`${KH_PRIVATE_DOCS_DIR}/.config/ip-denylist.txt`).

Recommended: run `--dry-run` first, resolve any findings below, then run for
real.

## Reading the result

The script prints a per-run summary and uses exit codes so you know whether it
needs you:

- **exit 0** — clean. Reports `created / updated / unchanged / blocked` counts.
  `unchanged` on a re-run is the expected no-op. Nothing more to do.
- **exit 1** — one or more notes hit the IP denylist. Those files were **not**
  written; every other file synced normally. This needs triage (below).
- **exit 2** — a usage / resolution problem (no notes dir found, ambiguous or
  missing spec dir). The message says what to pass; usually an explicit
  `id-N-slug` argument.

## Triage — the judgment layer

### IP-leak hits (exit 1)

The script scans each note's full content (frontmatter + body) against the
denylist because the existing `ip-leak-filename-guard.sh` only checks filenames,
and note bodies are free text that can name a client. A blocked note is listed
with the term(s) it matched and is left unwritten.

For each blocked note, look at the actual match and decide with the owner:

- **True leak** — the note names a client/counterparty that must not enter the
  docs-site. Edit the source note in the Intent workspace to remove/redact the
  term, then re-run. Do not hand-edit the target — the next run would re-block.
- **False positive** — the denylist term appears innocently (a substring of an
  unrelated word). Surface it to the owner; the fix is the denylist's problem,
  not this note's. Do not bypass the block to force the write.

Never work around a block by writing the file yourself — the whole point of the
leak scan is that a human sees the hit before the content lands.

### Dangling refs (WARN)

Intent links (`intent://local/{task,note}/<id>`) are rewritten to relative
`./<id>.md` links. A short link id is resolved to the full note UUID when
exactly one source note matches; anything left unresolved is reported as a
`WARN dangling refs` line. These do not block the sync — the link simply points
at a note that is not in this folder (often a cross-workspace reference). Note
them for the owner; only act if a ref was expected to resolve.

## Report back

After running, tell the owner concisely: how many notes moved (created/updated),
how many were unchanged, any leak hits and how you resolved them, and any
dangling refs. If nothing moved because everything was already in sync, say so —
that is a healthy re-run, not a failure.
