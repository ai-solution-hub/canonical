# cmux sub-orchestrator brief — S277 / subo-id-42 (pullmd deploy + HTML retirement wave)

## Role

You are a **SUB-ORCHESTRATOR**, not a leaf worker. Load the `workflow-orchestration` skill
first. For every Subtask: DISPATCH a `task-executor` via the Agent tool, then GATE it with
a `task-checker` (FAIL → fix-Executor → PASS) BEFORE you cherry-pick its commit onto your
worker branch. Do NOT edit code/tests directly as your own deliverable — that is the
Executor's role. You own dispatch, gating, sequential cherry-pick integration, and ledger
status flips on your branch.

## First actions (worktree hygiene — MANDATORY)

1. `git fetch origin main && git reset --hard origin/main` — you start stale; get onto the
   current tip (it carries the S277 ledger commits: ID-56 records + the ID-52/53 drift
   reconciliation).
2. `supabase link --project-ref turayklvaunphgbgscat` (staging — worktrees inherit no link
   state). Verify `cat supabase/.temp/project-ref` shows staging before ANY `db push`.

## Scope — Task ID-42 (in_progress): "Deploy pullmd Cloud Run Service + retire current HTML extraction paths"

Read the live Subtask details from `docs/reference/task-list.json` (task id `"42"`). All
spec subtasks {42.1-42.4} + adapter/manifests/migration {42.5/6/7/8} are DONE. Substrate
confirmed S277: **ID-28.20 is done and the cocoindex Stage-6 write path is functional**
(`sd_target.declare_row` at `scripts/cocoindex_pipeline/flow.py:904`; the `bind_target`
placeholder is gone). So {42.9}'s stale "BLOCKED-ON ID-28.20" caveat is SATISFIED.

Dispatch the wave in dependency order:

1. **{42.9}** (deps [5,8], both done) — Wire pullmd provenance (`extraction_method` +
   `pullmd_share_id`) onto the Stage-6 `source_documents` write in `flow.py`. Add the two
   columns to `SOURCE_DOCUMENTS_SCHEMA` + the `sd_target.declare_row` field set; fan the
   provenance from the {42.5} adapter without disturbing the `content_text` flow.
2. **{42.10}** (deps [7,9]; currently `blocked` — flip to pending once {42.9} lands) —
   End-to-end HTML ingest proof against the **deployed pullmd Cloud Run Service**
   (Inv-7/8/9), NON-mocked. Requires the live service + `PULLMD_SERVICE_URL`. If the
   service is not actually reachable/deployed, ESCALATE via the OQ channel (do not fake
   the proof).
3. **{42.11}** (deps [10]) — Retire Surface A HTML tiers + extend `ExtractionResult` union
   with `pullmd_*`.
4. **{42.12}** (deps [10]) — Retire Surface B HTML branch (URL-ingest in
   `app/api/ingest/url/route.ts`, re-point `extractFromUrl`); KEEP the PDF branch. {42.11}
   and {42.12} may run as parallel Executors after {42.10} (disjoint surfaces).
5. **{42.13}** (deps [10,11,12]) — Remove HTML-extraction npm deps (@mozilla/readability,
   jsdom, unpdf, @mendable/firecrawl-js as applicable) + workflow `FIRECRAWL_API_KEY`
   mount + pass the scoped grep gate. `bun run knip` + full test + build clean.

## Cross-fleet coordination (READ — load-bearing)

- **flow.py is a contested file this session.** {42.9} is the FIRST flow.py `ingest_file`
  edit of S277. Two other waves (ID-53 {53.11} `em_target.declare_row`; ID-52 {52.12}
  form-extractor mounts) edit the SAME `ingest_file`/`app_main`. The PARENT is staggering
  those AFTER your {42.9} lands — so just make {42.9} a clean, minimal, well-scoped edit
  and cherry-pick it promptly. Surface the {42.9} commit SHA in your final report so the
  parent can sequence the others.
- **content-extractor.ts + @mendable/firecrawl-js deletion** is shared with ID-46 (T14
  collapse-list). ID-46 is RESEARCH-only this session (not deleting code), so **ID-42 owns
  these deletions** if {42.11}/{42.13} reach them. Note it in the PR description.

## Gotchas inherited

- `gitnexus_impact` BEFORE editing any symbol in flow.py / extraction;
  `gitnexus_detect_changes` after. Warn on HIGH/CRITICAL.
- cocoindex boot/smoke tests need `dangerouslyDisableSandbox: true` (LMDB mmap).
- DDL via CLI only if any migration is touched; no MCP `execute_sql`/`apply_migration`.
- No barrel re-exports; direct file imports. `sb()`/`tryQuery()` no silent failures.
  `getAuthorisedClient()` → check `auth.success` (not `auth.authorised`).
- UK English; no emoji.

## Escalation + reporting

- Load the OQ-escalation skill alongside `workflow-orchestration`. **Do NOT use
  AskUserQuestion** (headless stall — recurred 3× S276). Surface Open Questions via the
  OQ-escalation channel; the parent polls your `stop` events and will respond.
- Commit on your worker branch only. Do NOT edit `docs/reference/task-list.json` beyond
  your own Subtask status flips + `<info added on …>` journal blocks (PRODUCT inv 13).
- Before `/exit`, write `<events_dir>/final_report.yaml` with sections {summary, commits
  (incl. the {42.9} SHA), dispositions, OQs_for_parent, next_session_handoff}.
