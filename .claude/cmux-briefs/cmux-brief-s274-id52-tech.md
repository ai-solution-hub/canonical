# cmux Sub-Orchestrator Brief — S274 / ID-52 TECH + PLAN

**Worker name:** `subo-id-52-tech` **Parent tip SHA:** `f63aba0a` **Worker branch:**
`cmux-worker-subo-id-52-tech-<auto>` **Role:** SUB-ORCHESTRATOR (not leaf worker)

## READ FIRST (in order)

1. `docs/research/s273-canonical-pipeline-finals/id52-final.yaml` — load-bearing S273
   context (tech_phase_flags, OQs ratified, open PRODUCT-MAY-PROPOSE items).
2. `docs/specs/id-52-form-extraction/PRODUCT.md` — the ratified PRODUCT spec (26
   invariants, Liam-ratifications in `## Ratifications (S273)`).
3. `docs/specs/id-52-form-extraction/RESEARCH.md` — empirical grounding ({52.1} artefact).
4. `docs/themes/canonical-pipeline/reference/canonical-pipeline-sequencing.md` — v1
   master; where any spec conflicts, sequencing doc wins.
5. `docs/themes/canonical-pipeline/phase-0-investigation/07-collapse-list.md` — collapse
   register (MUST be updated re `analyse/route.ts` retirement — see Phase 3).
6. `.claude/skills/workflow-orchestration/SKILL.md`,
   `.claude/skills/write-tech-spec/SKILL.md`,
   `.claude/skills/planning-and-task-breakdown/SKILL.md`.
7. `docs/reference/task-list.json` — ID-52 record (currently `in_progress`; 2 subtasks
   `done` for {52.1}+{52.2}).

## Scope

### Phase 1: {52.3} TECH.md authoring

- Dispatch ONE FRESH `task-planner` (Agent tool, opus-4-7 with `thinking: 'max'`) via
  `write-tech-spec`.
- Brief carries: read PRODUCT.md in full + RESEARCH.md + sequencing doc + canonical
  CLAUDE.md TypeScript conventions.
- **Honour ALL `tech_phase_flags` from `id52-final.yaml`** (verbatim — these are gates,
  not suggestions):
  1. HARD: cocoindex.ExtractByLlm + cocoindex.LlmSpec are ABSENT in 1.0.3 → custom
     `@coco.fn`, NOT ExtractByLlm. S234 feedback-findings §5 direction SUPERSEDED.
     Re-verify any cocoindex symbol against pin.
  2. Per-format reader-libs: `pdf-parse` + `xlsx/SheetJS` ABSENT package.json;
     `pdfplumber==0.11.9` present Python-side; `exceljs@4.4.0` present TS-side; DOCX stack
     `mammoth`/`turndown`/`docx` present TS-side. Prior art:
     `scripts/extract_tender_questions.py`, `scripts/analyse_template.py`.
  3. TS-vs-Python placement of Path B (pipeline=Python; app-write=TS); folder→workspace
     mechanism (R3); CV-loader fix direction (extend Zod STATUS_VALUES to 'applied' VS
     re-baseline 4 APPLIED-\* CV files; PLUS `form_type` triple-source lockstep CV ↔
     `form_types` table ↔ Python `Literal`).
  4. Inv-16 (re-ingest idempotency) + Inv-21 (human-confirmed catalogue write) need TECH
     to specify mechanics; PRODUCT states outcomes only.
- TECH must one-to-one map Proposed changes against PRODUCT's 26 numbered invariants.
- Dispatch ONE `task-checker` (variant standard) against TECH output. FAIL → fix-Planner
  loop → PASS_WITH_NOTES or PASS.
- Commit TECH.md to your worker branch with conventional commit
  `docs(spec): ID-52.3 TECH.md — ...`.

### Phase 2: {52.4} PLAN.md decomposition

- Dispatch a SEPARATE FRESH `task-planner` via `planning-and-task-breakdown`.
- Sibling-only dependencies (forcing-function constraint per Q-PLANNER-2). If cross-Task
  deps surface, escalate Task-split.
- **R4 ontology CV-loader fix likely sequences FIRST** (gates T7 / form-extraction / T10)
  — note this in PLAN sequencing.
- Output: TM-shape Subtask records `{52.5+}` with load-bearing `details`, one-line
  `testStrategy`, sibling-only deps.
- Checker gate against PLAN.
- YOU write Subtasks to `task-list.json` via ledger CLI on your worker branch (NOT the
  Planner — Planner returns records, you persist).

### Phase 3: collapse-list update + retirement subtask (USER DIRECTIVE)

Per Liam S274:

- Update `docs/themes/canonical-pipeline/phase-0-investigation/07-collapse-list.md` to
  reflect `analyse/route.ts` retirement under OQ-52-WORKSPACE Option-A (folder→workspace
  fully-pipeline-owned write retires app-side `analyse/route.ts` blank-form-structure
  ownership — see `id52-final.yaml` ratification line "Migrates ownership off app-side
  analyse/route.ts").
- Add a Subtask under ID-52 (likely sequence after {52.4} PLAN lands) titled "Retire
  app-side `app/api/analyse/route.ts` blank-form-structure write path" with details
  capturing: surface, scope (which writes retire vs retain), test deletions (api-test
  impact assessment), GitNexus impact-analysis FIRST.
- This retirement subtask is INSIDE ID-52, NOT a separate Task. PLAN Planner can fold it
  as part of `{52.5+}` if convenient, OR you author it directly after PLAN ratification —
  your call.

### Phase 4: surface open PRODUCT-MAY-PROPOSE items for parent

The 3 PRODUCT-MAY-PROPOSE items in `id52-final.yaml::open_product_questions`
(OQ-52-CATALOGUE, OQ-52-LOSSY, OQ-52-UI-UPLOAD-TENSION) are LIAM-GATED — not yours to
resolve. Note (in final_report):

- OQ-52-LOSSY → already promoted to ID-54 in S273 (cross-link, don't duplicate).
- OQ-52-CATALOGUE + OQ-52-UI-UPLOAD-TENSION → bubble back to parent for Liam ratification
  (these block real impl, not TECH+PLAN authoring).

## Operating constraints — REQUIRED

- **You are SUB-ORCHESTRATOR.** Planner / Checker dispatches only. Do NOT author TECH.md
  or PLAN.md content yourself.
- **You own ALL ledger writes.**
- **No `AskUserQuestion` — NESTED-AGENT BAN.** Your dispatched Agents must NOT invoke
  `AskUserQuestion`. If blocked, they Stop with finding-packet; you escalate via OQ
  channel if needed.
- **Fresh Planner per spec subtask** (Q-PLANNER-2): one Planner for TECH, separate Planner
  for PLAN.
- **Cherry-pick safety:** child Executor / Planner FIRST action =
  `git fetch origin main && git reset --hard origin/main` IF they need
  orchestrator-current state (Planner Agents at default isolation don't usually need this;
  only worker-branch Executors do).
- **Final report.** Before `/exit`, write `<events_dir>/final_report.yaml` with:
  `summary`, `tech_commit`, `plan_commit`, `subtasks_appended` (Subtask IDs + titles),
  `collapse_list_commit`, `retirement_subtask_id`, `open_product_questions_for_parent`
  (cross-link OQ-CATALOGUE + OQ-UI-UPLOAD-TENSION).

## Success criteria

- `docs/specs/id-52-form-extraction/TECH.md` committed, Checker PASS or
  PASS_WITH_NOTES-all-resolved.
- `docs/specs/id-52-form-extraction/PLAN.md` committed with Subtask records persisted to
  `task-list.json`.
- `07-collapse-list.md` updated with `analyse/route.ts` retirement entry.
- Retirement Subtask present under ID-52.
- Final report YAML present.

## DO NOT

- DO NOT author TECH.md or PLAN.md content yourself — that's the Planner's role.
- DO NOT use `ExtractByLlm` or `LlmSpec` anywhere in TECH (cocoindex 1.0.3 absent).
- DO NOT touch any Task other than ID-52 in `task-list.json` (except the retirement
  Subtask which is under ID-52).
- DO NOT push to `origin`.
