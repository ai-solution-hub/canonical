# cmux Lane C — ID-54 spec-then-impl (REVISED: RESEARCH + TECH → ratify → impl)

**This REPLACES the earlier direct-impl brief.** ID-54 is now a right-sized spec chain:
**{54.1} RESEARCH → {54.3} TECH → (Liam ratifies) → {54.5} impl**. PRODUCT ({54.2}) and
PLAN ({54.4}) are deliberately SKIPPED (Liam, S286).

You are a **SUB-ORCHESTRATOR** in an isolated worktree on branch `cmux-worker-id54-*`.
Load `workflow-orchestration`. Dispatch a **task-planner** for the spec subtasks and a
**task-executor + task-checker** for impl. Gate each output with a checker
(FAIL→fix→PASS). Do NOT author specs/code as your own deliverable. Read the subtask
records: `bun scripts/ledger-cli.ts show task 54` (NB your worktree's task-list.json
predates these edits — the authoritative subtask scope is THIS brief; the parent owns the
ledger).

Spec dir: `docs/specs/ID-54-q-a-extractions-lossy-write/`.

## Mission

The cocoindex LLM extractor produces 4 form-question fields that are **dropped at write
time** (S273 OQ-52-LOSSY): `expected_response_kind`, `evaluation_criteria`,
`evidence_requirements`, `scope_tags`. Neither the `q_a_extractions` DB table nor
`Q_A_EXTRACTIONS_SCHEMA` (flow.py) carries them. Stop the loss — but design it properly
first.

## {54.1} RESEARCH (do FIRST — dispatch task-planner)

Author `docs/specs/ID-54-q-a-extractions-lossy-write/RESEARCH.md` (UK English, cite
file:line, no fabrication):

- **Exact extractor field names** on the `pair`/`qa_pairs[*]` Pydantic model
  (`scripts/cocoindex_pipeline/extraction.py`, `prompts.py:95-98`, `prompts.py:111-113`).
  Confirm nullability/defaults the model guarantees.
- **Consumer inventory** — who reads these 4 fields downstream? Search RPCs, `q_a_pairs`
  promotion path, UI, MCP tools. Are any blocked/lossy because the data never lands?
- **★ CRITICAL: `scope_tags` vocabulary alignment.** There is an EXISTING q_a search-RPC
  scope-matching mechanism — see
  `supabase/migrations/20260520231524_t6_q_a_search_rpcs.sql`
  (`scope_tag && caller_scope_tags`). Determine whether `q_a_extractions.scope_tags` MUST
  reuse that vocabulary/array-overlap contract rather than inventing a parallel one. Same
  question (lighter) for `evidence_requirements`.
- **Column-type options table** for each of the 4 (e.g. `expected_response_kind` Postgres
  enum vs `text + CHECK`; arrays as `text[] DEFAULT '{}'`), with the trade-offs.

Gate with task-checker. Then proceed to {54.3}.

## {54.3} TECH (dispatch a FRESH task-planner)

Author `docs/specs/ID-54-q-a-extractions-lossy-write/TECH.md` mapping 1:1 to RESEARCH
findings:

- Exact column DDL (types / nullability / defaults / CHECK) for all 4.
- Additive migration plan (staging-first; parent sequences prod).
- `Q_A_EXTRACTIONS_SCHEMA` (flow.py ~832-844) + `qa_target.declare_row` write (~1232-1245)
  deltas.
- `database.types.ts` regen note.
- **Downstream-contract decision**: does `scope_tags` adopt the existing
  `caller_scope_tags` vocabulary? Any search-RPC change needed (or explicitly deferred)?
- Test plan.

Gate with task-checker.

## RATIFICATION GATE (after {54.3}, before {54.5})

**Emit an OQ packet** to the parent with the TECH design summary (esp. the column-type
choices + the `scope_tags`-vocab decision) + a recommended default, and **PAUSE in
`awaiting-decision`** — do NOT implement and do NOT `/exit` until the parent relays Liam's
ratification. Read `.claude/skills/session-driver-cmux/oq-brief-fragment.md` for the
emit/poll contract.

## {54.5} impl (GATED on ratified TECH — dispatch task-executor + task-checker)

Per ratified TECH:

- Additive migration (DDL via CLI only — `supabase migration new` + `db push`). **First
  action: `supabase link --project-ref turayklvaunphgbgscat` (staging); verify
  `cat supabase/.temp/project-ref` before any push. STAGING PUSH ONLY — the parent
  sequences all prod migrations.**
- Extend `Q_A_EXTRACTIONS_SCHEMA`; populate the `qa_target.declare_row` write from
  `_field(pair, "<key>")`.
- Regen `database.types.ts` from staging.
- pytest assertions for the 4 new fields.

### ⚠ Shared-file coordination

`scripts/cocoindex_pipeline/flow.py` is **concurrently edited by Lane B** (ID-56 {56.8}
chunking — `CONTENT_CHUNKS_SCHEMA` + `ingest_file` chunking block +
`_empty_stage_counts` + `app_main`). Keep your `flow.py` diff **surgical/localized** to
`Q_A_EXTRACTIONS_SCHEMA` + the `qa_target.declare_row` block. Parent integrates Lane B
first, then you (conflict-resolve) — a tight diff keeps that clean.

## Environment

`.env.local` seeded. `pip install -r requirements.txt` (pytest); `bun install`
(`database.types.ts` regen). cocoindex tests need `dangerouslyDisableSandbox: true` (LMDB
mmap).

## Rules (non-negotiable)

- **task-planner for {54.1}/{54.3}; task-executor + task-checker for {54.5}.**
  FAIL→fix→PASS.
- **NO ledger edits** — parent owns `docs/reference/*.json`.
- **NO `AskUserQuestion`** — use the OQ channel (the TECH ratification gate is mandatory
  OQ usage).
- UK English; no barrel re-exports; relative paths only. Python is
  gitnexus/ast-dataflow-invisible — grep for `.py`.
- Commit per subtask via `commit-commands` on your worker branch. Do NOT push to remote.

## Final report

Before teardown write `<events_dir>/final_report.yaml`
(`.claude/cmux-events/<your-sid>/`):
`{summary, research_doc, tech_doc, tech_ratified, migration_file, columns_added, scope_tags_decision, commits:[sha+subject], files_touched, OQs_for_parent, next_steps}`.
Short stdout summary too. Do not `/exit` while the ratification OQ (or any OQ) is
undecided.
