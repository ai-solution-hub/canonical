# cmux leaf-executor brief — ID-55 lane: {55.1}–{55.5} + bl-185

You are a LEAF EXECUTOR in an isolated git worktree (branch `cmux-worker-id55-*`),
branched from `main`. Implement five Subtasks of Task ID-55 (canonical-pipeline
test-isolation + observability follow-ups) plus fold in backlog bl-185, commit per
Subtask, then `/exit`. You are NOT a sub-orchestrator — implement directly. Use RELATIVE
paths only.

## First actions (MANDATORY, in order)

1. `supabase link --project-ref turayklvaunphgbgscat` then
   `cat supabase/.temp/project-ref` to confirm STAGING. NEVER `db push` to prod (this lane
   is test-only — likely no DB writes at all).
2. Read your Subtask details:
   `jq -r '.tasks[] | select(.id=="55") | .subtasks[] | select(.id>=1 and .id<=5) | "{\(.id)} \(.title)\nDETAILS: \(.details)\nTEST: \(.testStrategy)\n---"' docs/reference/task-list.json`
3. Read bl-185:
   `jq '(.items // .backlog // .) | .[]? | select((.id|tostring)=="185")' docs/reference/product-backlog.json`
4. The worktree shares the parent gitnexus index READ-ONLY — do NOT run
   `gitnexus analyze`. ast-dataflow is TS-only; for Python use grep.

## Scope (Python pipeline test-isolation — `scripts/tests/` + `scripts/cocoindex_pipeline/`)

- **{55.1}** cocoindex test conftest redesign — subset-order-stable isolation (tests pass
  regardless of selection/order).
- **{55.2}** Extend `bind_stage_counter` to non-embedding stages (llm / binary / upsert /
  walk).
- **{55.3}** Centralise the `'kh_canonical_pipeline'` literal — `flow.py` + the 3
  integration tests that hardcode it.
- **{55.4}** Narrow the bare-`except` in the `_stop_cocoindex_default_env` test helper.
- **{55.5}** Lazy-import in `test_cocoindex_extractor_retry.py` — root-cause the dual
  `sys.modules` registration.
- **bl-185** (cocoindex private-API + dual-path import structural cleanup, parked): this
  is the SAME dual-import root cause {55.5} investigates. Address it together — if
  resolving {55.5}'s dual `sys.modules` also closes bl-185's structural dual-path import,
  do so; if bl-185 is broader, do what's in-scope and state in the FINAL REPORT exactly
  what remains.

## Discipline

- This is TEST-ISOLATION work — the bar is: the suite passes deterministically under any
  subset/order. Run `python3 -m pytest scripts/tests/` UNSANDBOXED (a bare-`/tmp` mktemp
  EPERM is a sandbox artefact, NOT a real failure — recently fixed in oq-parent.sh but
  other temp uses may exist). Verify subset-stability by running a few different
  `pytest -k` subsets, not just the full suite.
- Commit PER Subtask. Messages: `test(pipeline): {55.N} <what>`. End every message with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **DO NOT edit any ledger JSON (`docs/reference/*.json`)** — the PARENT owns ledger
  writes (incl. closing bl-185).
- **DO NOT use AskUserQuestion** — use the OQ-escalation channel
  (`.claude/skills/session-driver-cmux/oq-brief-fragment.md`) for blocking questions.

## Finish

End with a FINAL REPORT as your last message: per-Subtask commit SHA, pytest results
(incl. which subsets you ran to prove order-stability), the bl-185 disposition (fully
closed vs partial + what remains), any OQ. Then `/exit`.
