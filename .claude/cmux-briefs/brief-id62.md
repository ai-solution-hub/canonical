# cmux leaf-executor brief — ID-62 lane: {62.5} + {62.8}

You are a LEAF EXECUTOR in an isolated git worktree (branch `cmux-worker-id62-*`),
branched from `main`. Implement two Subtasks of Task ID-62 (fixture-staging
live-verification infra), commit each, then `/exit`. You are NOT a sub-orchestrator —
implement directly; do not spawn your own fleet. Use RELATIVE paths only.

## First actions (MANDATORY, in order)

1. `supabase link --project-ref turayklvaunphgbgscat` then
   `cat supabase/.temp/project-ref` to confirm STAGING (worktrees inherit no link;
   prod-drift risk otherwise). NEVER `db push` to prod.
2. Read your Subtask details:
   `jq -r '.tasks[] | select(.id=="62") | .subtasks[] | select(.id==5 or .id==8) | "{\(.id)} \(.title)\nDETAILS: \(.details)\nTEST: \(.testStrategy)\n---"' docs/reference/task-list.json`
3. Read the specs: `docs/specs/id-62-fixture-staging-infra/{PRODUCT,TECH,PLAN}.md` — the
   {62.5}/{62.8} slices specifically.
4. The worktree shares the parent gitnexus index READ-ONLY — do NOT run
   `gitnexus analyze`. Use `gitnexus_impact`/`gitnexus_context` or ast-dataflow for blast
   radius.

## Scope (ONLY these two — both host-agnostic code)

- **{62.5}** Add a co-resident `POST /stage` multipart byte-drop route to the cocoindex
  server (`scripts/cocoindex_pipeline/server.py`), per the TECH `/stage` design.
  Stage-only; writes incoming multipart bytes into the `COCOINDEX_SOURCE_PATH` staging
  dir. No `/stage` handler exists yet (ID-49.10 built only the client helper).
- **{62.8}** Switch the TS `stageFixture` client from a JSON body to multipart bytes — the
  `StageFixtureArgs` type is UNCHANGED. It MUST match the {62.5} route contract you just
  built (verify the multipart field names/shape align).
- **DO NOT** touch {62.6}/{62.7}/{62.9}/{62.10} — host-gated (B1), OUT OF SCOPE this
  session.

## Discipline

- TDD where a test surface exists. Python: `python3 -m pytest <path>` — run UNSANDBOXED; a
  bare-`/tmp` EPERM is a sandbox artefact, not a real failure. TS: `bun run test <file>`.
- Tool-discipline: run blast-radius (`gitnexus_impact` or ast-dataflow
  `callers`/`references`) before editing shared symbols (e.g. `stageFixture` callers) and
  report it; `gitnexus_detect_changes` before each commit.
- Commit PER Subtask. Messages:
  `feat(stage): {62.5} co-resident POST /stage multipart route` /
  `refactor(stage): {62.8} stageFixture JSON->multipart`. End every message with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **DO NOT edit any ledger JSON (`docs/reference/*.json`)** — the PARENT owns ledger
  writes. Do not flip Subtask status or append journals. Implement code + tests + commit
  only.
- **DO NOT use AskUserQuestion** (it deadlocks this terminal). For a blocking Open
  Question use the OQ-escalation channel — see
  `.claude/skills/session-driver-cmux/oq-brief-fragment.md`.

## Finish

End with a FINAL REPORT as your last message: per-Subtask commit SHA, test results,
blast-radius summary, any OQ / incomplete item. Then `/exit`.
