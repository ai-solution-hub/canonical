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

## Step 1 — Write back to the ledgers

Three write-backs, in order, before anything else: settled rulings become ADRs (1a),
task statuses are reconciled against what actually shipped (1b), and the owning
initiative/project is reconciled (1c). Everything downstream — the retro, the prompt —
cites this state, so it has to be true first.

### Step 1a — Write settled rulings as in-repo ADRs

**One file per decision, in the canonical repo at `docs/adr/`** (DR-155, executed S569).
The docs-site Decision Register is closed — its files stay resolvable as history; never
add an entry there.

1. **Admission test — both must pass, or it is not a decision.** (a) Would a future session
   re-flag, re-implement, or re-litigate this if it weren't written down? (b) Is it
   ADR-shaped — hard to reverse, surprising, a real trade-off? A how-to, a "landed at commit
   X", a rule already enforced by a lint/test/CI gate, or an observation all fail — route
   those to a runbook, a `CLAUDE.md`, the task file, or the retro (Step 2).
   **Scope gate (DR-155):** ADRs are platform operational/architectural by definition —
   model-level content is a PRD amendment (owner act, diet R3); client-specific or
   commercial content routes to the PRD's subordinate docs, never an ADR.
2. **Allocate the next number** = highest existing `docs/adr/` file + 1. Never re-issue.
3. **Write** `docs/adr/NNNN-<slug>.md` — Context / Decision / Alternatives considered /
   Consequences. One to three sentences for the ruling; link the spec or commit for depth.
   The repo is PUBLIC (ADR 0006): current-truth only — no client names, tokens, or
   private-ledger archaeology (the DR-129 authored-fresh discipline).
4. **Supersession is bidirectional.** The new ADR names what it supersedes; the old file
   gains a superseded-by banner. Never delete an ADR file.
5. **Commit** the ADR with the session's canonical docs commit.

Boundary: an architectural decision → an ADR; an observation / friction → the retro
(Step 2). Skip if the session settled nothing.

When a new ADR **supersedes** an existing ADR or legacy `DR-NNN` (or this session flipped a
Task/spec state that downstream docs assert), run the docs-site `sync-ledger-context`
skill — or flag it in *Session deltas* — so docs carrying the superseded assertion get a
*Ledger drift* stamp instead of silently going stale.

### Step 1b — Reconcile task statuses

For every task touched this session: flip status via ordna move (done is Coordinator-only, dependency-gated), refresh status_note + session_refs, and tick shipped ACs in the task file. The continuation prompt must never carry state the ledger contradicts.

**Verify before you flip.** For a branch-based subtask, confirm its named symbols exist
on `main` (`git cat-file -e main:<path>`, run in the repo that owns the file — Canonical
for code, the docs-site for docs) before moving it to done — a done-checkbox over an
unlanded branch loses the work. Not on `main` ⇒ status stays open and the branch is named
in `status_note`. Canonical home for this rule is
`${KH_PRIVATE_DOCS_DIR}/tasks/AGENTS.md` §5; this is its session-close mirror.

### Step 1c — Reconcile the owning initiative and project

The ledger's strategic layer only stays true if session close writes back to it.
Resolve every task this session touched to its owning **project**, then reconcile.

1. **Resolve.** Reverse-lookup the task id across
   `${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/initiatives/*.md` — projects sit
   both directly under `## Projects` and under `## Sub-initiatives` → `- Projects:`:

   ```bash
   grep -rn "Linked tasks:.*\b<N>\b" "$KH_PRIVATE_DOCS_DIR/src/content/docs/ledgers/initiatives/"
   ```

   Failing that, fall back to the task file's `initiative:` slug, matched against the
   slugified initiative `title:` — snippet in
   `.claude/skills/start-session/references/initiative-resolution.md` §2.
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
4. **Unowned is the common path, not an error.** Most task files resolve to no initiative
   by either route. Record
   *"unowned"* on the line, carry it into *Session focus* as an ownership gap, and do not
   backfill the ledger from the handoff.

## Step 2 — Retro-authoring assist (candidate mining → Coordinator authors)

### Step 2a — Dispatch the Retro Miner specialist agent

Dispatch the agent to review this session's transcript and to return a
**RANKED retro-candidate list** with evidence pointers. Each candidate is one line: rank,
one-sentence finding, and an evidence pointer (transcript `file:line` and/or
`agent-<hash>`).

**The brief must carry the transcript path — resolve it, do not ask for it.** Claude Code
writes one JSONL per session under `~/.claude/projects/<cwd-slug>/`, where the slug is the
session's cwd with every `/` and `.` replaced by `-`. The live session's file is the most
recently written one:

```bash
SLUG=$(pwd | sed 's|[/.]|-|g')
ls -1t "$HOME/.claude/projects/$SLUG"/*.jsonl | head -1
```

Run it from the session's own cwd (a worktree gets its own slug). If the directory is
missing or empty, say so and skip the dispatch rather than sending the agent out without
a path — a miner with no transcript invents findings.

### Step 2b — Coordinator authors + durably WRITES the retro

You read the ranked candidates, and author the session's retro record if there are findings worth recording.

`${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/retros/retro-template.md` holds the shape.

`id` is the ordna task ID. Required scalars: `id` (id-N), `session_id` (SNNN),
`date` (YYYY-MM-DD), `track`; the six category arrays + `session_refs` /
`commit_refs` / `cross_doc_links` default to empty when omitted.

**Findings feed the queue, not the shelf.** A retro is analysis, not a
work surface — nobody proactively re-reads it. Every actionable finding that
survives authoring (process fix, code defect, doc rot) ALSO becomes an ordna
backlog item via the finding hand-off path (`tasks/AGENTS.md` §5), tagged
`needs-triage`, with `cross_doc_links` pointing back at the retro record. The
`/triage` skill (see `docs/agents/triage-labels.md`) processes that queue on
pickup. A finding recorded only in the retro is a defect of this step.

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

**On `-32001 Peer MCP writer active`** (expected here — peer writers are
normally live and the guard rarely clears): do NOT retry the MCP tool and do
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

## Step 2d — Scratch migrate-or-confirm gate

`.user-scratch/` **and `.lavish/`** are gitignored. Anything left in either at
session close is invisible to a fresh clone and to every other machine, and
every citation to it is a promise the repository cannot keep.

So each file this session created or modified in either directory leaves the
session in one of two states, never a third:

- **migrated** to a tracked home — a spec's `notes/` (working artefact for a
  task), or dated `reports/` (point-in-time audit, analysis, board, log); or
- **confirmed as scratch by Liam** — genuinely disposable, and he has said so.

List the candidates **in the Canonical repo** — both directories live there, and the
docs-site has a `.user-scratch` of its own that this pass is not about (substitute the
session's own start time; `-mtime -1` is the fallback when it is not to hand):

```bash
CANON="${KH_PUBLIC_REPO_DIR:-$KH_PRIVATE_DOCS_DIR/../canonical}"
find "$CANON/.user-scratch" "$CANON/.lavish" -type f \
  -newermt "YYYY-MM-DD HH:MM" -not -name '.DS_Store'
```

**`.lavish/` boards migrate to the docs-site `reports/` as `s<NNN>-<slug>.html`**,
session-prefixed. They are decision and OQ surfaces — among the densest
ratification records the project produces — so "confirmed as scratch" is the rare
disposition here, not the default. Rehoming is typically partial, and a
filename-exact check under-reports it: **compare by content hash, not by name.**

Migrating a board is what makes it *recallable*: the palace mines
`canonical/.lavish` only via `--include-ignored`, and once a board is rehomed the
`canonical/.lavish` drawers become orphans pointing at a deleted path. The
docs-site side is carved out of that repo's `*.html` exclusion precisely so
the rehomed copy is mined. Rehome, re-mine, then prune the orphans — in that
order, never the reverse.

How a board is *authored* is a separate, durable surface: the docs-site runbook
`runbooks/lavish-ruling-boards.md` holds the control rules a board must satisfy.
Link it from the prompt where a next session is told to build one; never restate
its rules in a prompt.

**Standing exception: `main_session_output.md`, at the root of the scratch
directory.** Transient by design — it exists only when a session failed, as
context for the follow-up session. It is never migrated and never needs
confirming.

(Written without joining directory and filename on purpose: the
guard below fails any tracked file that spells a `.user-scratch/` file path,
and its prescribed fix — migrate the file, repoint the citation — cannot
apply to a file that is transient by design. Naming the file separately keeps
the guard at full strength over the rest of this document. Do not "tidy" it
back into one path.)

For each hit, ask the question the CI guard encodes: **did anything I wrote this
session cite this file?** A tracked file citing a `.user-scratch/` path is the
defect the guard exists to catch — migrate the file and repoint the citation.
Present the list to Liam with a proposed disposition per file; he confirms the
scratch ones. Do not delete anything at this step — an unmigrated, unconfirmed
file carries into *Session Carry* rather than disappearing.

The guard itself is `__tests__/docs/user-scratch-citations.test.ts` (mirrored in
the docs-site). It enforces the rule only on **current-state** surfaces; point-in-time
surfaces (`reports/`, `ledgers/`, `continuation-prompts/`, spec `notes/`) may cite
scratch, because they describe a moment rather than claiming to be current.

---

## Step 2e — Change-log pass

1. From the docs-site root, run `bun run changelog:generate` (needs the public-repo
   sibling checkout — set `KH_PUBLIC_REPO_DIR` if it is not at `../canonical`). This
   harvests SCHEMA migration adds, REGISTER events, and any `CHANGELOG-<SURFACE>:`
   lines already carried in merged-PR bodies or `main` commit trailers.
2. Author what the generator cannot infer: for each PRODUCT or WORKFLOW change this
   session shipped that has no harvested entry, add a `CHANGELOG-PRODUCT:` /
   `CHANGELOG-WORKFLOW:` trailer to the closing docs-site or public-repo commit (one
   line, present tense, no state restatement — the next generator run harvests it).
   Grammar + surface definitions: docs-site `AGENTS.md` §6.
3. Commit the regenerated shard(s) + index with the session-close commit. The
   integrity gate (`bun run changelog:check`) fails CI if the index is left stale.

---

## Step 3 — Confirm next-session focus

Confirm before drafting (ask Liam if unsure):

1. What did this session complete / leave in-flight?
2. The next session's purpose (≤ 3-4 areas)?
3. Which initiative/project does that purpose sit under (Step 1c), or is it unowned?

---

## Step 4 — Write the prompt (target 60-80 lines)

**Deltas + mechanical state only.** Settled state lives in `reference/platform-prd.md`,
`reference/entity-glossary.md`, and the post-disposition register — never restate it in
the prompt; point at it. A prompt line that repeats something a north-star doc already
says is a defect, not thoroughness.

Filename uses the highest existing number + 1. 

Write to the docs-site checkout (resolve `KH_PRIVATE_DOCS_DIR` first):
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/continuation-prompts/continuation-prompt-ca-s{NNN}-{slug}.md`

Fill in the form in `references/prompt-template.md` — keep its section order; each
section's inline rule says when to omit it.

---

## Step 4b — Mechanical state generator

Run the read-only generator and paste its block into the prompt's *Mechanical state*
section. The script lives in the **Canonical repo**, not the docs-site — and Step 2e left
you at the docs-site root, so address it explicitly rather than relying on cwd:

```bash
bash "${KH_PUBLIC_REPO_DIR:-$KH_PRIVATE_DOCS_DIR/../canonical}/scripts/session-close-report.sh"
```

It emits branch/HEAD, named worktrees, unregistered Intent workspace checkouts,
open PRs + CI (`gh-axi`), and index freshness.

**Then capture the shared-state facts the generator cannot see** (they feed the
prompt's *Parallel lanes & shared state* section — a fresh session needs them
and cannot derive them from the ledger):

```bash
git -C "$KH_PRIVATE_DOCS_DIR" status --short   # foreign lanes' uncommitted files
mempalace daemon status; mempalace repair-status 2>&1 | grep -m1 status
ps aux | grep -E 'mempalace-mcp' | grep -v grep | wc -l   # live peer writers
```

Uncommitted docs-site files from another lane are that lane's property — name
them in the prompt so the next session neither commits nor clobbers them.

---

## Step 5 — Commit and push

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

## Quality checklist (before presenting)

- [ ] Routing + deltas only — no task state, per-WP specs, file ownership, or
      session-history recaps reproduced (those are pointers).
- [ ] No emojis; plain English (Liam-readable); all paths repo-relative.
- [ ] Total length ≤ ~80 lines (longer needs explicit justification).
- [ ] New architectural decisions written to the Decision Register.
- [ ] Diary entry written (Step 2c) — or recorded as owed in *Session Carry*.
- [ ] Owning initiative + project reconciled (Step 1c); *Session focus* names
      them, or records the ownership gap.