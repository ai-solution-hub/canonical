---
name: recall-grounding
description: >-
  Workflow-specific recall discipline for Canonical — WHEN to recall and how to
  stay grounded when recall degrades. Fire recall BEFORE presenting any
  conclusion, plan, ratification, spec, or verdict that cites a task id, a
  DR-NNN, prior-session framing, or settled state, not only at session start or
  in response to a direct user question. On a mempalace MCP `-32002` /
  integrity-check refusal (or any MCP recall error), fall through to the
  lock-free `mode=ro&immutable=1` sqlite FTS read instead of proceeding
  recall-blind. Use whenever composing a sub-agent dispatch brief's grounding
  context, whenever about to state a conclusion that cites prior work
  or decisions, or whenever `mempalace_search`/`mempalace_kg_query` errors.
  Cross-references the plugin `mempalace-recall` skill, which owns the generic
  palace-search mechanics (`mempalace_search`/`mempalace_kg_query` how-to) —
  this skill owns the discipline layered on top of it.
allowed-tools: Bash
---

# recall-grounding

Repo-local, workflow-specific recall discipline. This skill answers two
questions the generic palace mechanism doesn't: **when** must recall fire, and
**what to do when the mechanism itself fails**. It does not duplicate the
plugin `mempalace-recall` skill's how-to for `mempalace_search` /
`mempalace_kg_query` — read that skill (cited below) for the mechanism itself.

## Relationship to the plugin `mempalace-recall` skill

- **`mempalace-recall` (plugin-managed, outside this repo)** — the generic
  mechanism: search the palace via `mempalace_search` / `mempalace_kg_query`
  before answering about past work, decisions, people, or projects. It is
  question-driven ("the user asked about X") and lives outside repo/docs-site
  control — it is overwritten on plugin update, so it cannot own
  workflow-specific protocol.
- **`recall-grounding` (this skill, repo-local)** — the workflow discipline
  layered on top: fires on decision-POINTS, not just questions, and survives
  mechanism failure via a documented fallback. Do not edit the plugin skill to
  add workflow-specific behaviour — extend this one instead.

Both are in play together: this skill tells you *when* to call
`mempalace_search`/`mempalace_kg_query` (or its fallback) and what to do with
a failure; the plugin skill tells you *how* to call it and interpret results.

## 1. Decision-point recall triggers

Recall is **not** a session-start-only ritual and **not** only a response to
a direct user question ("what did we decide?"). Run recall (mempalace search,
or the fallback in §2 on MCP refusal) **before presenting**:

- any conclusion, plan, ratification, spec, or verdict,
- that cites a task id (`id-N` / `{N.M}`), a `DR-NNN`, prior-session framing
  ("we already decided…", "last time…"), or settled state.

This closes the loop where an agent presents a stale conclusion and the human
owner has to point at memory to correct it.

**Cheap guard:** before relying on any cited `id-N` / `DR-NNN` /
`{N.M}` in a conclusion:

```bash
bun scripts/ledger-cli.ts get task <id> status
```

This is cheap (one CLI call) and catches the "reopen a closed task as if it
were live" class of error.

Skip recall for pure greenfield work with no memory relevance (renaming a
variable, fixing a typo) — recall is decision-driven, not reflexive on every
turn.

## 2. `-32002` lock-free FTS fallthrough recipe

On a mempalace MCP `-32002` / integrity-check refusal — or any MCP recall
error — **do not proceed recall-blind**. Fall through to a lock-free,
read-only sqlite FTS read against the palace directly.

```bash
sqlite3 "file:$HOME/.mempalace/palace/chroma.sqlite3?mode=ro&immutable=1" \
  "SELECT substr(replace(string_value, char(10),' '),1,200) FROM embedding_fulltext_search
   WHERE string_value MATCH '<seed terms: task id OR DR-NNN OR topic>' AND string_value NOT LIKE 'CHECKPOINT:%'
   ORDER BY rowid DESC LIMIT 8"
```

Constraints on this read (non-negotiable):

- **Lock-free only** — `mode=ro&immutable=1`, WAL sqlite read. NEVER open a
  chromadb writer and NEVER route through a mempalace CLI write in this path.
- **No `wing` filter** — `mempalace_search` with a `wing` filter errors
  (upstream mempalace issue #1665, HNSW↔sqlite drift after bulk add/delete).
  Search without it and filter results client-side, whether via the MCP tool
  or this direct FTS read.
- **Seed the query** with the terms that matter for the conclusion you're
  about to present — task id(s), `DR-NNN`, topic keywords — not a bare
  wildcard.

**Fail open, always.** If the palace errors, is corrupt, or is unreachable:
tell the user memory is degraded and proceed — never block on recall.

## 3. Where this fits in agent briefs

Root `AGENTS.md` § Ledger protocol carries the compact form of §1 — verify live
status before citing a task, subtask, or decision-record state. This skill is
the fuller protocol behind that rule — read it when the one-liner isn't enough
context, or when you hit an MCP recall failure and need the fallback recipe
in §2.
