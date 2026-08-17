# Issue tracker: Ordna (private docs-site task ledger)

Issues live as **ordna** task files — one markdown file per task at
`${KH_PRIVATE_DOCS_DIR}/tasks/id-N.md` (the private knowledge-hub-docs-site repo,
not this one). File format, status model, tag vocabulary, and write discipline:
`${KH_PRIVATE_DOCS_DIR}/tasks/AGENTS.md` — the single home for ledger conventions.
This file only maps the engineering skills' verbs onto it.

## When a skill says "fetch the relevant ticket"

Plain file read — no CLI needed: `cat "$KH_PRIVATE_DOCS_DIR/tasks/id-165.md"`

## When a skill says "publish to the issue tracker"

`cd "$KH_PRIVATE_DOCS_DIR" && ordna create "<title>" -t <tags>` — then add
provenance by direct file edit (`session_refs`, `cross_doc_links`, `status_note`,
a `## Goal` naming the origin) and run the placement ladder in `tasks/AGENTS.md` §6.
New items default to `backlog`.

## Rules that bind skills here

- Every `ordna` invocation runs from `$KH_PRIVATE_DOCS_DIR` (no `--cwd` flag).
  Non-interactive verbs only — bare `ordna` / `ordna board` hang the shell.
- Body edits and deletions are direct file operations; no CLI verb exists.
- Workers never write `status: done` — the Coordinator alone closes a task,
  via `ordna move <id> done` so the dependency gate fires.
- `## Progress` is append-only; task files hold pointers, not plans (~120-line soft cap).
- Triage state is recorded as ordna `tags:` — see `triage-labels.md`.
