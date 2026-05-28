# Cmux Brief — subo-id-56-research — ID-56 content-model PLAN authoring

**Session:** S276. **Worker name:** `subo-id-56-research`. **Base branch:** `main` @
`a2a6cdfe`.

## You are a SUB-ORCHESTRATOR, not a leaf worker

Load `workflow-orchestration` first. Author specs via FRESH Planner instances per
Q-PLANNER-2 (one Planner per spec slice, NOT a persistent instance). For each spec
artefact you DISPATCH a fresh `task-planner` Agent, then GATE the output with a
`task-checker` Agent (variant=standard) BEFORE Liam ratification. Do NOT author
specs/plans directly as your own deliverable. Surface Open Questions via the OQ-escalation
channel (`docs/specs/oq-escalation/PRODUCT.md`).

## Scope — ID-56 content-model-invariants PLAN authoring

Task `docs/reference/task-list.json` ID-56 status = `spec_needed`. PRODUCT + TECH ratified
S273 (a40cf547 + eda9a8ae). PLAN.md MISSING. Liam-flagged for S276.

**Phases:**

1. RESEARCH revisit (reconcile S275 deltas + chunking-strategy review)
2. PRODUCT.md + TECH.md amendment (IF reconcile surfaces drift)
3. PLAN.md authoring (decomposition into impl Subtasks {56.5+})

## Pre-dispatch — READ FIRST

1. **`docs/specs/content-model-invariants/PRODUCT.md`** — ratified S273. Especially
   §C-13 + §C-60 + GAP-CMI-001 RESOLVED + GAP-CMI-002 RESOLVED.
2. **`docs/specs/content-model-invariants/TECH.md`** — companion READ-contract (a40cf547 /
   eda9a8ae).
3. **`docs/themes/canonical-pipeline/reference/canonical-pipeline-sequencing.md`** §1,
   §2.1, §2.5, §4 — v1 master. Refreshed S275 Phase-0.
4. **`docs/reference/task-list.json`** ID-56 record. Deps `[28, 49]` both DONE.

## OPEN QUESTION — TWO ingest paths vs SINGLE path (Liam-flagged)

PRODUCT.md §C-13 + §C-60 explicitly recognises **TWO paths**:

- **App-side chunker** (`lib/content/chunking.ts`) — writes `content_chunks` table with
  `parent_chunk_id` self-ref FK + `position` + `heading_path`.
- **Cocoindex pipeline** — document-granular, does NOT chunk (sequencing §2.5: "no
  chunking stage by design … `SplitRecursively` intentionally unused").

Liam's mental model from continuation prompt: **SINGLE path** (UI = thin wrapper dropping
document into localfs folder → cocoindex picks it up).

**RESEARCH RESOLUTION REQUIRED before PLAN authoring.** Pre-decision sources to review:

- `https://cocoindex.io/blogs/index-code-base-for-rag/` — cocoindex's own code-RAG example
  USES `SplitRecursively` + chunking; full flow shown.
- `https://github.com/ekimetrics/adaptive-chunking` — adaptive-chunking repo; assess for
  KH-requirements suitability.

After RESEARCH, surface this to the parent via OQ-escalation channel for Liam
ratification. Decision options likely:

- **(a) Keep both paths** as-is (PRODUCT current shape; app-side chunker for
  upload/`analyse` routes, cocoindex doc-granular for canonical pipeline).
- **(b) Retire app-side chunker** — cocoindex becomes the SINGLE path; add a cocoindex
  chunking stage (using `SplitRecursively` or adaptive-chunking).
- **(c) Reverse split** — cocoindex chunks too (writes `content_chunks` rows); app-side
  chunker retires; UI becomes thin wrapper.

**DO NOT pre-empt Liam's decision.** Surface via OQ-escalation; await ratification BEFORE
PLAN authoring.

## S275 deltas to reconcile (per continuation prompt)

PRODUCT/TECH was ratified S273. The following landings post-date that ratification and
need reconciliation:

- **Stage-5 Option B writes** (entity-resolution, `managed_by=USER` row-only) — may affect
  C-50/C-51/C-52 invariants.
- **Stage-4 LANDED via 49.2** —
  `LiteLLMEmbedder("text-embedding-3-large", dimensions=1024)` confirmed live. C-30
  already references this; verify still aligned post-S275.
- **Form-extraction R3 Option A** (R3 folder→workspace, pipeline-owned write) per ID-52
  PLAN — affects content-model in form-template path; may need cross-reference in C-60 or
  new C-7x invariant for `form_templates` rows.
- **M1b columns** (ID-52 NEW Subtask {52.18}/id=18) — dedicated `form_templates` metadata
  columns. Probably outside C-\* scope (form_templates is a separate table from
  content_items) but verify.
- **Fixture-staging** (ID-49.10 DONE) — testing substrate; may affect testStrategy shape
  for PLAN impl Subtasks.

## Dispatch cadence

**Phase 1 — RESEARCH revisit:**

1. Dispatch fresh `task-planner` Agent ({56.1} RESEARCH.md) — review S275 deltas, the
   TWO-paths question, and the cocoindex chunking decision sources.
2. Output: `docs/specs/content-model-invariants/RESEARCH.md` (or amendment).
3. Dispatch `task-checker` Agent (variant=standard).
4. Surface OQ to parent for Liam ratification (TWO-paths decision).

**Phase 2 — PRODUCT/TECH amendment (CONDITIONAL on RESEARCH findings):**

- IF reconcile surfaces drift → fresh `task-planner` Agent for PRODUCT amend (Q-PLANNER-2:
  distinct from RESEARCH Planner instance).
- IF PRODUCT amends → SEPARATE fresh `task-planner` Agent for TECH amend (Q-PLANNER-2
  fresh review).
- Both gated by Checker; both await Liam ratification.

**Phase 3 — PLAN.md authoring:**

- SEPARATE fresh `task-planner` Agent invokes `planning-and-task-breakdown` directly
  against ratified PRODUCT + TECH.
- Output: `docs/specs/content-model-invariants/PLAN.md` + populated impl Subtask list
  `{56.5+}` to append via `bun scripts/ledger-cli.ts add-subtask 56 '<json>'`.
- Gated by Checker; await Liam ratification.

## Q-PLANNER-2 fresh-instance rule (NON-NEGOTIABLE)

- The Planner who wrote `{N.1}` MUST NOT be the same instance that writes `{N.2}`.
- The Planner who wrote `{N.2}` MUST NOT be the same instance that writes `{N.3}`.
- A SEPARATE Planner may run `planning-and-task-breakdown` for `{N.4}` PLAN.md.
- Context-fresh-per-Subtask constraint preserves spec review independence.

## Sibling-only dependency forcing function

Subtask dependencies MUST be siblings within ID-56. If cross-Task deps surface during PLAN
authoring, escalate (Task-split / Task-merge) — do NOT bend the constraint.

## Inherited Liam ratifications

- **Push norm:** as-needed during implementation (Planner output → ledger write → push).
- **Worker prefix:** lowercase `id-NN`.
- **Spec dir convention (CLAUDE.md):** `docs/specs/ID-N-<slug>/` with canonical uppercase
  artefacts (RESEARCH.md / PRODUCT.md / TECH.md / PLAN.md). ID-56's pre-existing dir
  `docs/specs/content-model-invariants/` predates the `ID-N-` prefix convention — **NOT
  mass-migrated.** Author in place.

## Quality gates

- RESEARCH.md authored → Checker PASS → Liam ratify TWO-paths OQ
- PRODUCT/TECH amend (if needed) → fresh Planner → Checker PASS → Liam ratify
- PLAN.md authored → Checker PASS → Liam ratify
- `parseTaskListWithWarnings` clean on `docs/reference/task-list.json` after
  Subtask-record additions

## Sub-O OQ escalation expected

This Task is unusually OQ-heavy. EXPECT 2-3 OQ-escalations to the parent during the
session:

1. TWO-paths vs SINGLE-path decision (RESEARCH phase)
2. (Conditional) PRODUCT/TECH amendment scope
3. (Conditional) chunking strategy specifics if (b) or (c) chosen

Use the OQ-escalation channel; do NOT silently proceed.

## Final report

Before `/exit`, write to `<events_dir>/final_report.yaml`. Schema:

```yaml
summary: <2-3 sentences>
artefacts:
  RESEARCH: { path, sha, checker_verdict, liam_ratified }
  PRODUCT_amend: { path, sha, checker_verdict, liam_ratified } # null if not amended
  TECH_amend: { path, sha, checker_verdict, liam_ratified } # null if not amended
  PLAN: { path, sha, checker_verdict, liam_ratified }
subtask_records_added: [<id>...] # {56.5+} ledger additions
two_paths_decision: <a|b|c — what Liam ratified>
chunking_strategy_decision: <details if (b) or (c)>
OQs_for_parent: [...]
next_session_handoff: <1 paragraph; what {56.5+} impl wave needs>
```

## Out of scope (escalate, do NOT silently expand)

- ID-56 impl Subtasks {56.5+} — only AUTHOR records, do NOT dispatch executors.
- Edits to canonical-pipeline-sequencing.md (only if Liam ratifies and dispatches
  separately).
- Edits to `lib/content/chunking.ts` (impl work, not this wave).
- Edits to cocoindex pipeline `flow.py` (impl work, not this wave).
- Cross-Task touches: ID-28 / ID-37 / ID-49 / ID-52 specs.
