# cmux sub-orchestrator brief — S277 / subo-id-53-wave-c (canonical pipeline Stage-5 entity-resolution)

## Role

You are a **SUB-ORCHESTRATOR**, not a leaf worker. Load the `workflow-orchestration` skill
first. For every Subtask: DISPATCH a `task-executor` via the Agent tool, then GATE it with
a `task-checker` (FAIL → fix-Executor → PASS) BEFORE you cherry-pick its commit onto your
worker branch. Do NOT edit code/tests directly as your own deliverable. You own dispatch,
gating, sequential cherry-pick integration, and ledger status flips on your branch.

## First actions (worktree hygiene — MANDATORY)

1. `git fetch origin main && git reset --hard origin/main` — start on the current tip. It
   ALREADY carries ID-42 {42.9}'s flow.py Stage-6 provenance edit (just integrated) — your
   {53.11} builds on top of it.
2. `supabase link --project-ref turayklvaunphgbgscat` (staging). Verify
   `cat supabase/.temp/project-ref` is staging before any `db push`.

## Scope — Task ID-53 (in_progress): "Canonical pipeline Stage-5 entity-resolution" — Wave C

Read live Subtask details from `docs/reference/task-list.json` (task id `"53"`). Wave A
({53.5/6/7/8}) + Wave B ({53.9/10/12}) are DONE (S275/S276; the S276 status drift was
reconciled this session). KhEntityEmbedder (`entity_embedder.py`), KhPairResolver
(`pair_resolver.py`), and the entity_mentions mount are LIVE.

Dispatch Wave C in dependency order:

1. **{53.11}** (deps [5,7,8,10] — all done) — `entity_mentions` `declare_row` in
   `ingest_file`. EDIT `scripts/cocoindex_pipeline/flow.py:~864` — replace the discarded
   `await extract_entity_mentions(content_text)` with row construction
   (`em_target.declare_row` per TECH §P-3): Pydantic `mention_confidence` → DB
   `confidence` (Inv-15); `source_span_start/end` in metadata jsonb (Inv-16); `op_id` from
   `current_flow_meta().op_id` (memo-respecting Inv-7); stable PK
   `uuid.uuid5(_KH_PIPELINE_DOC_NS, f'em:{rel_path}:{idx}')`. Direct file imports.
2. **{53.13}** (deps [5,9,11,12]) — `_run_stage_5_resolution` core + `app_main` attach
   (post-fan-out resolution; Option-B architecture). Also touches `flow.py`.
3. **{53.14}** (deps [13]) — integration test suite (failure-mode, coexistence, corner
   cases). `bun run test:integration`; sandbox-disabled for cocoindex sub-process.
4. **{53.15}** (deps [13]) — `_classify_stage_exception` `entity_resolution_failed` branch
   (T-OQ1).
5. **{53.16}** (deps [14,15]) — `canonical-pipeline-sequencing.md` amendment (§P-13 +
   Inv-19).

{53.13}.details carries the S276 ID-53.M consumer-side CanonicalSide guidance journal
(PairDecision.canonical = CanonicalSide StrEnum, NOT plain str) — honour it.

## Cross-fleet coordination (READ — load-bearing)

- **flow.py:** {53.11} + {53.13} edit `scripts/cocoindex_pipeline/flow.py` `ingest_file` /
  `app_main`. ID-42 {42.9}'s provenance edit is ALREADY on your base — build alongside it,
  do not revert it. The PARENT will stagger ID-52 {52.12} (form-extractor mounts, the
  third flow.py editor) AFTER your Wave-C flow.py edits land — so make {53.11}/{53.13}
  clean and surface their commit SHAs in your final report.
- Entity-resolution writes `entity_mentions` rows (`managed_by=USER`, row-only contract
  deliberately broken per Inv-2) — coexists with the per-item memo cascade.

## Gotchas inherited

- `gitnexus_impact` before editing flow.py symbols; `gitnexus_detect_changes` after.
- cocoindex boot/integration tests need `dangerouslyDisableSandbox: true` (LMDB mmap).
- DDL via CLI only if any migration is touched; staging project-ref verify; no MCP
  `execute_sql`/`apply_migration`. No barrel re-exports; `sb()`/`tryQuery()` no silent
  failures. Zod UUID strict — `crypto.randomUUID()` in seeds. UK English; no emoji.

## Escalation + reporting

- Load the OQ-escalation skill alongside `workflow-orchestration`. **Do NOT use
  AskUserQuestion** (headless stall — recurred 3× S276). Surface Open Questions via the
  OQ-escalation channel; the parent polls your `stop` events.
- Commit on your worker branch only. Do NOT edit `docs/reference/task-list.json` beyond
  your own Subtask status flips + `<info added on …>` journal blocks.
- Before `/exit`, write `<events_dir>/final_report.yaml` with sections {summary, commits
  (incl. the {53.11} + {53.13} flow.py SHAs), dispositions, OQs_for_parent,
  next_session_handoff}.
