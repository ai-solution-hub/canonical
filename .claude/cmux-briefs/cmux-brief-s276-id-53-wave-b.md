# Cmux Brief — subo-id-53-wave-b — ID-53 Wave B ({53.9/10/12})

**Session:** S276. **Worker name:** `subo-id-53-wave-b`. **Base branch:** `main` @
`a2a6cdfe`.

## You are a SUB-ORCHESTRATOR, not a leaf worker

Load `workflow-orchestration` first. For every Subtask you DISPATCH a task-planner and/or
task-executor via the built-in `Agent` tool, then GATE each with a task-checker (FAIL →
fix-Executor → PASS) BEFORE committing. Do NOT author specs/plans or edit code/docs
directly as your own deliverable. Commit on your worker branch; surface Open Questions via
the OQ-escalation channel (`docs/specs/oq-escalation/PRODUCT.md`).

## Scope — ID-53 Wave B (Stage-5 entity-resolution build-out)

Implement the following 3 Subtasks on `docs/reference/task-list.json` ID-53:

- **{53.9}** `KhEntityEmbedder` + unit test (deps [6]✓ — faiss-cpu pin done in S275)
- **{53.10}** `entity_mentions` `TableTarget` mount in `app_main` (deps []✓)
- **{53.12}** `KhPairResolver` + determinism cache + unit tests (deps [5]✓ — op_id
  migration done in S275)

## Pre-dispatch — READ FIRST

1. **`docs/specs/canonical-pipeline-stage-5-entity-resolution/PLAN.md`** — full PLAN.
   Authored S274; ratified Liam (Option B architecture; `managed_by=USER`).
2. **`docs/specs/canonical-pipeline-stage-5-entity-resolution/TECH.md`** §P-2
   `mount_each.handle.ready` resolution; §P-3 `KhEntityEmbedder`; §P-4 `KhPairResolver`.
3. **`docs/specs/canonical-pipeline-stage-5-entity-resolution/PRODUCT.md`** — Stage-5
   invariants the testStrategies verify.

## Wave-A landed in S275 (do NOT re-do)

- {53.5} Migration — `op_id` column + `entity_pair_resolutions` cache table — DONE
- {53.6} `faiss-cpu==1.14.2` exact pin in `requirements.txt` — DONE
- {53.7} `canonicalise_entity_name` pure function + unit tests — DONE
- {53.8} `extract_entity_context` Python port + byte-match tests — DONE

## Sequencing (this wave)

All 3 Subtasks have disjoint file ownership and deps already cleared:

- **{53.9}** `scripts/cocoindex_pipeline/embedders/kh_entity_embedder.py` (new) +
  `scripts/tests/test_kh_entity_embedder.py` (new)
- **{53.10}** `scripts/cocoindex_pipeline/flow.py` (extended — TableTarget mount in
  `app_main`)
- **{53.12}** `scripts/cocoindex_pipeline/resolvers/kh_pair_resolver.py` (new) +
  `scripts/tests/test_kh_pair_resolver.py` (new)

→ **Three parallel task-executors** can run simultaneously. Sequential cherry-pick onto
worker branch after each Checker PASS.

## Dispatch cadence (per Subtask)

For each Subtask above:

1. Dispatch `task-executor` Agent with the Subtask brief from PLAN.md.
2. Dispatch `task-checker` Agent (variant=standard) on the executor's commit.
3. On Checker PASS → cherry-pick onto worker branch + journal block + flip status.
4. On Checker PASS_WITH_NOTES → in-scope fix-Executor; out-of-scope to `workflow-curator`.
5. On Checker FAIL → fix-Executor with finding packet.

## Mitigation stack (RATIFIED S274 — DO NOT BEND)

- `op_id`-scoped UPDATEs only (NOT row-level overwrites)
- `entity_aliases` preload at flow start
- `PairResolver` cache via `entity_pair_resolutions` (substrate from {53.5})
- `faiss-cpu==1.14.2` exact pin (substrate from {53.6})
- Stage-counter reuse from {49.4} substrate
- `op_id` migration substrate from {53.5}
- `entity_resolution_failed` class flow → `_classify_stage_exception` at flow.py:168
  (deferred to {53.15}, NOT this wave)
- T12 sequencing gate (Liam-ratified S274)

## {53.9} acceptance criteria (PLAN {53.9})

- `KhEntityEmbedder` class with `__call__(entity_name: str) -> list[float]` (or similar
  shape per TECH §P-3).
- Uses `LiteLLMEmbedder("text-embedding-3-large", dimensions=1024)` per
  canonical-pipeline-sequencing §2.5 + ID-49.2 (sequencing reference).
- Canonicalises input via `canonicalise_entity_name` (from {53.7} substrate) before
  embedding.
- Unit test: deterministic output (same input → same vector); rejects empty string;
  handles unicode correctly.

## {53.10} acceptance criteria (PLAN {53.10})

- `mount_table_target` call added to `app_main()` for `entity_mentions` table (per TECH
  §P-2 + cocoindex 1.0.3 `declare_vector_index` posture from {49.2}).
- `managed_by=ManagedBy.USER` (preserves "DDL via CLI only").
- No regression on existing Stage-3/Stage-4 mount calls; integration test green.

## {53.12} acceptance criteria (PLAN {53.12})

- `KhPairResolver` class per TECH §P-4 (faiss-cpu + `entity_pair_resolutions` cache).
- Determinism: cache hit returns same resolution as cache miss for identical pair.
- Unit tests cover: cache hit, cache miss, ambiguous-match handling, op_id scoping.
- Uses `faiss-cpu==1.14.2` (from {53.6} pin) — NO version drift.

## Inherited Liam ratifications (S274 + S275)

- **Option B architecture** RATIFIED (net-new, flow-scope, post-fan-out resolution).
- **`managed_by=USER`** row-only deliberately broken (Liam ratified S274; not a defect).
- **OQ-53-CONTRACT-BREAK** PERMANENT-with-re-eval-gate (mirrors cocoindex 1.0.6
  upgrade-watch shape — NOT outright permanent).
- **OQ-53-FIXTURE-STAGING** RESOLVED S275 ({49.10} fixture-staging helpers DONE).
- **Push norm:** as-needed during implementation.

## Cross-Task coordination

- {53.11} `entity_mentions` `declare_row` deps `[5, 7, 8, 10]` — deps {53.10} from THIS
  wave. Surface as a follow-up signal in final report.
- {53.13} `_run_stage_5_resolution` core deps `[5, 9, 11, 12]` — deps {53.9}, {53.12} from
  THIS wave + {53.11} from next wave.
- {53.14} integration test — gated on {49.10} (DONE S275); deps {53.13}.

## Quality gates (per wave close)

- `bun run test` GREEN
- `python3 -m pytest scripts/tests/test_kh_entity_embedder.py scripts/tests/test_kh_pair_resolver.py -v`
  GREEN
- `python3 -m pytest scripts/tests/` GREEN (full suite, no regression)
- `bun lint` clean
- Cocoindex deploy GREEN (or skip — flow.py change tested via integration in {53.13}, not
  here)
- `parseTaskListWithWarnings` clean

## Cherry-pick aliasing (OQ-S274-1 reminder)

When cherry-picking executor commits to worker branch, if source SHA may live at HEAD in
sibling worktree, use:

```bash
git -C <target-worktree> format-patch -1 <executor-sha> --stdout | \
  git -C <target-worktree> am
```

## Final report

Before `/exit`, write to `<events_dir>/final_report.yaml`. Schema:

```yaml
summary: <2-3 sentences>
commits: [...]
dispositions:
  53.9: { status, checker_verdict, cherry_pick_sha }
  53.10: { ... }
  53.12: { ... }
OQs_for_parent: [...]
next_session_handoff: <1 paragraph; what {53.11/13/14/15} depends on>
```

## Out of scope (escalate, do NOT silently expand)

- {53.11} `declare_row` (next wave; deps {53.10} from THIS wave + {53.7/8})
- {53.13} core resolution loop (next wave)
- {53.14} integration test suite
- {53.15} `_classify_stage_exception` entity_resolution_failed class
- {53.16} canonical-pipeline-sequencing amendment
