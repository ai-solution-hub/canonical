# cmux sub-orchestrator brief — S267 — decision-graph (Task ID-51)

You are a **sub-orchestrator** in Knowledge Hub's parallel-cmux phase (S267). You drive
**Task ID-51** end-to-end on your own worktree branch. The parent
(orchestrator-of-orchestrators) cherry-picks your commits back to `main` at teardown. This
Task is **read-heavy curation, no code.**

## First actions (orient — you are NOT stale)

Branched from `main` HEAD `73ffb2b4` into your own worktree. Do **NOT**
`git reset --hard origin/main`. Just orient:

1. `pwd && git branch --show-current && git status` — confirm
   `cmux-worker-decision-graph-73ffb2b4`, clean.
2. Load the **workflow-orchestration** skill — your SDLC backbone.

## Paths: RELATIVE ONLY (`docs/...`). Never absolute `/Users/...`.

## Commit model: worker-branch-only — incremental commits on YOUR branch, no push, no

`main`. Trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

## Open Questions: NEVER AskUserQuestion (headless → stalls). Write `OQ-pending.md` at

worktree root (question + options + provisional default + why), apply the default,
CONTINUE. Parent relays overrides.

## Final report: write `.claude/cmux-events/final-report-decision-graph.yaml` (gitignored)

before finishing —
`{summary, commits, subtask_dispositions, OQs_for_parent, next_session_handoff}`.

## Ledger updates: flip ONLY ID-51's subtask statuses + journal blocks. Task deps =

STRINGS, subtask deps = NUMBERS. Tasks have NO `details` field. 4 terminals share
task-list.json — keep edits scoped to ID-51's records.

---

## YOUR TASK: ID-51 — Decision-graph reconstruction + v2/v1.1 deferral register (`medium`)

Two subtasks. This is the canonical "intended-vs-current rosetta stone" rebuild + a
forward deferral register to seed the new product roadmap.

### {51.1} Decision-graph reconstruction + promote

Rebuild `docs/plans/phase-0-investigation/0.9-decision-graph.md` — it degraded through the
phase-0 → canonical-pipeline transitions (lots of intended-vs-implemented drift). Audit it
against current ratified state and make intended-vs-current deltas EXPLICIT:

- **canonical-pipeline PLAN.md §7** (the canonical decision log: Diff-UI = retained
  markdown-first; ledger-api = deferred-v1.1; Theme-F ratified S240; migration applied
  S246; decisions 1/2/3/4/6/7/9/12/13 made)
- the ledgers (`docs/reference/{task-list,product-roadmap,product-backlog}.json`)
- the S239 + pre-s244-feedback closures Then **promote the cleaned graph to
  `docs/reference/`** and cross-link from `docs/documentation-inventory.md`.

### {51.2} v2/v1.1 deferral register collation

Collate scattered `[DEFERRED-v1.1]` / `[DEFERRED-POST-LAUNCH]` items into ONE forward
register that can seed the new product roadmap. Sources:

- `docs/plans/phase-0-investigation/architecture/07-collapse-list.md`
- `project-plan.md` deferred table (locate)
- the phase-0 specs under `docs/plans/phase-0-investigation/` Every deferred item:
  source + rationale. **AC: no `[DEFERRED-*]` tag in the swept docs is missing from the
  register.**

### Also fold in if convenient (2 residual stale spots the S266 doc-sweep left)

- `docs/plans/phase-0-investigation/00-synthesis-v2.md` L221 — Theme-F readiness line
  (stale)
- `docs/plans/phase-0-investigation/02-data-flow.md` L144/L169 — TS-ledger "STILL-OPEN"
  (stale)

### Files (your ownership boundary)

`docs/plans/phase-0-investigation/` (the graph + stale-spot fixes), `docs/reference/` (the
promoted graph + the deferral register), `docs/documentation-inventory.md` (cross-link —
keep edits append/scoped; the docs-site terminal may also touch it). The ledgers +
canonical-pipeline PLAN.md §7 are your source of truth — READ them, don't edit them.
