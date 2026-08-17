# Continuation-prompt template

The Step 4 output form. The prompt's **body addresses the next session** (the reader).
Keep the section order; each section's inline rule says when to omit it.

````markdown
---
title: "S{NNN}: {slug}"
---

# Canonical Platform - Continuation Prompt - {Next-session purpose}

_Authored at the close of S{NNN}; for the next session._

## Session focus

{3-4 lines: focus for the next session. Open by naming the owning initiative and
project — "{Initiative title} -> {project-slug} [status]" — or "unowned" where Step 1c
resolved no owner.}

## Suggested skills

{1-3 lines: name the skills the next session should invoke for this focus
(e.g. `/triage`, `/research`, `/wayfinder`, `/grill-with-docs`) and for what.
Omit when the default session protocol suffices.}

## Completed this session (Tasks + SHAs)

Task/Subtask ids + merge/PR SHA only (the ledger holds the detail; never reproduce it). Omit if nothing shipped.}

## Settled this session (Decision Register)

{New architectural decisions written to `reference/decisions/` this session —
cite the NEW ids only (e.g. `DR-011`–`DR-013`), one line each.}

## Session deltas / decisions NOT in the ledger

{Bullets: only what a fresh Coordinator cannot derive from the ordna/specs/register —
NON-binding deltas: schema/process changes, gotchas, strategic options. Omit if all information is in ordna/specs/register.}

## Session Carry

{Anything which was intended for the previous session, but wasn't completed.}

## Mechanical state (auto-generated)

{Paste the output of `bash scripts/session-close-report.sh` — branch/HEAD,
orphaned worktrees, open PRs + CI, index freshness.}

## Parallel lanes & shared state

{What OTHER live lanes hold that this prompt's reader could clobber or be
blocked by — the generator does not emit these; capture them by hand (Step 4b):
foreign uncommitted files in the docs-site checkout (name the owning lane;
"do not commit/clobber"); mempalace health (writer-lock holders, daemon state,
repair owed?); any live session/Intent workspace holding a shared singleton.
Omit only when all three are verified clean.}

## Pre-reqs (Liam)

{Only items needing Liam action before the next session starts. Omit if none.}
````
