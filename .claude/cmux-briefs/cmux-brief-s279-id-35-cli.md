# cmux brief — S279 · ID-35 ledger-CLI defect fixes ({35.40}–{35.44})

You are a **SUB-ORCHESTRATOR** running in an isolated cmux terminal + git worktree
branched from `main`. Load the `workflow-orchestration` skill and drive the implementation
wave for five ledger-CLI defects. **You are NOT a leaf worker:** for each Subtask,
DISPATCH a `task-executor` (implement) then GATE with a `task-checker` (standard variant)
before committing — do NOT author the code directly as your own deliverable. Use the
built-in `Agent` tool for these (single-turn, no nested cmux).

## Why this matters

The ledger-CLI is the Orchestrator's only sanctioned ledger-write path, but five defects
force hand-written `escapeSerialise` node-script workarounds every session. These fixes
remove that friction. Get them RIGHT — they are dogfooded constantly.

## First actions (worktree is a FRESH full checkout — no node_modules)

1. `git fetch origin main && git reset --hard origin/main` (you start at main HEAD; ensure
   current).
2. `bun install` (the worktree has NO node_modules symlink — tests will not run
   otherwise).
3. Confirm baseline green: `bun run test __tests__/scripts/ledger-cli` (record pass
   count).

## Owned files (ALL five Subtasks share these — work SEQUENTIALLY, never parallel)

- `scripts/ledger-cli.ts` (the CLI entry + subcommand handlers)
- `lib/ledger/*.ts` — `detect-schema.ts`, `scoped-serialise.ts`, `patch-apply.ts`,
  `record-mutate.ts`, `atomic-write.ts` (touch only what each fix needs)
- `__tests__/scripts/ledger-cli-*.test.ts` (+ add new test files as needed)

## Code-intelligence discipline (these are `.ts` — MANDATORY)

Before editing any symbol: `gitnexus_impact({target: '<symbol>', direction: 'upstream'})`
— record verdict (LOW/MEDIUM/HIGH/CRITICAL) + caller count + top-3 flows in the Subtask
journal. **If HIGH or CRITICAL: STOP and escalate via the OQ channel before editing.**
Before each commit: `gitnexus_detect_changes()` to confirm scope containment.

## The five Subtasks (implement IN THIS ORDER — each: executor → checker → commit)

### {35.44} — stdout JSON purity (do FIRST; unblocks clean piping for the rest)

Two coupled defects: (1) mutating commands emit the JSON result AND human footer lines
(e.g. `ℹ mirror regen suppressed…`) on the SAME stdout, so `cmd | jq` throws — and a
`|| fallback` shell idiom then silently RE-RUNS the mutation (this caused a duplicate
{62.1} in S278). Fix: emit the machine-readable result as the SOLE stdout payload
(single-line JSON); route ALL human/advisory lines to STDERR. (2) `add-subtask` /
`promote` `--dry-run` STILL emit the 34–67KB full-document dump despite {35.30} — extend
the {35.30} fix to the dry-run path. **testStrategy:** every subcommand stdout parses as a
single JSON object via `jq -e` (no trailing human lines); diagnostics on stderr only;
`--dry-run` output bounded (no full-document dump); regression test pipes representative
commands through jq and asserts.

### {35.40} — `update-task --scoped` (minimal-diff field edits)

Add `--scoped` flag so field-level edits (status_note, status, etc.) produce minimal diffs
instead of whole-file UTF-8 re-escape (a 2-char status_note edit reformatted 913+914 lines
in S276). Pattern reference: `append-journal --scoped` already works; mirror its
scoped-serialise path (`lib/ledger/scoped-serialise.ts`). **testStrategy:**
`update-task <id> status_note 'new note' --scoped` produces ≤3-line diff on task-list.json
(only the field changes; surrounding em-dashes + key order preserved).

### {35.41} — `update-umbrella` subcommand (umbrellas.json task_ids[] maintenance)

No CLI support exists for `umbrellas.json` `task_ids[]` arrays — raw JSON edit is the only
current option. Add `update-umbrella` with `--add-tasks`, `--remove-tasks`, `--reorder`;
enforce the budget + record-set gates like other CLI writes; idempotent. **testStrategy:**
`update-umbrella canonical-pipeline --add-tasks 28,49,52,53,54,55` appends 6 IDs
idempotently; re-run is a no-op; `--remove-tasks` + `--reorder` work; gates enforced.

### {35.42} — `open-task --effort-estimate` flag (avoid two-write pattern)

`open-task` takes core fields via named flags but NOT `--effort-estimate`, forcing a
follow-up `update-task` per record (the S276 promotion subagent hit this 5×). Add the flag
so a single invocation suffices. **testStrategy:**
`open-task --title X --description Y --effort-estimate '1.5 PLAN units'` writes the field
in one CLI invocation; no follow-up needed; schema-validation gate triggers same as
update-task.

### {35.43} — `delete-subtask` command (guarded)

No remove/delete-subtask command exists (only add/update/flip-subtask). Removing an
accidental duplicate needs a hand-written escapeSerialise node script (hit in S278 ID-62
setup). Add `delete-subtask <taskId> <subId>` reusing the {35.16} record-set drop-guard
(assert post-write subtask id-set == pre-write set minus the removed id, derived from the
bytes about to be written). Mirror `delete-backlog` confirmation / `--force` / `--dry-run`
semantics. **testStrategy:** removes exactly that Subtask; record-set gate rejects if any
sibling is dropped/duplicated; `--dry-run` reports the delta; tests cover happy +
not-found + last-subtask cases.

## Ledger discipline (CRITICAL — avoids cherry-pick collisions)

DO NOT edit `docs/reference/task-list.json` (or any ledger JSON) as a work product. The
parent Orchestrator owns ALL status/journal writes. For each Subtask, return the exact
`<info added on …>` journal-block text (commit SHA, verdict, what changed) in your final
report — the parent writes it. (Your test FIXTURES may use throwaway temp JSON — that is
fine; just never mutate the real `docs/reference/*.json` ledgers.)

## Commit + gate cadence

- One commit per Subtask (commit-commands convention, Co-Authored-By trailer), on YOUR
  worker branch. Never `--amend` across Subtasks.
- task-checker (standard variant) gates each Subtask against its testStrategy + KH
  conventions BEFORE you move to the next. FAIL → fix-executor → re-check → PASS.
- After all five: run the full `bun run test __tests__/scripts/ledger-cli` suite +
  `bun lint` on touched files. Report counts.

## Escalation

Do NOT use AskUserQuestion (headless stall). Surface any Open Question or HIGH/CRITICAL
impact verdict via the OQ-escalation channel (`docs/specs/id-43-oq-escalation/PRODUCT.md`)
back to the parent; do not silently work around unexpected behaviour.

## Final report

Before `/exit`, write `<events_dir>/final_report.yaml` with sections {summary, commits
(SHA + subtask), per-subtask journal blocks, test_counts, dispositions, OQs_for_parent}.
Keep a short stdout summary too. `<events_dir>` = `.claude/cmux-events/<your-SID>/`.
