---
name: propagate-workflow-change
description: Propagate ONE dev-workflow change across every dev-lifecycle skill and agent that describes the old behaviour, so context continuity does not silently break session to session. Use this whenever workflow tooling, a data shape, or a process step changes and the skills/agents that reference it may now be stale — e.g. after adding or renaming a ledger-cli command or flag, editing a task-list.json / product-backlog.json schema field, adding a hook, retiring or renaming a skill, or moving a ledger path. It runs a grep-driven sweep of the workflow surface (canonical `.claude/skills` + `.claude/agents`, docs-site `.claude/skills` + `CLAUDE.md`), patches stale references minimally in each file's own voice, and reports per-file fixes with anything ambiguous flagged for the owner. Distinct from update-skill (author ONE skill) and audit-skill (de-drift ONE file): this is the cross-cutting, many-file propagation of a single change. Reach for it on phrases like "propagate this change", "which skills reference the old X", "the workflow changed, update the skills", or after landing a batch of ledger/tooling changes.
---

## Step 0 — Mark sentinel (REQUIRED before any skill/agent edit)

Before editing anything under `.claude/skills/` or `.claude/agents/`, run:

```bash
mkdir -p "$HOME/.claude/.sentinels" && touch "$HOME/.claude/.sentinels/create-skill.touch"
```

The PreToolUse hook `sentinel-gated-agents-skills-edit-guard.sh` blocks Write/Edit to
`.claude/(agents|skills)/` unless an authoring-skill sentinel exists with mtime < 10 min.
Re-touch if the sweep runs long — the sentinel expires after 10 minutes.

# Propagate Workflow Change

When the dev workflow's tooling, data shapes, or process changes — a ledger-cli flag is
added, a ledger schema field is renamed, a new hook lands, a skill is retired — the
dev-lifecycle skills and agents that _describe the old behaviour_ go stale. Nothing
errors; the next session's agents just read outdated instructions and quietly diverge.
This skill makes fixing that repeatable instead of ad hoc: one change in, a
swept-and-patched surface out, with a report of exactly what moved.

**Neighbours (read one if unsure which you want):** `update-skill` authors or revises ONE
skill's SKILL.md. `audit-skill` de-drifts ONE bloated skill/agent file in place. **This**
skill is the only cross-cutting one — it carries a single change _across_ many files.

Work through the five steps in order. Don't batch-rewrite files; the whole value is
precise, voice-preserving edits that a reviewer can trust.

## Step 1 — Establish the change summary

You need a structured statement of what changed before you can find what went stale:

- **what changed** — the command / flag / field / hook / path / skill name
- **old → new behaviour** — the exact tokens, both sides (e.g.
  `append-journal <id> <text>` → `journal add <id> <text>`; or `show task <id>` now needs
  `--journal` to include journals)
- **affected surface hints** — command names, flag strings, file paths, field names to
  grep

If the invoker handed you this, confirm it and move on. If they didn't — "just propagate
what we did this session" — reconstruct it from the session context and `git diff` of the
tooling repo, write it out, and **confirm with the invoker before editing**. A wrong
change summary sweeps the wrong tokens; the confirmation is cheap insurance.

## Step 2 — Discover the stale surface

The **workflow surface** is the set of dev-lifecycle skills and agents that describe the
workflow. It is not a fixed list — discover it by grep so a newly-added skill is never
missed. Seed and check your search against `references/surface-map.md`, which records
which files depend on which tools and data shapes (keep it current — see the closing
note).

Sweep these roots:

- canonical `.claude/skills/` — the dev-lifecycle skills (start-session, handoff,
  workflow-orchestration, implement-subtask, implement-specs, session-driver-cmux,
  update-roadmap-backlog, planning-and-task-breakdown, spec-driven-implementation,
  triage-finding, and any other hit) — including their `references/` and `scripts/`.
- canonical `.claude/agents/` — task-planner, task-executor, task-checker,
  workflow-curator, code-reviewer + the shared `references/` files (shared-discipline,
  planner-reporting, …).
- docs-site `.claude/skills/` — evaluate-workflow, evaluate-findings — and docs-site
  `CLAUDE.md` where it describes workflow tooling.

Grep for **both exact and paraphrased** mentions, because prose describes tools in words
as often as it quotes them:

```bash
# exact token — the command / flag / field / path that changed
grep -rniE "append-journal|show task|--journal" <roots>
# paraphrased — the behaviour described in prose (e.g. "show dumps the full record")
grep -rniE "full (record|dump)|slice.read|journal (block|append|entry)" <roots>
```

Judge every hit — greps over-match. A "mirror" in `chrome-cdp` or a docs "mirror" of
source code is not a ledger mirror; `json.dumps` is not a ledger `dump`. Keep the
ledger-workflow hits, discard the homographs, and note the borderline ones for Step 4.

## Step 3 — Patch minimally, in each file's own voice

For each true stale reference, make the smallest edit that carries the change:

- **Replace the stale token, keep the sentence.** Swap `append-journal` for the new verb;
  do not rewrite the paragraph around it. The surrounding voice, examples, and structure
  are load-bearing and tuned per file.
- **Never touch frontmatter** (`description:`, `model:`, agent `<example>` blocks) unless
  the change is _about_ triggering — those strings are tuned for dispatch, and an old
  token there may be deliberate.
- **Never touch a `<!-- code-intel:* -->` block or any string a test in `__tests__/`
  asserts.** Grep the test suite for a distinctive string first if unsure; a pinned anchor
  is not stale drift.
- Respect the sentinel guard (Step 0). If an edit is rejected, re-touch and retry.

If a reference is genuinely ambiguous — you can't tell whether the new behaviour applies,
or the fix would change meaning — **do not guess**. Flag it for the owner in the report.

## Step 4 — Report

Return a per-file table so a reviewer can audit the sweep without re-running it:

```
# Workflow-change propagation — <one-line change summary>
## Patched
| file:line | stale reference | fix |
|-----------|-----------------|-----|
| .../start-session/SKILL.md:131 | `list task --status done --since` | `… --since` now roll-up default |
## Flagged (owner decides — not patched)
| file:line | reference | why ambiguous |
## Discarded (homographs, not this change)
- <file>: "mirror" is a CDP mirror, unrelated
```

## Step 5 — Verify

Re-grep the **old** tokens across the swept roots. The bar is zero hits — or, for every
survivor, a one-line justification (frontmatter-deliberate, test-pinned, homograph, or
flagged-for-owner). A survivor with no reason is a missed edit; go back to Step 3.

```bash
grep -rniE "append-journal|<old-token>" <roots>   # expect: only justified survivors
```

## Keep the surface-map current

When a sweep teaches you a new dependency (a skill you didn't know read `task-list.json`,
a new command in play), add it to `references/surface-map.md`. The map is what lets the
next propagation start from knowledge instead of a cold grep — it decays if you don't feed
it.
