# cmux Sub-Orchestrator Brief — S275 / ID-49.10 fixture-staging + S266 library + RFP corpus

**Worker name:** `subo-id-49-10` **Parent tip SHA:** `67e93b11` **Worker branch:**
`cmux-worker-subo-id-49-10-<auto>` **Role:** SUB-ORCHESTRATOR (not leaf worker)

## READ FIRST (in order)

1. `docs/reference/task-list.json` — ID-49 record (parent `done`); ID-49.10 Subtask
   details + journal blocks.
2. `docs/research/s274-subo-id-49-finals/final_report.yaml` (if present) — S274 ID-49
   close-gate fyi findings absorbed into 49.10 scope.
3. `__tests__/integration/cocoindex/` — current integration suite (the SKIP-CLEAN gate
   that 49.10 lifts; per testStrategy live assertions of 49.6 invariants).
4. `scripts/cocoindex_pipeline/flow.py` + `scripts/cocoindex_pipeline/extraction.py` —
   pipeline targets (`content_items`, `entity_mentions`, `q_a_extractions`,
   `source_documents`) the fixture-staging service must poll.
5. `docs/runbooks/local-development.md` — staging Supabase branch
   (`turayklvaunphgbgscat`).
6. `docs/testing/test-data/templates/` — Liam-provided corpus: `sq/`,
   `itt-services-charnwood/`, `itt-services-efa/`, `csp-checklist/`,
   `rfp-british-council/` (NEW — 4 files: 2 RFPs `.doc` + supplier-response `.docx` +
   pricing `.xlsx`). example-client q_a_form corpus lives alongside `csp-checklist/`.
7. `.claude/skills/implement-subtask/SKILL.md`.

## Scope — ID-49.10 single Subtask (S275 priority — blocks ID-53.14)

Per Liam S274 ratification: **49.10 MUST land first in S275**; 53.14 runs against live
fixtures (no skip-clean).

ID-49 parent is already `done`. 49.10 is orphan-pending — single impl Subtask, no spec
chain needed.

### Phase 1 — Executor dispatch (single)

Dispatch ONE `task-executor` (Agent tool, `isolation: "worktree"`) with brief covering
BOTH workstreams atomically:

**Workstream A — fixture-staging service provisioning**

- Implement `COCOINDEX_FIXTURE_STAGING_URL` env wiring (read in `lib/cocoindex/` or test
  helper module).
- Implement `pollContentItemsFor(workspaceId | docId, timeout)` helper — polls the
  canonical pipeline write-targets until expected rows land.
- Implement `dropFixture(...)` — tear-down helper that purges all canonical-pipeline rows
  scoped to the test fixture (across `content_items`, `entity_mentions`,
  `q_a_extractions`, `source_documents`).
- Wire helpers into `__tests__/integration/cocoindex/` so the existing 4 49.6 invariants
  assert LIVE (delete the SKIP-CLEAN gate).

**Workstream B — S266 fixture library wiring + RFP form commit**

- Verify the existing template dirs are correctly registered in any fixture-loading
  manifest
  (`docs/testing/test-data/templates/{sq, itt-services-charnwood, itt-services-efa, csp-checklist, rfp-british-council}`).
- Commit the new `rfp-british-council/` dir contents (Liam-provided — 4 files already
  staged on disk: `rfp_-_learning_partners_osch.doc`, `rfp_onlinetdcops.doc`,
  `annex_2_supplier_response.docx`, `annex_3_pricing_approach.xlsx`). Form-type enum
  already includes `rfp`.
- example-client q_a_form (under `csp-checklist/` neighbour dir) — confirm registered if applicable;
  example-client is current client priority per Liam.

Both workstreams MUST land in a single coherent Subtask (per S271 §13.7
single-Executor-per-file discipline — file ownership disjoint between workstreams).

### Phase 2 — Checker gate

Dispatch `task-checker` (variant=standard) against the Executor commit set.
FAIL→fix-Executor→re-Check loop.

### Phase 3 — Ledger journal

Append `<info added on …>` block to `49.10.details`. Flip 49.10 → `done` via ledger CLI
(`update-subtask --scoped`). DO NOT flip ID-49 parent (already `done`).

## Open Questions to surface to parent

- **OQ-49.10-A**: Does `pollContentItemsFor` polling shape need to match a specific
  deterministic latency budget, or is the existing 49.6 invariant timeout sufficient?
  Surface if ambiguity surfaces mid-Executor.
- **OQ-49.10-B**: RFP corpus — should the British Council `.doc` files be converted to
  `.docx` for downstream pipeline parity, or kept as-is? (Liam priority: form-type `rfp`
  enum already supports both; check pipeline reader compat.)

## Operating constraints — REQUIRED

- **You are SUB-ORCHESTRATOR.** Executor + Checker dispatches only.
- **You own ALL ledger writes** (49.10 status flip + journal).
- **No `AskUserQuestion` — NESTED-AGENT BAN.** Child Agents Stop with finding-packet if
  blocked. Bubble OQs via OQ-escalation channel
  (`docs/specs/id-43-oq-escalation/PRODUCT.md`).
- **Worktree isolation:** Executor branches from your worker tip; cherry-pick to your
  worker branch.
- **Final report.** Before `/exit`, write `<events_dir>/final_report.yaml` with:
  `summary`, `executor_commits`, `checker_verdict`, `49.10_status`,
  `fixture_helpers_added` (file paths), `corpus_committed` (file paths), `OQs_for_parent`.

## Success criteria

- 49.10 `done` on ledger with journal block.
- `__tests__/integration/cocoindex/` runs LIVE against staging fixture-staging service (no
  SKIP-CLEAN remaining).
- RFP corpus + S266 library files committed.
- ID-53.14 unblocked.
