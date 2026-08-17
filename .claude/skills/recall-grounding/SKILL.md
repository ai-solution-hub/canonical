---
name: recall-grounding
description: >-
  Repo-local recall discipline for Canonical — when recall must fire, and what to do when
  the recall mechanism itself fails. Use before presenting any conclusion, plan,
  ratification, spec, or verdict that cites a task id, a DR/ADR, prior-session framing, or
  settled state; when composing a sub-agent dispatch brief's grounding context; and on any
  mempalace MCP recall error.
allowed-tools: Bash
---

# recall-grounding

Repo-local recall discipline: **when** recall must fire, and **what to do when
the mechanism itself fails**. The plugin `mempalace-recall` skill owns the
mechanism — how to call `mempalace_search` / `mempalace_kg_query` and read the
results — so read that skill for the how-to and this one for the when.

The plugin skill is plugin-managed and overwritten on update, so it cannot hold
workflow-specific protocol: never edit it to add workflow behaviour — extend
this skill instead.

## 1. Decision-point recall triggers

Recall is **not** a session-start-only ritual and **not** only a response to
a direct user question ("what did we decide?"). Run recall **before presenting**:

- any conclusion, plan, ratification, spec, or verdict,
- that cites a task id (`id-N` / `{N.M}`), a `DR-NNN` or ADR, prior-session
  framing ("we already decided…", "last time…"), or settled state.

This closes the loop where an agent presents a stale conclusion and the human
owner has to point at memory to correct it.

**Completion criterion — recall is not finished until the status check has run.**
A search result is memory; the ledger is current state, and only the ledger can
say whether what you recalled is still true. For **every** `id-N` / `{N.M}` /
`DR-NNN` the conclusion cites, read live status straight from its ordna task
file before presenting — no CLI needed (`tasks/id-N.md` is one small markdown
file, YAML frontmatter + body):

```bash
grep -m1 '^status:' "$KH_PRIVATE_DOCS_DIR/tasks/id-<N>.md"   # frontmatter status, no CLI
cd "$KH_PRIVATE_DOCS_DIR" && ordna show <id>                 # CLI equivalent (non-interactive)
```

A search with no status check is an incomplete recall, not a fast one: it is
exactly the "reopen a closed task as if it were live" defect
(`tasks/AGENTS.md` §5, "Check status before citing"). Use non-interactive verbs
only; bare `ordna` opens the TUI and hangs.

Skip recall entirely for pure greenfield work with no memory relevance (renaming
a variable, fixing a typo) — recall is decision-driven, not reflexive on every
turn.

### 1a. Session open: the continuation prompt outranks a broad search

At session open two cheaper sources have already fired: the SessionStart hook
injected a branch-seeded palace digest, and `start-session` reads the
continuation prompt in the same turn. That prompt **is** the previous session's
deltas, so a broad `mempalace_search` over the same task ids buys a confirmatory
restatement for 4–7k tokens (S570 token audit).

So at session open, do **not** run a broad search. Take one of two paths:

- **Skip it** — the prompt names the state and nothing in the hook digest
  contradicts or surprises it. Say "recall: continuation prompt + hook digest,
  no gap" and move on.
- **Narrow it to the gap** — search only what the prompt leaves open: a carry
  item with no stated resolution, a `DR-NNN`/ADR it cites but does not restate,
  or a disagreement between the prompt and the hook digest. Scope it
  (`room: "diary"`) with that one seed, never the prompt's whole task list.

Session-open only. §1's triggers are unchanged for the rest of the session, and
its status-check criterion applies to both paths above.

## 2. Diary-first + noise filtering, on every MCP recall

The palace is dominated by raw transcript mines; the curated diary
(`wing_claude`, `room='diary'`) is the highest-signal surface and is outnumbered
by orders of magnitude, so identical boilerplate outranks it on lexical match.
The SessionStart hook compensates for this; `mempalace_search` does not — so
apply the same discipline client-side on every MCP recall:

- **Rank diary results first.** Read `room`/`wing` on each hit; treat
  `room='diary'` as primary signal and transcript (`sessions` wing) hits as
  corroboration.
- **Drop noise drawers** — anything starting `CHECKPOINT:`, containing
  `Base directory for this skill`, or carrying `topic='checkpoint'`. Machine
  boilerplate, not memory.
- **Scope with `room:` / `wing:`** — these are genuine ChromaDB pre-filters, not
  post-filters. Filter freely rather than reading unscoped.

## 3. When recall degrades

On any mempalace MCP error, **do not proceed recall-blind and do not declare
memory degraded yet** — there is a lock-free sqlite path that survives outages
that take the MCP server down. Read
[references/degraded-recall.md](references/degraded-recall.md) and run it. Only
if *that* read also fails do you tell the user memory is degraded and proceed
(never block on recall).

The same reference covers the other two degraded shapes: a filtered
`mempalace_search` returning 0 or erroring where unfiltered matches (an HNSW
divergence, with a repair remedy — not a reason to stop filtering), and the
cold stores to reach for when the live palace comes up empty on older work.

## 4. Where this fits in agent briefs

Root `AGENTS.md` § Ledger protocol carries the compact form of §1 — verify live
status before citing a task, subtask, or decision-record state. This skill is
the fuller protocol behind that rule.
