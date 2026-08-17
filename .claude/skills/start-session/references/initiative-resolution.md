# Resolving a task's owning initiative and project

Read this when `start-session` §2c fires — spec-chain work, a promote, or new
work whose owner is unknown — or when `handoff` Step 1c needs to reconcile
ownership at session close. Skip it when the continuation prompt already names
the owning project; re-deriving it costs a directory grep and two file reads for
state you were handed.

The point is the strategic "why this Task matters", not just the tactical state.

Initiatives are plain docs-site markdown, one numbered file per initiative:
`ledgers/initiatives/<n>.md`. Projects sit at **two** levels — directly under
`## Projects`, and under `## Sub-initiatives` → `- Projects:`. Always check both
levels; some initiatives park every project one level down.

## 1. Resolve the project first

It works with or without the frontmatter key. The project is the entry whose
`Linked tasks:` includes the active id:

```bash
INIT_DIR="$KH_PRIVATE_DOCS_DIR/src/content/docs/ledgers/initiatives"
grep -rn "Linked tasks:.*\b<N>\b" "$INIT_DIR"/
```

## 2. Resolve the initiative

From the task file's `initiative:` frontmatter. The value is a **slugified
title**, not a string present in the initiative doc — grepping the slug misses
(`sdlc-workflow-orchestration` → zero hits) or is ambiguous (`core-product` →
two files). Match it against the slugified `title:` instead:

```bash
SLUG=$(sed -n 's/^initiative: //p' "$KH_PRIVATE_DOCS_DIR/tasks/id-<N>.md")
for f in "$INIT_DIR"/*.md; do
  t=$(sed -n 's/^title: //p' "$f" | head -1 | tr 'A-Z ' 'a-z-')
  [ "$t" = "$SLUG" ] && echo "$f"
done
```

## 3. Surface it, in order

The initiative **title** + intro ("why this matters"); the owning
sub-initiative's scope boundary, if the project sits under one; then the
project's **[status]**, **Summary**, and sibling **Linked tasks** — the siblings
are the work you may be about to duplicate or block.

## 4. Caveats

- **`Substrate doc`, where set, is the floor for context, not the ceiling.**
  Confirm against the task file and the Decision Register before acting on it;
  some pointers aim into `_archive/`.
- **Unowned is a common case, not an exception.** A large share of task files
  resolve by neither route. When neither resolves and the session's work makes
  ownership matter, run the mint-or-link ladder
  (`${KH_PRIVATE_DOCS_DIR}/tasks/AGENTS.md` §6) and record its verdict;
  otherwise state *"no owning initiative/project — unowned Task"* and continue.
  Do not invent an owner or halt; bulk ownership backfill belongs to the
  initiatives-ledger project.
