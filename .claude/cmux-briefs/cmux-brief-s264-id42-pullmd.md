# cmux Terminal Brief — ID-42 pullmd deploy + HTML retirement (S264)

**Your role:** Orchestrator for Task **ID-42** (deploy pullmd Cloud Run Service + retire
current HTML extraction paths). Run `workflow-orchestration`. **Planner-led** spec work
(TECH + PLAN). Independent of ID-28 at spec phase — see dependency note.

**Bootstrap (read once):**

- `CLAUDE.md`
- `docs/reference/task-list.json` → Task **ID-42** (42.3 + 42.4 `details` are
  load-bearing)
- `docs/specs/id-42-pullmd-deploy/{RESEARCH,PRODUCT}.md` (42.1 + 42.2 done — read in full;
  42.3 TECH must map one-to-one against PRODUCT invariants)

**Status:** 42.1 RESEARCH + 42.2 PRODUCT **done**. Pending: **42.3 TECH** (deps `[2]`,
**READY**) → **42.4 PLAN** (deps `[3]`).

**Sequence (DISPATCH A FRESH PLANNER per spec):**

1. **42.3 TECH** — author `docs/specs/id-42-pullmd-deploy/TECH.md`. Proposed-changes
   one-to-one vs PRODUCT invariants:
   - Rewrite `adapters.py::_pullmd_to_markdown` → GET
     `{PULLMD_SERVICE_URL}/api?url=<encoded>`, read `response.text` (or `?format=json`),
     capture `X-Source`/`X-Quality`/`X-Share-Id`, `Authorization: Bearer` if auth-on.
   - Pin `httpx` in `requirements.txt` (transitive-only today).
   - pullmd Service deploy: cloudrun manifests + image-pin (NOT `:latest`) +
     `cloud-run-deploy.yml` path-trigger + Secret Manager `PULLMD_SERVICE_URL` replace +
     `GET /` smoke-check (NOT `/health`).
   - Migration (`supabase migration new` + `db push`): `source_documents.pullmd_share_id`
     text NULL + partial index, + `extraction_method` (typed-column-vs-JSONB per PRODUCT
     ratification), mirroring T8 §P-4 `op_id ADD COLUMN IF NOT EXISTS`. New PL/pgSQL fns
     need `SET search_path = public, extensions` + REVOKE-anon. Update docs/ontology
     extraction-method CV.
2. **42.4 PLAN** — decompose into implementation Subtasks.

**ID-28 dependency — parent O-of-O verdict (S264): NO hard dep. Proceed.** ID-42
(adapters.py HTML **input** + deploy + migration) and ID-28.20 (flow.py Stage-6 corpus
**output** write) touch different code regions + different spec dirs. Spec-phase work is
conflict-free now. **SOFT GATE — encode in the 42.4 PLAN:** the "retire current HTML
extraction paths" impl Subtask (the legacy 4-tier cascade in `content-extractor.ts` +
`pipeline.ts:372` + feed-poller) MUST NOT land until ID-28.20 makes the cocoindex pipeline
actually write corpus rows — else retiring legacy ingestion breaks production ingest.
Sequence the _retirement_ behind ID-28.20; deploy + adapter-rewrite + migration proceed
independently.

**Session-specific deltas (not in the ledger):**

- **`PULLMD_SERVICE_URL` is a placeholder** in GCP Secret Manager (staging + prod):
  `https://pullmd-not-yet-deployed-*.example.com`. `adapters.py:148` raises `RuntimeError`
  on the HTML path. ID-42 owns the real-Service deploy + replacement. Non-HTML paths are
  unaffected.
- pullmd was NEVER deployed — interpreted as "already deployed somewhere" in T8; no Task
  ever tracked the deployment until ID-42.

**Workflow discipline (S264 lessons —
`docs/specs/workflow-evaluation/feedback-dossier-S264.md` §2; ID-48 formalises):**
validate contracts/APIs against the INSTALLED code before spec'ing or implementing — if
the spec contradicts reality, ESCALATE, don't execute it blindly (ID-32 B4 + ID-28
`bind_target` were specs against assumptions); run the real-corpus/integration probe
CONTINUOUSLY, not as a final gate; keep ACs non-vacuous (lint-delta paired with
tsc/no-undef); `bun run format` before every commit.

**Merge cadence — WORKER-BRANCH-ONLY (S262 pivot):** commit to YOUR worker branch only;
cherry-pick Executor work onto it; **do NOT push to `main`** — parent O-of-O integrates at
teardown. GCP secret + Cloud Run deploy steps may need Liam (WIF / project access) — raise
via `OQ-pending.md`.
