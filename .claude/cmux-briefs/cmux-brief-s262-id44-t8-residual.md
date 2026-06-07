# cmux Terminal Brief — ID-44 T8 close-out residual (S262)

**Your role:** Orchestrator for Task **ID-44** (single-track `main`). Run
`workflow-orchestration`. Independent of ID-42.

**Bootstrap (read once):**

- `CLAUDE.md`
- `docs/reference/task-list.json` → Task **ID-44** (44.1–44.5 `details` are load-bearing)
- `docs/specs/id-28-cocoindex-flow-scaffolding/{PRODUCT,TECH}.md`

**Status:** all pending. **44.1–44.5 all have deps `[]` → fully PARALLELIZABLE** (fan out
worktree Executors).

**Subtasks:**

- **44.1** Wire `_emit_upsert_log()` live invocation in the cocoindex flow.
- **44.2** Amend `cocoindex-flow-scaffolding` TECH §P-8 — remove the fictional
  `@coco.fn(memo=True, retries=N, backoff_base_ms=N)` retry kwargs (they do NOT exist in
  cocoindex 1.0.3; retry is the KH-owned tenacity wrapper).
- **44.3** Deduplicate the `ANTHROPIC_MODEL` constant (`flow.py` + `extraction.py`).
- **44.4** TestHealthEndpoint — replace the real-socket TestClient.
- **44.5** Fix cocoindex pytest cross-file stub pollution.

**Session-specific deltas (not in the ledger):**

- **44.4 DISPOSITION RESOLVED (S262 investigation):** implement as written — replace
  `TestClient`/`TestServer` with `aiohttp.test_utils.make_mocked_request()` (in-process,
  no real socket bind). **Do NOT add a gated live-socket test** — the real `GET /health`
  is already covered by
  `__tests__/integration/cocoindex/agpl-boundary.integration.test.ts` against the deployed
  Cloud Run sidecar. Removing `TestClient`/`TestServer` also lets you drop the
  `aiohttp.test_utils` `sys.modules` stub-cleanup block, which helps **44.5** (cross-file
  contamination). No coverage gap is introduced.
- **44.5 context:** cocoindex 1.0.3's process-global `ContextKey` + `coco.fn` stub leakage
  causes 4 tests to cross-contaminate when run together.

**Merge cadence:** worktree Executors → Checker-gate → cherry-pick onto `main`,
fetch-before-push (shared `main`).
