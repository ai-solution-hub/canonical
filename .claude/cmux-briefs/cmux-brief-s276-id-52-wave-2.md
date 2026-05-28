# Cmux Brief — subo-id-52-wave-2 — ID-52 Wave-2 ({52.18}/M1b + {52.9/10/11})

**Session:** S276. **Worker name:** `subo-id-52-wave-2`. **Base branch:** `main` @
`a2a6cdfe`.

## You are a SUB-ORCHESTRATOR, not a leaf worker

Load `workflow-orchestration` first. For every Subtask you DISPATCH a task-planner and/or
task-executor via the built-in `Agent` tool, then GATE each with a task-checker (FAIL →
fix-Executor → PASS) BEFORE committing. Do NOT author specs/plans or edit code/docs
directly as your own deliverable. Commit on your worker branch; surface Open Questions via
the OQ-escalation channel (`docs/specs/oq-escalation/PRODUCT.md`).

## Scope — ID-52 Wave-2 (M1b + per-format readers)

Implement the following 4 Subtasks on `docs/reference/task-list.json` ID-52:

- **{52.18}** M1b — dedicated `form_templates` metadata columns (`form_type` FK +
  `deadline` + `issuing_organisation` + `evaluation_methodology` + partial index)
- **{52.9}** PDF reader (pdfplumber) + shared `form_extractors/shared.py` Pydantic models
- **{52.10}** XLSX reader (openpyxl) + per-form dedup (Inv-13)
- **{52.11}** DOCX reader (python-docx) reusing existing prior-art helpers

## Pre-dispatch — READ FIRST

1. **`docs/specs/form-extraction/PLAN.md`** — entire file. Subtask spec text is §4 Phases
   2/3/4 (M1b inserted as `{52.M1b}`/id=18 between {52.7} M1 and Phase-3 {52.8}).
2. **`docs/specs/form-extraction/TECH.md`** §2.6 M1 + §2.6d M1b (DDL SQL); §2.2 shared
   `ExtractedField`/`ExtractedForm` Pydantic shape; §2.3 dedup contract.
3. **`docs/specs/form-extraction/PRODUCT.md`** — invariants
   Inv-2/Inv-7/Inv-8/Inv-9/Inv-10/Inv-11/Inv-12/Inv-13/Inv-14/Inv-15/Inv-17 (the
   per-format reader testStrategy targets).

## Sequencing (strict)

The continuation prompt framed "{52.18} M1b sequential gate → {52.9/10/11} parallel" —
that is INCORRECT for {52.10/11}. Correct shape:

- **Phase A — parallel:** {52.18} M1b (DB migration) AND {52.9} PDF reader. Disjoint
  surfaces: M1b touches `supabase/migrations/` + `database.types.ts`; {52.9} touches
  `scripts/cocoindex_pipeline/form_extractors/{pdf,shared,__init__}.py`
  - `scripts/tests/test_form_extractors.py`. May run in two parallel task-executors.
- **Phase B — parallel after {52.9} lands:** {52.10} XLSX + {52.11} DOCX both import from
  `form_extractors/shared.py` (delivered by {52.9}). Two parallel task-executors.

Cherry-pick onto worker branch sequentially after each Phase.

## DDL discipline (NON-NEGOTIABLE)

- **DDL via Supabase CLI only.** `supabase migration new` + `supabase db push`. Never use
  MCP `execute_sql` / `apply_migration`. (CLAUDE.md gotcha.)
- **Always** `cat supabase/.temp/project-ref` before push; relink to
  `turayklvaunphgbgscat` (staging) if drift.
- **Function search_path** N/A here (no PL/pgSQL functions added).
- **Regenerate types:**
  `/opt/homebrew/bin/supabase gen types typescript --project-id turayklvaunphgbgscat --schema public > supabase/types/database.types.ts`
  — diff must show 4 new columns + FK + partial index. Never hand-edit
  `database.types.ts`.

## Dispatch cadence (per Subtask)

For each Subtask above:

1. Dispatch `task-executor` Agent with the Subtask brief from PLAN.md.
2. Dispatch `task-checker` Agent (variant=standard) on the executor's commit.
3. On Checker PASS → cherry-pick onto worker branch + journal block + flip status.
4. On Checker PASS_WITH_NOTES → in-scope fix-Executor; out-of-scope to `workflow-curator`.
5. On Checker FAIL → fix-Executor with finding packet.

## M1b acceptance criteria (PLAN.md {52.M1b})

- New migration
  `supabase/migrations/<timestamp>_id52_form_templates_dedicated_metadata_columns.sql`
  with exact SQL from TECH §2.6d.
- `form_type` column carries `REFERENCES public.form_types(key)` FK.
- 4 columns COMMENT-documented per TECH §2.6d.
- `database.types.ts` regenerated; diff = 4 cols + FK + partial index.
- `bun lint` PASS (no `database.types.ts` drift); `migration-revoke-guard.yml` CI PASS.

## {52.9} acceptance criteria (PLAN.md {52.9})

- `extract(raw_bytes, filename) -> ExtractedForm` async fn shape per TECH §2.2.
- `form_extractors/shared.py` exports `ExtractedField` + `ExtractedForm` +
  `FormExtractionError` Pydantic models (these become {52.10}/{52.11}'s imports).
- SQ PDF
  (`docs/testing/test-data/templates/sq/standard-selection-questionnaire-ppn-03-24.pdf`):
  57 pages, NOT 8 (Inv-15); Annex B Q6.2 row has `is_mandatory=true`, `word_limit=500`,
  `section_name='Annex B'` (Inv-10/11/12).
- `FormExtractionError` raised on unrecoverable read; never silent-return empty (Inv-17).
- Real-behaviour test discipline — NO pdfplumber-internal mocks (test-philosophy.md).

## {52.10} acceptance criteria (PLAN.md {52.10})

- EFA `evaluation-matrix-itt-vol8.xlsx`: N fields not 2N (Inv-13 dedup).
- CSP `Cloud Security Principles Checklist V5_3.xlsx`: `TYPE RESPONSE HERE>>>>` →
  `field_type='placeholder'` (Inv-9); NCSC URLs preserved (Inv-14).
- Same `extract()` shape + `FormExtractionError` surface as {52.9}.
- `openpyxl` pin in `requirements.txt` if not explicit.

## {52.11} acceptance criteria (PLAN.md {52.11})

- Charnwood `ITT Services.docx` (1908 paragraphs + 8 tables): extracts from both.
- `Insert question title` placeholder rows → `field_type='placeholder'` (Inv-9).
- REUSES `_classify_header`, `_QUESTION_HEADERS`, `_detect_merged_cells`,
  `_is_empty_or_placeholder`, `_extract_word_limit` from
  `scripts/extract_tender_questions.py` + `scripts/analyse_template.py` (NO edits to those
  files; imports only).

## Inherited Liam ratifications (S275)

- **OQ-52-WAVE-1-A** Option 3 RATIFIED (Layer-5 KG-entity schema relaxation;
  `OntologyCVBaseSchema` + `.superRefine()` LANDED via {52.5a}/id=17).
- **{52.M1b}/id=18** Liam-ratified — NO defer to v1.1 (dedicated columns now, avoids later
  backfill).
- **Push norm:** as-needed during implementation (not Liam-gated).
- **gcloud configs** normalised (Liam S275) — staging deploy hits the right project.
- **Cloud Run deploy timeout** 30→45 min (S275). If staging deploy fails again → escalate
  **ID-55.6** (image-build optimisation).

## Cross-Task coordination

- **ID-50 collision (§3 of PLAN.md):** {52.15} retirement deletes
  `app/api/procurement/[id]/templates/[templateId]/analyse/route.ts`. Out of THIS wave but
  signal to parent if {52.15} surfaces.
- **T10 read boundary:** `form_template_requirements` shape — out of THIS wave.
- **ID-54 Path-A lossy:** separate Task; NOT this wave.

## Quality gates (per wave close)

- `bun run test` GREEN
- `bun lint` clean
- `python3 -m pytest scripts/tests/test_form_extractors.py -v` GREEN
- `bun run test __tests__/lib/ontology/markdown-parity.test.ts` GREEN (no regression)
- `migration-revoke-guard.yml` CI PASS for M1b
- `parseTaskListWithWarnings` clean

## Final report

Before `/exit`, write to `<events_dir>/final_report.yaml`. Schema:

```yaml
summary: <2-3 sentences>
commits: [...]
dispositions:
  52.18: { status, checker_verdict, cherry_pick_sha }
  52.9: { ... }
  52.10: { ... }
  52.11: { ... }
migrations: { m1b_filename, m1b_applied_to_staging }
OQs_for_parent: [...]
next_session_handoff: <1 paragraph; what {52.12} writer depends on>
```

## Out of scope (escalate, do NOT silently expand)

- {52.12} Phase-5 orchestrator + writer (next wave; deps M1b + readers)
- {52.13} integration test (deps {52.12})
- {52.14} Path C cataloguing skill
- {52.15} legacy route retirement (ID-50 coordination)
- ID-54 Path-A lossy fix
