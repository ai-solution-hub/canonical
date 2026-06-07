# cmux Sub-Orchestrator Brief — S274 / ID-53 Stage-5 RESEARCH→PRODUCT→TECH

**Worker name:** `subo-id-53-stage5` **Parent tip SHA:** `f63aba0a` **Worker branch:**
`cmux-worker-subo-id-53-stage5-<auto>` **Role:** SUB-ORCHESTRATOR (not leaf worker)

## READ FIRST (in order)

1. `docs/reference/task-list.json` — ID-53 record (currently `spec_needed`; no subtasks
   yet).
2. `docs/research/s273-canonical-pipeline-finals/id49-final.yaml` —
   `subtasks_deferred.ID-49.5.research_findings` carries the empirical S273 dig
   (resolve_entities API shape, schema gap, mismatch reasoning).
3. `docs/themes/canonical-pipeline/reference/canonical-pipeline-sequencing.md` — v1
   master, §entity-resolution context.
4. `docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md` — current Stage-5 placeholder
   (extract_entity_mentions output currently DISCARDED at flow.py:834 — verified S273).
5. `scripts/cocoindex_pipeline/flow.py` + `scripts/cocoindex_pipeline/extraction.py` —
   empirical baseline (what the @coco.fn produces today; where the discard happens).
6. `supabase/types/database.types.ts` — `entity_mentions` row shape (NO `op_id` column —
   verified S273; CHECK enum matches `EntityMentionExtraction.entity_type` 12 Literals).
7. `.claude/skills/spec-driven-implementation/SKILL.md` +
   `.claude/skills/write-product-spec/SKILL.md` +
   `.claude/skills/write-tech-spec/SKILL.md`.

## Scope — full spec chain RESEARCH→PRODUCT→TECH (USER DIRECTIVE)

Liam: "Stage-5 - start with RESEARCH.md first, to inform specs. Leaning towards net-new
flow-scope, just need to understand wider platform implications."

This means the spec chain is:

- {53.1} RESEARCH.md FIRST (you author via Planner) — load-bearing empirical investigation
  including wider platform implications.
- {53.2} PRODUCT.md — invariants spec covering ratified architecture.
- {53.3} TECH.md — one-to-one Proposed changes vs PRODUCT invariants.
- {53.4} PLAN.md — decomposition into Subtasks (deferred — only if compound; flag in TECH
  whether needed).

### Phase 1: {53.1} RESEARCH.md authoring

- Dispatch ONE FRESH `task-planner` via `write-research-spec` (or
  `spec-driven-implementation` if write-research-spec doesn't exist as standalone — check
  `docs/reference/skill-routing-map.md`).
- Brief must direct the Planner to investigate:
  - **Architecture decision A vs B**:
    - **A** = per-doc deterministic canonicalisation (inside `ingest_file` reactive
      scope) + deferred faiss cross-doc resolution.
    - **B** = net-new flow-scope post-fan-out resolution stage (UPDATE pass after
      `mount_each` `handle.ready()`). BREAKS `managed_by=USER` row-only contract.
  - **Wider platform implications of B** (USER PRIORITY): if B is chosen, what other
    Stage-5+ pipeline-level concerns does it open? (e.g., cross-doc Stage-6 UPSERT
    semantics; observability surface for "resolved entities" stage counter;
    bind_stage_counter substrate reusability — confirmed reusable per id49-final.yaml).
  - **cocoindex 1.0.3 reality**: `resolve_entities` is collection-level (Iterable[str],
    ONE faiss IndexFlatIP, computes own vectors via `embedder.embed(name)` on short
    entity-name strings — does NOT consume 49.2 `content_items.embedding`). No incremental
    API. Per-item `mount_each` cannot feed it.
  - **faiss-cpu pin**: `1.14.2` (abi3 wheel, 4.6MB download, ~30-40MB installed).
    Image-budget assessment LOW relative to Docling/torch baseline.
  - **op_id migration**: `entity_mentions` has NO `op_id` column. Other 3 row-targets
    (`content_items`, `q_a_extractions`, `source_documents`) have it. Migration must add
    `op_id uuid` — fold into rescope per Liam S273 OQ-2.
  - **Schema gaps**: verify `entity_mentions` columns / CHECK constraints / FK shape
    against latest `database.types.ts`.
  - **Cross-Task references**: ID-54 (Path-A lossy fix) — independent; T10
    (procurement-question-matching) — reads `form_template_requirements` not
    `entity_mentions`, also independent.
- Dispatch `task-checker` (variant standard) against RESEARCH.
- Commit `docs/specs/id-53-stage-5-entity-resolution/RESEARCH.md`.

### Phase 2: {53.2} PRODUCT.md authoring

- LIAM GATE: PRODUCT must EXPLICITLY recommend A or B per the wider-implications evidence
  in RESEARCH. Surface the recommendation as a numbered Invariant.
- Dispatch SEPARATE FRESH `task-planner` via `write-product-spec`.
- Numbered, testable Behavior invariants.
- `task-checker` gate.

### Phase 3: {53.3} TECH.md authoring

- SEPARATE FRESH Planner via `write-tech-spec`.
- One-to-one Proposed changes vs PRODUCT invariants.
- Include explicit `op_id uuid` migration spec (DDL via CLI per CLAUDE.md gotcha — never
  MCP `execute_sql`).
- `task-checker` gate.

### Phase 4: {53.4} PLAN decomposition decision

- If TECH carries compound invariants / multiple migrations / chain-dependent slices / >2h
  estimated effort → dispatch FRESH Planner via `planning-and-task-breakdown` for PLAN.md.
- Otherwise note in final_report that flat-dispatch from {53.5+} is fine.

## Open Questions to surface to parent

- **OQ-53-CONTRACT-BREAK**: If B is recommended, B breaks `managed_by=USER` row-only — is
  this a permanent migration of the cocoindex contract, or temporary with a re-evaluation
  gate when cocoindex publishes proper incremental cross-doc API?
- **OQ-53-FAISS-PIN**: pin faiss-cpu==1.14.2 vs newer. Liam may want to defer until impl
  phase.
- Any wider-platform implications surfaced in RESEARCH that need a parent-level scope
  decision.

## Operating constraints — REQUIRED

- **You are SUB-ORCHESTRATOR.** Planner / Checker dispatches only. Do NOT author specs
  yourself.
- **Fresh Planner per Subtask** (Q-PLANNER-2 — RESEARCH/PRODUCT/TECH/PLAN each get a
  separate instance).
- **You own ALL ledger writes.** Sub-task records `{53.1}`, `{53.2}`, `{53.3}`, optional
  `{53.4}` appended via ledger CLI.
- **No `AskUserQuestion` — NESTED-AGENT BAN.** Child Agents Stop with finding-packet if
  blocked. You bubble OQs via OQ-escalation channel.
- **Cherry-pick safety:** parent will cherry-pick your worker branch sequentially.
- **Final report.** Before `/exit`, write `<events_dir>/final_report.yaml` with:
  `summary`, `research_commit`, `product_commit`, `tech_commit`, `plan_commit_or_skipped`,
  `subtasks_appended`, `architecture_recommendation` (A or B + 1-sentence justification),
  `op_id_migration_spec`, `OQs_for_parent`.

## Success criteria

- `docs/specs/id-53-stage-5-entity-resolution/{RESEARCH,PRODUCT,TECH}.md` committed.
- Optional `PLAN.md` per Phase 4 decision.
- Subtasks `{53.1}`–`{53.3}` (and `{53.4}` if PLAN authored) in `task-list.json`.
- Architecture recommendation A/B with wider-platform-implications evidence in RESEARCH.
- `op_id uuid` migration spec'd (DDL via CLI).

## DO NOT

- DO NOT use `ExtractByLlm` or `LlmSpec` anywhere (cocoindex 1.0.3 absent).
- DO NOT touch any Task other than ID-53 in `task-list.json`.
- DO NOT write or apply the `op_id` migration this session — TECH spec only. Impl Subtasks
  are S275+.
- DO NOT push to `origin`.
