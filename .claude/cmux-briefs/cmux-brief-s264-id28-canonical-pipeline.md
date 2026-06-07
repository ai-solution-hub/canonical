# cmux Terminal Brief — ID-28 canonical pipeline Stage-6 (S264)

**Your role:** Orchestrator for Task **ID-28** (cocoindex canonical pipeline). Run
`workflow-orchestration`. **CRITICAL PATH** — the pipeline currently writes NO corpus
rows. This is **Planner-led** spec work, not a quick fix.

**Bootstrap (read once):**

- `CLAUDE.md`
- `docs/reference/task-list.json` → Task **ID-28**, Subtask **28.20** (`details` is the
  full mandate + the fictional-`bind_target` discovery — read it whole)
- `docs/specs/id-28-cocoindex-flow-scaffolding/{PRODUCT,TECH}.md`
- The source docs 28.20 mandates re-grounding against:
  `docs/plans/phase-0-investigation/architecture/02-data-flow.md` §3 (6-stage topology) +
  §5 (op_id hybrid); `0.9-decision-graph.md` §11.4.1 N7;
  `docs/research/cocoindex-1.0.3-extractbyllm-spec-reality-investigation.md`

**Status:** 28.1–28.19 **done**. Pending: **28.20** (deps `[]`, **READY**).

**28.20 — RESEARCH → spec re-authoring → decomposition (DISPATCH A PLANNER):**

1. **INVESTIGATE + RESEARCH FIRST — do NOT re-implement the fictional spec.**
   `flow.py:742-755` calls `content_text.bind_target(ci_target, op_id=…)` under
   `type: ignore` — `bind_target` is NOT a cocoindex DataSlice method in ANY version.
   Consequence: 28.9 (op_id stamping) + 28.8 (Stage-6) were closed against a fictional
   API; op_id columns write NULL; Stage-6 does not UPSERT.
2. Establish the REAL cocoindex contract empirically against the installed source:
   idiomatic write path is **`collect → export`** where every written column (incl.
   `op_id`) is a FIELD of the collected row (no binding API). `stamp_extraction_base()`
   already reads op_id from `FLOW_META_CTX`.
3. Author/amend specs (RESEARCH re-grounding + PRODUCT/TECH amendments), THEN decompose
   into implementation Subtasks (this subtask SPAWNS them).

**In scope (criticality for "replace current setup + re-ingest full corpus"):**

- Real Stage-6 collect/export write path (replaces fictional `bind_target`) — **CRITICAL**
  (without it the pipeline writes nothing).
- `op_id` as a row field — Inv-11/12 reverse-lookup (FOLDS IN former ID-44.1 + the Inv-11
  gap; replaces non-functional 28.9).
- Real source binding (T8 shipped empty — PLAN O-Q8).
- Stage-4 embedding + Stage-5 entity-resolution stubs — assess criticality for search over
  the re-ingested corpus.
- Retry/observability SPEC accuracy (ID-44.2 area): correct the `bind_target(op_id=)` §P-4
  sketch; layer the real reality (cocoindex native LLM HTTP-429 retry vs KH-owned tenacity
  wrapper vs zero per-row postgres retry).

**Folded in (Curator-triaged S262):**

- IN-SCOPE test-hardening: replace the cocoindex "cooperative-stub" design (shared `flow`
  module + runtime patching) with per-file `importlib.reload()` isolation; all
  `test_cocoindex_flow_*.py` pass in ascending AND descending order. Fold backlog
  **ID-177** (idle_mode↔server ContextKey clash) if convenient.

**Process learning (Liam, S262):** validate API reality against the installed codebase
BEFORE spec'ing or implementing. Blindly following a spec because a subtask says so is the
failure mode this subtask corrects.

**Workflow discipline (S264 lessons —
`docs/specs/workflow-evaluation/feedback-dossier-S264.md` §2; ID-48 formalises):**
validate contracts/APIs against the INSTALLED code before spec'ing or implementing — if
the spec contradicts reality, ESCALATE, don't execute it blindly (ID-32 B4 + ID-28
`bind_target` were specs against assumptions); run the real-corpus/integration probe
CONTINUOUSLY, not as a final gate; keep ACs non-vacuous (lint-delta paired with
tsc/no-undef); `bun run format` before every commit.

**Merge cadence — WORKER-BRANCH-ONLY (S262 pivot):** commit to YOUR worker branch only;
cherry-pick Executor work onto it; **do NOT push to `main`** — parent O-of-O integrates at
teardown. Raise OQ via `OQ-pending.md` for any Liam decision (spec ratifications likely
here).
