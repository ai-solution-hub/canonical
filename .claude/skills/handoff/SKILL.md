---
name: handoff
description:
  Generate the continuation prompt at session close. Triggers on "handoff", "continuation prompt", "wrap up session", "create handoff". Records architectural decisions, retro records, and provides direction and context to the next Coordinator.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Session Handoff

Generates
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/continuation-prompts/continuation-prompt-ca-s{NNN}-{slug}.md`
at session close (the file is written to, and committed in, the docs-site checkout resolved via
`KH_PRIVATE_DOCS_DIR`). The prompt is consumed by the next session. It is a **routing + deltas** document: it points to canonical sources and carries only what is NOT already in them.

---

## Step 1 — Update the Decision Register and the Ordna Task Ledger

## Step 1a — Write settled rulings to the Decision Register

**One file per decision** (id-368). Do NOT edit `reference/decision-register.md` — it is a
GENERATED index and hand edits are overwritten on the next regen.

1. **Admission test — both must pass, or it is not a decision.** (a) Would a future session
   re-flag, re-implement, or re-litigate this if it weren't written down? (b) Is it
   ADR-shaped — hard to reverse, surprising, a real trade-off? A how-to, a "landed at commit
   X", a rule already enforced by a lint/test/CI gate, or an observation all fail — route
   those to a runbook, a `CLAUDE.md`, the task file, or the retro (Step 2).
2. **Allocate the next id** = highest ever issued + 1. **Never re-issue a number**, retired
   ones included: retired ids are files too, so a re-issue collides on disk and CI fails.
3. **Write** `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/decisions/dr-<nnn>-<slug>.md`
   with `dr:` frontmatter (`id`, `status: accepted`, `decided`, `session`, `supersedes`,
   `superseded_by`, `amends`, `tags`) and the ADR body — Context / Decision / Alternatives
   Considered / Consequences. One to three sentences for the ruling; link the spec or commit
   for depth rather than inlining it.
4. **Supersession is bidirectional.** The new decision sets `supersedes: [DR-NNN]`; the old
   file flips to `status: superseded` + `superseded_by:`. CI fails a one-sided chain.
   Retiring with no successor is `status: retired` + `retired_reason` (+
   `substance_moved_to` when the content moved rather than died). **Never delete a decision
   file** — deletion is what left 610 citations dangling and let DR-087's number be
   re-issued for an unrelated ruling.
5. **Regenerate + verify:** `cd "$KH_PRIVATE_DOCS_DIR" && bun run decisions:index && bunx
   vitest run __tests__/decision-register-integrity.test.ts`. Commit the regenerated index
   with the decision file.

Boundary: an architectural decision → a decision file; an observation / friction → the retro
(Step 2). Skip if the session settled nothing.

When a new decision **supersedes** an existing `DR-NNN` (or this session flipped a Task/spec
state that downstream docs assert), run the docs-site `sync-ledger-context` skill — or flag
it in *Session deltas* — so docs carrying the superseded assertion get a *Ledger drift* stamp instead of silently going
stale.

## Step 1b — Reconcile task statuses. 

For every task touched this session: flip status via ordna move (done is Coordinator-only, dependency-gated), refresh status_note + session_refs, and tick shipped ACs in the task file. The continuation prompt must never carry state the ledger contradicts.

**Verify before you flip.** For a branch-based subtask, confirm its named symbols exist
on `main` (`git cat-file -e main:<path>`) before moving it to done — a done-checkbox over
an unlanded branch is how {163.20} (S498) and {163.19} (S499) were both lost. Not on
`main` ⇒ status stays open and the branch is named in `status_note`. Canonical home for
this rule is `${KH_PRIVATE_DOCS_DIR}/tasks/AGENTS.md` §5; this is its session-close mirror.

## Step 1c — Reconcile the owning initiative and project

The ledger's strategic layer only stays true if session close writes back to it.
Resolve every task this session touched to its owning **project**, then reconcile.

1. **Resolve.** Reverse-lookup the task id across
   `${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/initiatives/*.md` — projects sit
   both directly under `## Projects` and under `## Sub-initiatives` → `- Projects:`:

   ```bash
   grep -rn "Linked tasks:.*\b<N>\b" "$KH_PRIVATE_DOCS_DIR/src/content/docs/ledgers/initiatives/"
   ```

   Failing that, fall back to the task file's `initiative:` slug, matched against the
   slugified initiative `title:` (`start-session` §2c step 2 has the snippet).
2. **Reconcile status against what actually shipped.** One line per project:
   *advanced* (name the new status) or *unchanged* (name the reason). Statuses: `idea`
   `proposal` `backlog` `discovery` `accepted` `ready` `paused` `in-progress`
   `maintenance` `completed` `cancelled`. Advance only on shipped evidence — merged SHA
   or ticked ACs — never on intent. A `completed` project that took new work is a
   **flag, not an edit**: re-opening it or minting a successor is a mint decision.
3. **Write back** only what step 2 marked *advanced* — the `[status]`, and the `Summary`
   line if it is now wrong. Adding the task id to `Linked tasks:` is in scope when the
   task is plainly that project's work; minting a project or initiative is **not**.
   Commit with the docs-site commit in Step 5.
4. **Unowned is the common path, not an error.** Only 126 of 354 task files resolve to an
   initiative by either route, and no `Linked tasks:` entry names an id above 163. Record
   *"unowned"* on the line, carry it into *Session focus* as an ownership gap, and do not
   backfill the ledger from the handoff.

## Step 2 — Retro-authoring assist (candidate mining → Coordinator authors)

### 2a — Dispatch the Retro Miner specialist agent

Dispatch the agent to review this session's transcript and to return a
**RANKED retro-candidate list** with evidence pointers. Each candidate is one line: rank, one-sentence finding, and an evidence pointer (transcript `file:line` and/or `agent-<hash>`).

Provide the agent with the location of the {transcript path}.

### 2b — Coordinator authors + durably WRITES the retro

You read the ranked candidates, and author the session's retro record if there are findings worth recording.

`${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/retros/retro-template.md` holds the shape.

`id` is the ordna task ID. Required scalars: `id` (id-N), `session_id` (SNNN),
`date` (YYYY-MM-DD), `track`; the six category arrays + `session_refs` /
`commit_refs` / `cross_doc_links` default to empty when omitted.

## Step 2c — Write the session diary entry (mempalace_diary_write)

Cross-session recall quality tracks diary volume, and every recall path ranks
`room='diary'` first (`runbooks/mempalace-repair.md` §10.5) — feed it at every
close. Call `mempalace_diary_write` with `agent_name: "claude"` (→ the curated
`wing_claude` diary), `topic: "S{NNN}"`, and an AAAK-compressed entry:

```
SESSION:{YYYY-MM-DD}.S{NNN}({branch/slug})|{what shipped: task ids + SHAs}|{what settled: DR ids / rulings}|{what broke or blocked}|{carry}|★–★★★★★
```

One entry per session; facts over narrative; entity codes and `{N.M}` refs as
in prior entries (`mempalace_diary_read` shows the house style).

**On `-32001 Peer MCP writer active`** (the norm on this machine — auggie's
`--mcp-auto-workspace` spawns a peer `mempalace-mcp` per Claude session and
per bg-spare, so the guard rarely clears): do NOT retry the MCP tool and do
NOT set `MEMPALACE_MCP_ALLOW_PEER_WRITER` (that opens a direct chroma writer
beside the daemon). Submit the entry as a daemon job instead — single-writer
safe, lands when the queue drains:

```bash
/Users/liamj/.local/share/uv/tools/mempalace/bin/python3 - <<'PY'
from mempalace.hooks_cli import _submit_daemon_job
job = _submit_daemon_job("diary_write", {
    "agent_name": "claude", "entry": "<AAAK entry>",
    "topic": "S{NNN}", "wing": "wing_claude"},
    priority=10, wait=False, timeout=30)
print(job)
PY
```

Verify later with `mempalace daemon jobs`. Only if BOTH the MCP tool and the
daemon are down is the entry **owed** — record that in the continuation
prompt's *Session Carry* so the next session lands it.

---

## Step 3 — Confirm next-session focus

Confirm before drafting (ask Liam if unsure):

1. What did this session complete / leave in-flight?
2. The next session's purpose (≤ 3-4 areas)?
3. Which initiative/project does that purpose sit under (Step 1c), or is it unowned?

---

## Step 4 — Write the prompt (target 60-100 lines)

Filename uses the highest existing number + 1. 

Write to the docs-site checkout (resolve `KH_PRIVATE_DOCS_DIR` first):
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/continuation-prompts/continuation-prompt-ca-s{NNN}-{slug}.md`

The prompt's **body addresses the next session** (the reader).

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

## Pre-reqs (Liam)

{Only items needing Liam action before the next session starts. Omit if none.}
````

---

## Step 4b — Mechanical state generator

Run the read-only generator and paste its block into the prompt's *Mechanical state* section:

```bash
bash scripts/session-close-report.sh
```

It emits branch/HEAD, named worktrees, unregistered Intent workspace checkouts,
open PRs + CI (`gh-axi`), and index freshness.

---

## Step 5 — Commit and push

Continuation prompts are stored in the private docs-site repo, so
the commit + push target THAT checkout, not the Canonical Platform repo. Use the
explicit `--git-dir`/`--work-tree` form so the op runs against docs-site
regardless of CWD:

```bash
DOCS="${KH_PRIVATE_DOCS_DIR}"
git --git-dir="$DOCS/.git" --work-tree="$DOCS" \
  add src/content/docs/continuation-prompts/continuation-prompt-ca-s{NNN}-*.md
git --git-dir="$DOCS/.git" --work-tree="$DOCS" \
  commit -m "docs: S{NNN} continuation prompt — {slug}"
git --git-dir="$DOCS/.git" --work-tree="$DOCS" push
```

---

## Quality checklist (before presenting)

- [ ] Routing + deltas only — no task state, per-WP specs, file ownership, or
      session-history recaps reproduced (those are pointers).
- [ ] No emojis; plain English (Liam-readable); all paths repo-relative.
- [ ] Total length ≤ ~100 lines (longer needs explicit justification).
- [ ] New architectural decisions written to the Decision Register.
- [ ] Diary entry written (Step 2c) — or recorded as owed in *Session Carry*.
- [ ] Owning initiative + project reconciled (Step 1c); *Session focus* names
      them, or records the ownership gap.