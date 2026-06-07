# cmux brief — S270 ledger-finalise sub-orchestrator

You are a **SUB-ORCHESTRATOR**, not a leaf worker. Load the `workflow-orchestration` skill
first. For every Subtask, **DISPATCH a task-executor via the Agent tool, then GATE it with
a task-checker (FAIL→fix→PASS) BEFORE committing.** Do NOT write the code/docs directly as
your own deliverable — that is the Executor role. This holds even for the test-only and
journal-only slices.

**First action (agents start stale):**
`git fetch origin main && git reset --hard origin/main`.

**Paths:** relative only. The PreToolUse hook blocks `cd` to the KH repo root — use
relative paths / `git -C`.

---

## Mission

Finalise the ledger now that `main` is the **sole** `task-list.json` writer this session
(the sibling nav-build terminal is fork-only and does NOT touch KH `task-list.json`; the
orchestrator owns the `{20.29}` record, created AFTER your normalisation lands). Three
Subtasks, in order:

1. **OQ-LS-2** — the one-time whole-file normalisation (ID-35.11's deferred pass).
2. **ID-49.7** — cocoindex test-hardening.
3. **ID-49 sweep (OQ-LS-3)** — over-budget field relocation on the ID-49 record.

Parse `task-list.json` via `parseTaskListWithWarnings` from
`lib/validation/task-list-schema.ts`, never raw `JSON.parse`. Grounding:
`lib/ledger/README.md`, ID-35.11 `details`, `scripts/ledger-cli.ts` +
`lib/ledger/scoped-serialise.ts`, `scripts/ledger-sweep-s269.ts`, and the ID-34 PRODUCT §4
sweep policy (`docs/reference/task-list-discipline.md`).

## Order of work

### 1. OQ-LS-2 — one-time whole-file normalisation (do FIRST; it is the reformat)

ID-35.11's `details` pairs the scoped-write mode with a "one-time normalisation pass at
the CLI-becomes-sole-writer transition." That moment is NOW. `ledger-cli serialise()` is
doubly non-conforming to the on-disk file: it emits **Zod-canonical key order** + **raw
UTF-8**, but `task-list.json` currently carries **historical key order** + **all non-ASCII
escaped as `\uXXXX`** (~2586 em-dashes) — so any single scoped field edit reformats ~1600
lines.

Fix: re-emit the WHOLE `task-list.json` ONCE through the canonical `serialise()` path (Zod
key-order + raw UTF-8) so future scoped writes produce minimal diffs.

- **AC (load-bearing):** the normalisation is a **semantic identity** — `parse(old)` must
  deep-equal `parse(new)`; ONLY byte-level formatting (key order + escaping) changes. The
  Checker MUST verify deep-equality of the parsed object graphs, not eyeball the diff.
- Own commit (the diff is large by design).
- Re-run the ledger validation suites (37/37) + regenerate mirrors
  (`scripts/regen-mirrors.sh`).
- Assess `product-roadmap.json` + `product-backlog.json`: they share `serialise()` — if
  they exhibit the same non-conformance, normalise them in the SAME commit; if already
  conformant, leave them. State which in the report.
- Journal completion into ID-35.11 `details` (mark OQ-LS-2 resolved).

### 2. ID-49.7 — cocoindex test-hardening (status pending → in-progress)

Read the ID-49.7 `details` in full — it carries two S269 folded findings:

- Per-file `importlib.reload` isolation across the `test_cocoindex_flow_*.py` set +
  `conftest.py` so no shared module-level `flow` import bleeds across files.
- Folded finding (1): scoped `filterwarnings` on
  `scripts/tests/test_cocoindex_server.py:255` (`test_thread_crash_sets_worker_flag`) —
  pytest 9.x emits `PytestUnhandledThreadExceptionWarning` on the intentional
  daemon-thread crash.
- Folded finding (2): the `kh_pipeline_db` / `DB_CTX` ContextKey contamination — `DB_CTX`
  needs the same duplicate-key `ValueError` defence `FLOW_META_CTX` has in
  `flow_context.py:48-67`, or the tests must reset the registry.
- **testStrategy:** run the cocoindex flow test files in ascending AND descending
  collection order; assert all pass both ways, no shared-flow-module state bleed, no
  duplicate-ContextKey `ValueError`. All `task-list.json` touches (status flip + journal)
  via the {35.11} scoped-write mode on the normalised file.

### 3. ID-49 sweep (OQ-LS-3) — release the record excluded from the S269 34.8 sweep

ID-49 was excluded from the ID-34.8 sweep (sibling-owned by the 49.8 executor in S269).
Release it now: sweep the over-budget `description` (1571) + `status_note` (474) per the
ID-34 PRODUCT §4 policy via `scripts/ledger-sweep-s269.ts` — relocate rationale/narrative
→ `docs/` + `cross_doc_links` / `details` journal blocks, **VERBATIM** (the S269 34.8
Checker FAIL was a trimmed-not-relocated status_note — do not trim). Scoped write on the
normalised file.

## Coordination

You are the SOLE `task-list.json` writer this session. nav-build is fork-only; the
orchestrator creates `{20.29}` AFTER your normalisation integrates. Land the normalisation
cleanly — everything downstream (the orchestrator's `{20.29}` add + nav journal) rebases
onto your normalised file.

## Close-out

- Commit on your worker branch via `commit-commands` (Co-Authored-By trailer for
  `Claude Opus 4.7 (1M context)`). Separate commits: {OQ-LS-2 normalisation}, {49.7
  test-hardening}, {49 sweep}.
- Status: ID-49.7 `pending → in-progress` (the task-checker you gate with marks it `done`
  on PASS). ID-49 stays `pending` (swept only). Journal OQ-LS-2 completion into ID-35.11
  `details`.
- Before `/exit`, write `<events_dir>/final_report.yaml` — sections
  `{summary, commits, normalisation (records-touched + deep-equal proof + roadmap/backlog disposition), test_hardening_verdict, swept_record, deferred, OQs_for_parent, next_session_handoff}`.
- Surface Open Questions via the OQ-escalation channel
  (`docs/specs/id-43-oq-escalation/PRODUCT.md`).
