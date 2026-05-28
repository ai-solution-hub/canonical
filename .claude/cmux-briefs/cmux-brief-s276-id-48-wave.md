# Cmux Brief — subo-id-48 — ID-48 wave ({48.5/14/15/16})

**Session:** S276. **Worker name:** `subo-id-48`. **Base branch:** `main` @ `a2a6cdfe`.

## You are a SUB-ORCHESTRATOR, not a leaf worker

Load `workflow-orchestration` first. For every Subtask you DISPATCH a task-planner and/or
task-executor via the built-in `Agent` tool, then GATE each with a task-checker (FAIL →
fix-Executor → PASS) BEFORE committing. Do NOT author specs/plans or edit code/docs
directly as your own deliverable. Commit on your worker branch; surface Open Questions via
the OQ-escalation channel (`docs/specs/oq-escalation/PRODUCT.md`).

## Scope — ID-48 wave (Liam-deferred from S275 to S276)

Implement the following 4 Subtasks on `docs/reference/task-list.json` ID-48:

- **{48.5}** workflow-evaluator agent + evaluate-workflow companion
- **{48.14}** evaluate-findings skill (adjudication playbook)
- **{48.15}** worker-corpus archival (`stop-worker.sh --archive` flag)
- **{48.16}** Forward bulk ID-prefix rename for ~25 spec dirs

## Pre-dispatch — READ FIRST

1. **`docs/specs/id-48-workflow-evaluation/PLAN.md`** — entire file, especially the **S271
   ADDENDUM** (lines 66-129). The addendum is authoritative where it conflicts with
   §3/§5/§11. RESEARCH.md §13 supersedes inline framing.
2. **`docs/specs/id-48-workflow-evaluation/RESEARCH.md`** §13 — re-scoped evaluator
   architecture + retro handling model.

## Build-phase constraints (PLAN §S271 ADDENDUM §13.7, NON-NEGOTIABLE)

1. **Skill-informed order:** when building the evaluator, use:
   `prompt-engineering → agent-development → create-skill`.
2. **CRITICAL** — any edit to a `.claude/{agents,skills}/` file in the build phase MUST
   invoke the related authoring skill (`agent-development` / `create-skill` /
   `update-skill`) — copying patterns by hand is NOT acceptable. Hook 1 ({48.11})
   backstops this.
3. **One task-executor per skill invoked, sequential.** No fan-out across multiple
   agent/skill files in a single executor. Affects Cluster 2 ({48.5}+{48.14}+{48.15}).

## Sequencing (Liam directive, PLAN ADDENDUM §13.6 build sequence)

- **{48.15}** pulled forward — runs FIRST (worker-corpus archival;
  `stop-worker.sh --archive`). Dep `[]`. Single task-executor.
- **{48.5}** SECOND — workflow-evaluator agent + evaluate-workflow companion. Re-scoped to
  **triggered / async**, NOT blocking session-end. NARROWED to efficiency-metrics +
  recurring-finding surfacing; NO LONGER writes the retro record (O-of-O `handoff` owns
  authoring). One task-executor; skill-informed invocation order above.
- **{48.14}** THIRD — `evaluate-findings` skill (adjudication playbook). Modelled on
  `docs/research/memory-transcript.md`. Deps `[3]` + uses {48.15} archival output. One
  task-executor.
- **{48.16}** FOURTH — forward bulk ID-prefix rename for ~25 spec dirs. Lowercase `id-NN`
  prefix (Liam S275 ratification — NOT uppercase). Affects `docs/specs/*` dirs that
  pre-date the convention. Careful — one task-executor; gitnexus impact analysis on each
  rename.

## Dispatch cadence (per Subtask)

For each Subtask above:

1. Dispatch `task-executor` Agent with the Subtask brief from PLAN.md.
2. Dispatch `task-checker` Agent (variant=standard) on the executor's commit.
3. On Checker PASS → cherry-pick onto your worker branch, journal block via
   `bun scripts/ledger-cli.ts update-subtask 48 <M> --details <journal>`, flip status to
   `done`.
4. On Checker PASS_WITH_NOTES → triage notes:
   - In-scope → fix-Executor (new commit, never `--amend`).
   - Out-of-scope → `workflow-curator` Agent.
5. On Checker FAIL → fix-Executor with finding packet; loop.

## Inherited Liam ratifications (S275 → S276)

- **Push norm:** push is part of implementation cadence, NOT Liam-gated.
- **Worker prefix:** lowercase `id-NN` (not uppercase). Applies to {48.16} rename target.
- **Sandbox:** `48.11` sentinel hook blocks unlink on
  `.claude/skills/workflow-orchestration/SKILL.md`. Workaround:
  `dangerouslyDisableSandbox: true` on cherry-picks touching SKILL files.
- **Cherry-pick aliasing (OQ-S274-1):** prefer `format-patch + am` when source SHA may
  live at HEAD in a sibling worktree.

## OQs known going in

- **OQ-S271-1** gate autonomy (auto-deprecate-existing vs always-flag-for-human)
- **OQ-S271-2** Cluster-4-first vs ID-23 fold-in timing (NOT this wave — {48.7-9})
- **OQ-S271-3** schema granularity (per-record vs per-finding)
- **OQ-S271-4** similarity mechanism (keyword vs Mempalace semantic)
- **OQ-S274-3** = {48.16} forward bulk rename (RESOLVED — implement now)
- **OQ-S274-4** sentinel TTL 600s tuning (DEFER — not this wave)
- **OQ-S274-5** retro char budgets (DEFER until {48.6} habit lands)

Surface NEW OQs via OQ-escalation channel — do NOT bend sibling-only dep constraint.

## Quality gates (per wave close)

- `bun run test` GREEN
- `bun lint` clean (BABEL `lib/mcp/app-bundles.ts` baseline acceptable)
- `bun run knip` baseline preserved (105 unused — do not tighten)
- Ledger-CLI tests: `bun run test scripts/tests/ledger-cli/` GREEN (110/110)
- `parseTaskListWithWarnings` clean on `docs/reference/task-list.json`

## Final report

Before `/exit`, write to `<events_dir>/final_report.yaml`. Schema:

```yaml
summary: <2-3 sentences on what shipped>
commits: [<SHA: subject>...]
dispositions:
  48.5: { status, checker_verdict, cherry_pick_sha }
  48.14: { ... }
  48.15: { ... }
  48.16: { ... }
OQs_for_parent: [<OQ-shape per oq-escalation/PRODUCT.md>...]
next_session_handoff: <1 paragraph>
```

## Out of scope (escalate, do NOT silently expand)

- {48.6} retro habit + harness seeding (Wave 3 per PLAN; deps {48.5})
- {48.7-13} Checker / Executor / quality-gate hardening (ID-23-gated per PLAN)
- Any cross-Task touch outside ID-48 surface.
