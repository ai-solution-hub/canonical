# cmux Terminal Brief — ID-43 OQ-escalation channel (S262)

**Your role:** Orchestrator for Task **ID-43** (single-track `main`). Run
`workflow-orchestration`. This session covers the **spec-authoring** Subtasks 43.2 + 43.3
only — NOT implementation.

**Bootstrap (read once):**

- `CLAUDE.md`
- `docs/reference/task-list.json` → Task **ID-43**
- `docs/specs/id-43-oq-escalation/PRODUCT.md` (33 invariants; note **OQ-Q1/Q2/Q3 are
  UNRATIFIED**)

**Status:** 43.1 PRODUCT done. Pending: **43.2 TECH**, **43.3 PLAN**.

**Sequence:**

1. **43.2 TECH** — transport choice + **ratify OQ-Q1/Q2/Q3**. deps `[1]`. Ratifying the
   three open questions IS this Subtask's explicit job.
2. **43.3 PLAN** — decompose into implementation Subtasks. deps `[2]`.

**Gate (hard):** Implementation is **BLOCKED until 43.2 ratifies OQ-Q1/Q2/Q3** and 43.2 is
Checker-gated. Do NOT dispatch any implementation Subtask before 43.2 closes.

**Dispatch note:** these are Planner Subtasks → dispatch the `task-planner` agent. Per
Q-PLANNER-2, use a **FRESH Planner instance** for 43.2 TECH (a different instance than
authored 43.1 PRODUCT) — fresh review pass against the ratified PRODUCT. A separate
Planner runs `planning-and-task-breakdown` for 43.3 PLAN.

**Merge cadence:** spec artefacts commit under `docs/specs/id-43-oq-escalation/` →
cherry-pick onto `main`, fetch-before-push (shared `main`).
