---
name: handoff
description:
  Generate the continuation prompt at session close. Triggers on "handoff", "continuation prompt", "wrap up session", "create handoff". Records architectural decisions, retro records, and provides direction and context to the next Coordinator.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Session Handoff

Generates
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/continuation-prompts/continuation-prompt-ca-s{NNN}-{slug}.md`
at session close — written to, and committed in, the docs-site checkout resolved via
`KH_PRIVATE_DOCS_DIR`. It is a **routing + deltas** document for the next session.

---

## Step 1 — Dispatch the Retro Miner specialist agent

Dispatch the agent (`.claude/agents/retro-miner.md`) as a BACKGROUND TASK, to review this session's transcript, identify retro canidates with evidence pointers, and to draft the retro.

The Retro Miner will notify when the draft is ready as the background task will complete.

Review the draft, and either accept as-is and commit as part of step 6, or edit the draft first if anything is inaccurate.

While waiting for the retro draft, continue with the next steps.

## Step 2 — Update the context surfaces

Four conditional items: settled rulings become ADRs (1a), task statuses are reconciled against what actually shipped (1b), the owning initiative/project is reconciled (1c), and the change log is updated (1d).

### Step 2a — Write settled rulings as in-repo ADRs

ADRs live in `docs/adr/` and use sequential numbering: 0001-slug.md, 0002-slug.md, etc.

#### When to write an ADR

All three of these must be true:

1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will look at the code and wonder "why on earth did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If a decision is easy to reverse, skip it: you'll just reverse it. If it's not surprising, nobody will wonder why. If there was no real alternative, there's nothing to record beyond "we did the obvious thing."

If this session surfaced anything which meets the criteria review `references/writing-an-adr.md` for guidance on writing the record.

### Step 2b — Reconcile task statuses

For every task touched this session: tick shipped ACs in the task file, and flip status via ordna move, where applicable.

### Step 2c — Reconcile the owning initiative and project

Resolve every task this session touched to its owning **project**, then reconcile.

1. **Resolve.** Reverse-lookup the task id across
   `${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/initiatives/*.md` — projects sit
   both directly under `## Projects` and under `## Sub-initiatives` → `- Projects:`:

   ```bash
   grep -rn "Linked tasks:.*\b<N>\b" "$KH_PRIVATE_DOCS_DIR/src/content/docs/ledgers/initiatives/"
   ```

   Failing that, fall back to the task file's `initiative:` slug, matched against the
   slugified initiative `title:` — snippet in
   `.claude/skills/handoff/references/initiative-resolution.md` §2.
2. **Reconcile status against what actually shipped.** One line per project:
   *advanced* (name the new status) or *unchanged* (name the reason). Statuses: `idea`
   `proposal` `backlog` `discovery` `accepted` `ready` `paused` `in-progress`
   `maintenance` `completed` `cancelled`. Advance only on shipped evidence — merged SHA
   or ticked ACs. A `completed` project that took new work is a
   **flag, not an edit**: re-opening it or minting a successor is a mint decision.
3. **Write back** only what step 2 marked *advanced* — the `[status]`, and the `Summary`
   line if it is now wrong. Adding the task id to `Linked tasks:` is in scope when the
   task is plainly that project's work; minting a project or initiative is **not**.
   Commit with the docs-site commit in Step 6.
4. **Unowned is the common path, not an error.** Most task files resolve to no initiative
   by either route. Record *"unowned"* on the line, carry it into *Session focus* as an ownership gap, and do not
   backfill the ledger from the handoff.

### Step 2d — Change-log pass

1. From the docs-site root, run `bun run changelog:generate`. This
   harvests SCHEMA migration adds, REGISTER events, and any `CHANGELOG-<SURFACE>:`
   lines already carried in merged-PR bodies or `main` commit trailers.
2. Author what the generator cannot infer: for each PRODUCT or WORKFLOW change this
   session shipped that has no harvested entry, add a `CHANGELOG-PRODUCT:` /
   `CHANGELOG-WORKFLOW:` trailer to the closing docs-site or public-repo commit (one
   line, present tense, no state restatement — the next generator run harvests it).
3. Commit the regenerated shard(s) + index with the session-close commit. The
   integrity gate (`bun run changelog:check`) fails CI if the index is left stale.

---

## Step 3 — Confirm next-session focus

Confirm before drafting (ask Liam if unsure):

1. What did this session complete / leave in-flight?
2. The next session's purpose (≤ 3-4 areas)?
3. Which initiative/project does that purpose sit under (Step 2c)?

---

## Step 4 — Write the prompt (target 60-80 lines)

Write to the docs-site checkout (resolve `KH_PRIVATE_DOCS_DIR` first):
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/continuation-prompts/continuation-prompt-ca-s{NNN}-{slug}.md`

Fill in the form in `references/prompt-template.md` — keep its section order; each
section's inline rule says when to omit it.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Filename uses the highest existing number + 1. 

---

## Step 5 — Write the session diary entry (mempalace_diary_write)

Call `mempalace_diary_write` with `agent_name: "claude"` (→ the curated
`wing_claude` diary), `topic: "S{NNN}"`, and an AAAK-compressed entry:

```
SESSION:{YYYY-MM-DD}.S{NNN}({branch/slug})|{what shipped: task ids + SHAs}|{what settled: DR ids / rulings}|{what broke or blocked}|{carry}|★–★★★★★
```

One entry per session; facts over narrative; entity codes and `{N.M}` refs as
in prior entries (`mempalace_diary_read` shows the house style).

**On `-32001 Peer MCP writer active`** submit the entry as a daemon job instead — single-writer safe, lands when the queue drains:

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

Only if BOTH the MCP tool and the daemon are down is the entry **owed** — record that in the continuation prompt's *Session Carry* so the next session lands it.

---

## Step 6 — Commit and push

The commit + push target the docs-site checkout, not the Canonical Platform
repo. Use the explicit `--git-dir`/`--work-tree` form so the op runs against
docs-site regardless of CWD:

```bash
DOCS="${KH_PRIVATE_DOCS_DIR}"
git --git-dir="$DOCS/.git" --work-tree="$DOCS" \
  add src/content/docs/continuation-prompts/continuation-prompt-ca-s{NNN}-*.md
git --git-dir="$DOCS/.git" --work-tree="$DOCS" \
  commit -m "docs: S{NNN} continuation prompt — {slug}"
git --git-dir="$DOCS/.git" --work-tree="$DOCS" push
```

---