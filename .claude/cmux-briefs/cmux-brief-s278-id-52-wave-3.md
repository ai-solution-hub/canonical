# Cmux Brief — subo-id-52-wave-3 — ID-52 Wave-3 ({52.12} Phase-5 writer → {52.13} integration)

**Session:** S278. **Worker name:** `subo-id-52-wave-3`. **Base branch:** `main` (worktree
branched from current HEAD).

## You are a SUB-ORCHESTRATOR, not a leaf worker

Load `workflow-orchestration` first. For every Subtask you DISPATCH a `task-executor` via
the built-in `Agent` tool, then GATE each with a `task-checker` (variant=standard; FAIL →
fix-Executor → PASS) BEFORE committing. Do NOT author specs/plans or edit code/docs
directly as your own deliverable. Commit on your worker branch (use `commit-commands`);
surface Open Questions via the OQ-escalation channel
(`docs/specs/id-43-oq-escalation/PRODUCT.md`).

## Scope — ID-52 Wave-3 (the pipeline-owned form-write path + its integration proof)

Implement exactly these 2 Subtasks on `docs/reference/task-list.json` ID-52, **strictly
sequential**:

- **{52.12}** Custom `@coco.fn` orchestrator + `mount_table_target` wiring + idempotency
  stale-row trim. **Scope L (full-session — do NOT partial-land).** Deps
  `[7,8,9,10,11,18]` all DONE.
- **{52.13}** Integration test — pipeline-owned write + idempotency + failure isolation +
  RLS + per-question metadata (Inv-18). **Scope M.** Dep `[12]` (only after {52.12} is
  PASS + cherry-picked + flipped done).

`{52.12}` MUST be Checker-PASS, cherry-picked, and status-flipped `done` before `{52.13}`
dispatches — `{52.13}` tests the write path `{52.12}` builds.

## flow.py contention is GONE

{42.9} + ID-53 {53.11}/{53.13}/{53.15} are all on `main` now. **{52.12} is the sole
remaining `flow.py` `ingest_file` editor** — no staggering, no cross-Task collision this
session.

## Pre-dispatch — READ FIRST (note the renamed spec dir path)

1. **`docs/specs/id-52-form-extraction/PLAN.md`** §Phase 5 — the {52.12} + {52.13} Subtask
   spec text.
2. **`docs/specs/id-52-form-extraction/TECH.md`** — §2.1 (manifest load at `app_main`
   start), §2.5 (form-write block steps 1-4 + `coco.mount_each` positional-arg order),
   §2.8 (idempotency UUID5 namespace + key shapes).
3. **`docs/specs/id-52-form-extraction/PRODUCT.md`** — Inv-3 (`.xls` skip), Inv-5 (no
   sentinel on resolution failure), Inv-6, Inv-7, Inv-15, Inv-16 (idempotency happy +
   shrink), Inv-17 (extraction-failure isolation), Inv-18 (per-question metadata), Inv-19
   (Path A Mode-1 unchanged), Inv-25 (RLS + catalogue visibility).
4. **Read `scripts/cocoindex_pipeline/flow.py`** `ingest_file` + the existing
   `mount_table_target` calls (ci_target/qa_target/sd_target after ~line 1029) +
   `app_main` (~line 981) before editing — this is the pipeline hot path.

## {52.12} acceptance (full detail is in the ledger `details` field — read it)

The {52.12} ledger `details` block is the canonical implementation contract. Key
load-bearing points:

- Load workspace manifest ONCE at `app_main` start (TECH §2.1); failure → flow aborts via
  `_emit_stage_error_log(manifest_missing / manifest_invalid)`.
- 2 `mount_table_target` calls after the existing targets with
  **`managed_by=ManagedBy.USER`** (preserves DDL-via-CLI-only — NO new migration;
  `form_templates` + `form_template_fields` already exist from {52.7} M1 + {52.18} M1b).
- Extend `ingest_file` signature: `+ ft_target + ftf_target`. Extend `coco.mount_each`
  signature (positional order per TECH §2.5).
- Form-write block (TECH §2.5 steps 1-4): workspace resolve → `extract_form_structure`
  call → `form_templates` declare → **stale trim**
  (`DELETE FROM form_template_fields WHERE template_id=$1 AND sequence>$2` BEFORE field
  declares) → `form_template_fields` declares.
- Idempotency UUID5: `uuid5(_KH_PIPELINE_DOC_NS, 'ft:{rel_path}')` +
  `uuid5(_KH_PIPELINE_DOC_NS, 'ftf:{rel_path}:{sequence}')` (TECH §2.8).
- Failure isolation: resolution failure →
  `_emit_stage_error_log(stage='workspace_resolution')` + 0 templates + 0 fields (Inv-5,
  no sentinel). Extraction failure → 1 `form_templates` row `status='analysis_failed'` + 0
  fields (Inv-17). `.xls` → `extract_form_structure` returns None + logs
  `form_extractor.skip` (Inv-3).
- Success row: `status='analysed'`, `workspace_id` from resolver,
  **`created_by=a0000000-0000-4000-8000-000000000001` (SERVICE_ACCOUNT_UUID — NEVER
  literal strings)**, `mime_type` from `MIME_BY_SUFFIX[suffix]`, `file_size` from
  `file.size`, `field_count=len(fields)`, `mapped_count=0`, `ingest_source='pipeline'`,
  `name` from `form_metadata.form_title or file.stem`, `description` from
  `form_metadata.evaluation_methodology`. Each field carries
  question_text/placeholder_text/field_type/fill_status/row_index/col_index/table_index/section_name/sequence/word_limit/is_mandatory/reference_urls.
- Also export `extract_form_structure` from `form_extractors/__init__.py`.

testStrategy ({52.12}):
`python3 -m pytest scripts/tests/test_cocoindex_flow_write_path.py scripts/tests/test_cocoindex_flow_stage_counts.py -v`
PASSES; `bun run test __tests__/lib/ontology/markdown-parity.test.ts` PASSES (no upstream
regression).

## {52.13} acceptance (full detail in ledger `details` — read it)

New files: `__tests__/integration/form-extraction.integration.test.ts` +
`__tests__/integration/form-extraction-rls.integration.test.ts` +
`__tests__/fixtures/form-extraction/.kh-workspace-map.json`. Copies 4 corpus fixtures into
a temp `COCOINDEX_SOURCE_PATH`. Assert: SQ.pdf → 1 template + N fields no app interaction
(Inv-6); re-ingest unchanged → same UUIDs (Inv-16 happy); remove-field-7 → N-1 +
stranded-row trimmed (Inv-16 shrink); batch [corrupt.pdf, sq.pdf, efa.xlsx,
charnwood.docx] → 3 success + 1 `analysis_failed`, batch NOT halted (Inv-17); SQ row
mime/file_size/description/name (Inv-7); SQ 57-page extent (Inv-15); RLS — viewer of
workspace A cannot SELECT workspace B templates; catalogue rows visible regardless
(Inv-25); Path A `q_a_extractions` Mode-1 tests PASS unchanged (Inv-19); per-question
metadata populated wherever source carries it, ≥1 row per fixture demonstrating each
column (Inv-18); unmapped-folder form → 0 templates + 0 fields + surfaced
`_emit_stage_error_log` (Inv-5).

testStrategy ({52.13}):
`bun run test:integration __tests__/integration/form-extraction*.integration.test.ts`
PASSES; idempotency happy+shrink, failure isolation, RLS, Inv-18 per-row metadata all
verified.

## ★ Carried OQ — Inv-17 graceful-vs-strict (Liam-ratified routing to {52.13})

S276 Wave-2: the {52.10} XLSX executor chose a graceful empty-return for the
zero-archetype case; the Checker flagged it as debatable against the Inv-17 letter. **Liam
ruling: resolve in {52.13}.** The {52.13} test MUST assert the zero-archetype path either
(a) raises `FormExtractionError` (Inv-17 strict), OR (b) returns empty with documented
graceful-not-failure semantic. If the extractor returns empty SILENTLY, the {52.13} test
MUST surface it. **If the test ends up passing silently on the graceful path → STOP and
OQ-escalate to the parent** (Liam ratifies graceful via a PRODUCT.md Inv-17 amendment).
Cross-link: subo-id-52-wave-2 `final_report.yaml` OQ-D + {52.10}.details.

## Code-intelligence discipline (Python-corpus caveat)

{52.12} edits `scripts/cocoindex_pipeline/flow.py` + `form_extractors/__init__.py` —
**Python**. Per the allowlist, gitnexus/ast-dataflow symbol discipline is TypeScript-only;
for Python use **`grep` sweeps**: before editing `ingest_file` / `app_main`, grep for
every caller and every `mount_table_target` / `mount_each` call site to confirm
signature-change blast radius. {52.13} authors `.ts` integration tests — light; no symbol
modification.

## Environment / DDL discipline (NON-NEGOTIABLE)

- **First worker action:** `supabase link --project-ref turayklvaunphgbgscat` (staging —
  worktree inherits NO link state). `cat supabase/.temp/project-ref` to confirm before any
  DB-touching test.
- **NO new migration** in this wave — `mount_table_target` with
  `managed_by=ManagedBy.USER` only. If you think you need DDL, STOP and OQ-escalate (the
  tables exist).
- `{52.13}` integration tests hit **real Anthropic + real staging Supabase**
  (`bun run test:integration`). `.env.local` is copied into your worktree via
  `.worktreeinclude`. Confirm `COCOINDEX_SOURCE_PATH` handling uses a temp dir, never the
  real binding.
- `classifyContent` / any pipeline write userId MUST be the SERVICE_ACCOUNT_UUID, never a
  literal string.

## Dispatch cadence (per Subtask)

1. Dispatch `task-executor` Agent with the Subtask brief from PLAN.md + the ledger
   `details`.
2. Dispatch `task-checker` Agent (variant=standard) on the executor's commit.
3. Checker PASS → cherry-pick onto worker branch + append `<info added on …>` journal
   block + flip status `done`.
4. PASS_WITH_NOTES → in-scope fix-Executor; out-of-scope → OQ-escalate (parent runs
   `workflow-curator`).
5. FAIL → fix-Executor with finding packet (new commit, never `--amend`). Three FAILs on
   one group → OQ-escalate (spec defect).

## Quality gates (wave close)

- `python3 -m pytest scripts/tests/test_cocoindex_flow_write_path.py scripts/tests/test_cocoindex_flow_stage_counts.py -v`
  GREEN
- `bun run test __tests__/lib/ontology/markdown-parity.test.ts` GREEN (no regression)
- `bun run test:integration __tests__/integration/form-extraction*.integration.test.ts`
  GREEN
- `bun lint` clean; `parseTaskListWithWarnings` clean on `task-list.json`

## Final report

Before `/exit`, write `<events_dir>/final_report.yaml`:

```yaml
summary: <2-3 sentences>
commits: [...]
dispositions:
  52.12: { status, checker_verdict, cherry_pick_sha }
  52.13: { status, checker_verdict, cherry_pick_sha }
inv17_resolution: <strict-raise | graceful-empty-ratified | escalated-to-parent>
OQs_for_parent: [...]
next_session_handoff:
  <1 paragraph; ID-52 remaining = {52.14} Path C, {52.15} route retirement (ID-50 coord),
  {52.16} acceptance fixtures, {52.19} nits, {52.20} Charnwood zero-fields>
```

## Out of scope (escalate, do NOT silently expand)

- {52.14} Path C cataloguing skill; {52.15} legacy `analyse/route.ts` retirement (ID-50
  coordination); {52.16} acceptance fixtures + Inv-26; {52.19} Wave-2 nits bundle; {52.20}
  Charnwood DOCX zero-fields investigation.
- ID-54 Path-A lossy fix (separate Task).
- Any DDL / new migration.
