# cmux Terminal Brief — workflow-evaluation investigation (S264 → run S265)

**Your role:** Orchestrator for the **workflow-evaluation** investigation — Task **ID-48**
(`{48.1}` RESEARCH → `{48.2}` PLAN) **co-investigated with ID-23**. Run
`workflow-orchestration`. NOTE: this terminal is partly evaluating the workflow _itself_ —
be alert to the meta-loop (the anti-patterns you're cataloguing can occur in your own
run).

**Bootstrap (read once):**

- `CLAUDE.md`
- **`docs/specs/workflow-evaluation/feedback-dossier-S264.md`** — THE primary input (ID-32
  final-report lessons + Liam's 9 notes + open questions + suggested approach). Start
  here.
- `docs/reference/task-list.json` → Task **ID-48** (48.1 + 48.2 `details` are
  load-bearing)
  - Task **ID-23** (all subtasks — the code-intelligence axis)
- `docs/continuation-prompts/s262-worker-reports/id32-final-report.yaml` — the 4-defect
  saga
- The `agent-development` + `create-skill` skills (the pattern for the workflow-evaluator
  agent+skill combo)

**Status:** ID-48 48.1 + 48.2 **pending** (deps `{48.2}`←`{48.1}`); ID-23 in_progress.

**Sequence:** 0. **Gotchas guidance is CAPTURED** (dossier §4.G = session-retro habit, 6
categories; `docs/specs/workflow-evaluation/retro-S264.md` is the first one). Design the
retro/gotchas surface FROM it — decide: extend the Mempalace diary, build the JSON
4th-ledger surface, or both. Treat retro-S264.md as the format proof-of-concept.

1. **`{48.1}` RESEARCH** (deps `[]`, READY) — produce
   `docs/specs/workflow-evaluation/RESEARCH.md`: evidence-backed root-cause taxonomy from
   session logs (Mempalace diaries S256–S263 + `s262-worker-reports/*` + Checker verdicts
   — ID-32 B4 + ID-28 `bind_target` are the two confirmed seeds); per-surface tweak
   inventory (dossier §6); resolve the open questions (dossier §5 — workflow-evaluator
   form, Checker-mandate matrix, `/code-review` vs `/code-simplification`, efficiency
   metrics); gotchas-surface design; **ID-23 overlap reconciliation** (this Task =
   process/eval axis; ID-23 = tooling axis).
2. **`{48.2}` PLAN** (deps `[1]`) — decompose into sibling-only implementation Subtasks
   (evaluator role files + role/skill guardrails + conventions + hooks/config +
   orchestration ergonomics + tooling + gotchas surface). PRODUCT/TECH skipped unless
   `{48.1}` finds a user-facing surface.

**Session-specific deltas (not in the ledger):**

- The 9 raw notes + categorisation live in dossier §4; the affected-surface map in §6.
- **Two confirmed blind-spec-execution instances** (ID-32 B4 + ID-28 `bind_target`) = a
  _systemic_ gap, not a one-off. The root-cause taxonomy must explain why green tests hid
  both until a late gate.
- **`/code-review`** is Anthropic's rename of `/simplify` — verify what it actually does
  now before deciding whether it replaces the `/code-simplification` skill.

**Workflow discipline (S264 lessons — dossier §2):** validate against installed reality
before spec'ing; continuous real-corpus probing; non-vacuous ACs; `bun run format`
pre-commit.

**Merge cadence — WORKER-BRANCH-ONLY (S262 pivot):** commit to YOUR worker branch only;
cherry-pick Executor work onto it; **do NOT push to `main`** — parent O-of-O integrates at
teardown. Raise OQ via `OQ-pending.md` (the gotchas guidance + design ratifications likely
need Liam).
