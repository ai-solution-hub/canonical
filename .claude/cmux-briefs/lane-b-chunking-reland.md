# cmux Lane B — ID-56 {56.8} chunking-stage RE-LAND + 7 pytest green

You are a **SUB-ORCHESTRATOR** running in an isolated git worktree on branch
`cmux-worker-id56-chunk-*` (branched from main HEAD `e387975c`). Load the
`workflow-orchestration` skill. You are NOT a leaf worker: for the implementation,
DISPATCH a `task-executor` (via the Agent tool, entry point `implement-subtask`), then
GATE it with a `task-checker` (variant=standard, then test-quality) — FAIL→fix→PASS —
BEFORE the work is considered done. Do not author the code yourself as your own
deliverable.

## Mission

The ID-56 {56.8} chunking stage was implemented in S282 (commit `574d0a0f` feat +
`cd337abd` Checker-fix) and the ledger marks {56.8}/{56.9} **done** — but the code is
**ABSENT from current main `scripts/cocoindex_pipeline/flow.py`**. A later commit
overwrote the chunking stage while leaving the tests + ledger in place. Result: 7 Python
tests fail on main expecting wiring that no longer exists. **Re-land the chunking stage so
those 7 tests pass.**

This is a recovery/re-apply task, NOT a greenfield build — the exact code exists in git
history.

### Forensics first (do this before writing anything)

```bash
# Confirm absence on current HEAD:
grep -n "CONTENT_CHUNKS_SCHEMA\|cc_target\|chunking" scripts/cocoindex_pipeline/flow.py
# Recover the original impl diff (+125 lines) and the Checker-fix:
git show 574d0a0f -- scripts/cocoindex_pipeline/flow.py
git show cd337abd
# Find the commit that REMOVED it (understand the overwrite to re-apply cleanly):
git log --oneline -S CONTENT_CHUNKS_SCHEMA -- scripts/cocoindex_pipeline/flow.py
git log --oneline -S cc_target -- scripts/cocoindex_pipeline/flow.py
```

Do **NOT** `git cherry-pick 574d0a0f` — it is already an ancestor of HEAD and will
no-op/conflict. Instead read its diff, understand the additions, and **re-apply them onto
current `flow.py`**, reconciling with whatever the overwriting commit changed (the
surrounding `ingest_file` / `app_main` / `_empty_stage_counts` bodies may have drifted).

## What to re-land (from the S282 {56.8} journal — authoritative)

Edit `scripts/cocoindex_pipeline/flow.py` ONLY (plus the one TS schema line below):

1. **`CONTENT_CHUNKS_SCHEMA`** — fields: `id`, `content_item_id`, `content`, `position`,
   `char_count`, `word_count`, `embedding` `vector(1024)` (via `_encode_pgvector`),
   `op_id`. **Heading columns OMITTED** (heading_text / heading_level / parent_chunk_id
   resolve to NULL; `heading_path` resolves to its DB default `'{}'` —
   `content_chunks.heading_path` is `text[] DEFAULT '{}' NOT NULL`, an empty array, not
   NULL).
2. **`ingest_file`** gains a defaulted 8th positional `cc_target=None`; the chunking block
   is guarded `if cc_target is not None:` and placed **AFTER** `ci_target.declare_row` (FK
   safety + memo cascade). The 3 pre-existing 7-arg direct callers must stay untouched
   (default makes them safe).
3. **RecursiveSplitter** imported from `cocoindex.ops.text` — **NEVER**
   `cocoindex.functions.SplitRecursively` (V-1 TRAP: absent in cocoindex==1.0.3). Import
   LAZILY in-block (stub-backed flow-import harnesses stub cocoindex as a bare MagicMock).
   Proven call:
   `splitter.split(content_text, 2000, chunk_overlap=200, min_chunk_size=1000) -> list[Chunk]`;
   `chunk.text` is `str`; `chunk.start`/`.end` are `TextPosition`
   (`.char_offset`/`.byte_offset` — NOT consumed here). Variant-B config 2000B / 200B
   overlap / 1000B min (Liam-ratified {56.5}).
4. **Per-chunk embedding** via `embed_content_text` (same Stage-4 embedder, C-30).
5. **Deterministic PK** `uuid5(<pipeline doc namespace>, "chunk:{rel_path}:{position}")`
   so re-ingest UPSERTs (idempotency). One `content_chunks` row per chunk; monotonic
   0-indexed `position`.
6. **`app_main`** mounts `content_chunks` (`managed_by=USER`, no DDL) and threads
   `cc_target` as the last `mount_each` positional.
7. **Stage-count wiring**: `_empty_stage_counts()` returns **7** keys incl
   `"chunking": 0`; flow-end `finally` folds
   `stage_counts["chunking"] = flow_stage_counter.get("chunking")`; the per-row
   `stage_counter.increment("chunking")` must be live (was dead in the original — a
   Checker blocker — make sure the fold is present, not just the increment).
8. **TS schema (one line)**: `app/api/internal/pipeline-runs/record/route.ts`
   `StageCountsSchema` gains `chunking: z.number().int().nonnegative()`. This is the only
   `.ts` edit → run
   `gitnexus_impact({target: 'StageCountsSchema', direction: 'upstream'})` before editing
   and record the verdict in your journal (it was LOW / 0 callers / module-private const
   last time).

## The 7 failing tests (acceptance — all must go green)

- `scripts/tests/test_cocoindex_chunking.py` (3) — incl
  `test_ingest_file_accepts_defaulted_cc_target`
- `scripts/tests/test_cocoindex_flow_entity_mentions_target.py` (2) — assert
  `params[5:] == ["ft_target", "ftf_target", "cc_target"]` (8-param order)
- `scripts/tests/test_cocoindex_flow_pipeline_run_webhook.py` `TestEmptyStageCounts`
  - `scripts/tests/test_cocoindex_flow_stage_counts.py` — expect `'chunking'` key (6-vs-7)

Blast radius of the 6→7-key change also touches stage-topology + persistent-failure-dlq
integration arrays and `record-run.test.ts` / `record.test.ts` fixtures (the S282 fix
swept 10 files) — re-check these too.

## CI note (do NOT change ci.yml)

The PR-blocking pytest job ALREADY exists (`ci.yml:189 python3 -m pytest scripts/tests/`)
and IS correctly paths-filter-gated on `scripts/**/*.py` (`ci.yml:56`), so `flow.py`
changes already trigger it. **Do not add or widen a CI job** — the gating is already
correct; the regression slipped via a non-blocking main push, not a missing job.
Optionally note the slip mechanism in your final report.

## Environment setup (fresh worktree — no .venv)

```bash
pip install -r requirements.txt
# cocoindex boot/chunking tests need the sandbox disabled (LMDB mmap):
# run pytest with dangerouslyDisableSandbox: true.
```

`.env.local` is seeded into your worktree (`.worktreeinclude`). No DDL / no migration
needed — `content_chunks` table + `op_id` column already exist on staging+prod ({56.6}
landed). So **no `supabase link` / `db push`** in this lane.

## Verification gate

- `python3 -m pytest scripts/tests/` — full suite GREEN (the S282 baseline was 1483
  passed; you must restore that, zero regressions, 7 prior-fails now green). Run
  UNSANDBOXED (`dangerouslyDisableSandbox: true`) — LMDB mmap.
- `bun run test` for the `route.ts` schema change (record-run / record fixtures).
- Lint clean.

## Rules (non-negotiable)

- **task-executor → task-checker pattern.** Dispatch executor (implement-subtask), then
  checker (standard, then test-quality variant given test-centrality). FAIL→fix→PASS
  before done.
- **NO ledger edits.** Do NOT touch `docs/reference/task-list.json` or any
  `docs/reference/*.json` — the parent orchestrator owns all ledger writes.
- **NO `AskUserQuestion`** — it deadlocks the terminal. If you hit a genuine Open
  Question, use the OQ-escalation channel: read
  `.claude/skills/session-driver-cmux/oq-brief-fragment.md` for the usage contract, emit
  the OQ, and continue with a recommended default where safe.
- Python is gitnexus/ast-dataflow-invisible (TS-only) — use grep for `.py`. The `.ts` edit
  gets the gitnexus_impact pass (item 8).
- UK English comments; no barrel re-exports; relative paths only.
- Commit per subtask via `commit-commands` on your worker branch. Do NOT push.

## Final report

Before you pause for teardown, write `<events_dir>/final_report.yaml` (your per-session
events dir, `.claude/cmux-events/<your-sid>/`). Schema:
`{summary, commits:[sha+subject], tests:{before,after}, files_touched, slip_mechanism_note, OQs_for_parent, next_steps}`.
Keep a short stdout summary too. Then stop and await parent teardown (do not `/exit` if an
OQ is pending).
