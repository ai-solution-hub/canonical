# cmux Sub-Orchestrator Brief — S274 / ID-49 close gate

**Worker name:** `subo-id-49-close` **Parent tip SHA:** `f63aba0a` **Worker branch:**
`cmux-worker-subo-id-49-close-<auto>` **Role:** SUB-ORCHESTRATOR (not leaf worker)

## READ FIRST (in order)

1. `docs/research/s273-canonical-pipeline-finals/id49-final.yaml` — full S273 disposition
   list (sections: `dispositions.curator_or_backlog` lists 9 out-of-scope findings;
   `OQs_for_parent` lists 3 OQ packets; `next_session_handoff.parent_actions` lists the 5
   close actions).
2. `docs/reference/task-list.json` — Task ID-49 record (currently `pending`; all 6
   in-scope Subtasks are `done` or `deferred`).
3. `.claude/skills/workflow-orchestration/SKILL.md` — your operating manual. You load it
   once at start.
4. `.claude/skills/triage-finding/SKILL.md` +
   `.claude/skills/update-roadmap-backlog/SKILL.md` — for Curator triage.
5. `docs/reference/canonical-pipeline-sequencing.md` — v1 master (carries cross-Task scope
   refs).

## Scope (ID-49 close lifecycle)

You are the sub-orchestrator. Drive ID-49 from `pending` → `done` by executing the
standard end-of-Task close gate:

### Phase 1: end-of-task code-simplification pass

- Dispatch ONE `task-executor` (Agent tool, `isolation: "worktree"`) with the
  `code-simplification` skill.
- Brief carries: scope = ID-49 commits since S273 (the 14-commit chain
  `c8b611ed..52bab07c` is cherry-picked into `main`; identify code-paths touched and run
  `/code-review --fix` over the diff vs `38706ce0` parent base).
- Executor commits cleanups on its own worktree branch.
- **Cherry-pick safety pattern** (S273 ratified): Executor FIRST action =
  `git fetch origin main && git reset --hard origin/main` (your tip will be your worker
  branch, your worker branch's tip is what you cherry-pick to). Executor returns journal
  text; YOU write the ledger.

### Phase 2: end-of-task quality-review Checker pass

- Dispatch ONE `task-checker` (Agent tool, variant `quality-review`) against the
  post-simplification ID-49 commit set.
- Verdict shape per `references/checker-output-schema.md`.
- FAIL → dispatch fix-Executor with finding packet → re-Check until PASS or
  PASS_WITH_NOTES.

### Phase 3: Curator triage on 9 out-of-scope dispositions

For each of the 9 entries in `id49-final.yaml` `dispositions.curator_or_backlog`, dispatch
ONE `workflow-curator` (Agent tool) per finding. Each Curator runs `triage-finding` to
decide (subtask / roadmap / backlog / no-action) and owns the ledger write via
`update-roadmap-backlog` if the decision is roadmap or backlog.

The 9 findings (one Curator dispatch each):

1. out-of-scope-1: test-isolation incomplete (49.7 fix incomplete; conftest redesign
   needed)
2. out-of-scope-2: stage-counter inertness across non-embedding stages
3. out-of-scope-3: spec-text path drift (`docs/client-documentation-base` → `corpus`) in
   cocoindex-flow-scaffolding RESEARCH+TECH
4. out-of-scope-4: `kh_canonical_pipeline` literal hardcoded in 3 tests + flow.py:473
5. out-of-scope-5: test-helper bare-except in
   `test_cocoindex_server.py::_stop_cocoindex_default_env`
6. out-of-scope-6: `test_cocoindex_extractor_retry.py` module-level unqualified import →
   dual-path root cause
7. out-of-scope-7: stray untracked `conftest_diag.py` in 49.1 executor worktree (cleanup
   observation)
8. out-of-scope-8: OQ-FixtureStaging → new subtask 49.10 (already created S273 — verify;
   promote scope check)
9. out-of-scope-9: OQ-S266 FixtureLibrary → fold into 49.10

### Phase 4: handle the 3 OQs in `OQs_for_parent`

- `OQ-FixtureStaging-49.8`: confirm against current ledger (S273 created 49.10 — reconcile
  naming; do NOT duplicate).
- `OQ-49.5-Spec-Rescope`: NO-ACTION on this Task — ID-53 already opened in S273 covering
  Stage-5 spec rescope. Cross-link in ID-49.5 details journal as a paper trail.
- `OQ-Stage-Counter-Cross-Cutting`: triage via Curator (out-of-scope-2 covers this; the OQ
  proposes "promote ID-158/ID-162 into a Task OR new ID-49 subtask"). Curator decides
  backlog promote vs subtask vs new Task.

### Phase 5: Task close

- Verify all Subtasks `done` or `deferred` (49.1/49.2/49.4/49.6 done; 49.3/49.5 deferred;
  49.10 = new fixture-staging subtask — current status; any new subtasks from Curator).
- Append `<info added on {S274 timestamp}>` block to Task ID-49 `details` capturing:
  simplification commit SHA, quality-review verdict, Curator dispositions summary.
- Flip Task ID-49 status `pending` → `done` via ledger CLI
  (`bun bin/ledger-cli.ts update-task 49 status done`).
- Regen mirrors via `bash scripts/regen-mirrors.sh` (use `dangerouslyDisableSandbox: true`
  — known gotcha).
- Commit ledger changes on worker branch.

## Operating constraints — REQUIRED

- **You are SUB-ORCHESTRATOR.** Dispatch Planners / Executors / Checkers / Curators via
  the `Agent` tool. Do NOT author specs, write code, or edit code files yourself as
  deliverables.
- **You own ALL ledger writes.** Child Agents return journal text + commit SHAs; YOU apply
  via ledger CLI on YOUR worker branch.
- **No `AskUserQuestion` — NESTED-AGENT BAN.** Your dispatched Agents must NOT invoke
  `AskUserQuestion`. If they encounter ambiguity, they MUST escalate back to you via Stop
  with finding-packet, NOT prompt the user. Brief every child Agent with: "Do NOT call
  AskUserQuestion. If blocked, stop and report — your sub-orchestrator parent is async and
  cannot answer interactive prompts." (S273 stall hit this twice.)
- **OQ-escalation channel.** If you hit a cross-Task scope decision (e.g., the
  OQ-Stage-Counter ruling proposes a new ID-49 subtask but you suspect it belongs as a
  separate Task), surface via OQ packet to events_dir per
  `docs/specs/id-43-oq-escalation/PRODUCT.md`. Do not silently work around.
- **Final report.** Before `/exit`, write `<events_dir>/final_report.yaml` with sections:
  `summary`, `simplification_commit`, `quality_review_verdict`, `curator_dispositions`,
  `OQs_resolved`, `task_close_commit`, `ledger_writes`, `unresolved_for_parent`.

## Success criteria

- ID-49 Task status `done`; close-out journal block present in `details`.
- All 9 out-of-scope findings have a Curator decision (subtask / backlog / roadmap /
  no-action) recorded.
- `bun lint` clean (BABEL-app-bundles note is pre-existing baseline).
- `python3 -m pytest scripts/tests/` count >= 1318 (S273 baseline — no regressions
  allowed).
- Final report YAML present in events_dir.

## DO NOT

- DO NOT touch `docs/reference/task-list.json` outside the ID-49 record and any new
  subtasks the Curator promotes.
- DO NOT push to `origin` — your worker branch stays local until parent cherry-picks.
- DO NOT spawn nested cmux workers — use Agent tool only.
- DO NOT skip the simplification pass even if you think the code is clean — the pass is a
  gate, not a heuristic.
