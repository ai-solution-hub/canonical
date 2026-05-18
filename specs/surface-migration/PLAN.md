# Implementation Plan — Surface Migration

**Companions:** `PRODUCT.md` (numbered behaviour invariants 1–57) +
`TECH.md` (module-level implementation plan, mapped to invariants). This
PLAN.md decomposes the TECH.md into ordered Tasks and Subtasks following
the Taskmaster JSON shape (per `s49-open-resolutions.md` A6).

## Change log

| Session | Change |
|---|---|
| S50 W0 | Alias removal, unified enums, WP2/3/4 reframes per Liam OQ + extension answers. |

## Overview

The surface migration creates the Knowledge Hub Task list, restructures
Roadmap §3 (AI Evaluation Pathway phases become top-level sections),
formalises the Backlog schema, and resolves the pre-existing
`roadmap-roundtrip` test drift. Five Tasks across three phases. Total
estimated effort: 7–10 hours of focused work, likely 1–2 sessions
depending on drift-resolution complexity.

## Architecture decisions

The TECH.md captures every concrete decision. The ones that directly
shape the Task structure:

- **Adopt TM JSON *shape* only.** Never install the TM CLI/MCP/tooling
  (per A6). PLAN.md uses TM-shape Task and Subtask conventions
  (stringified Task ids, integer Subtask ids, sibling-only Subtask deps,
  `details` as load-bearing dispatch brief, `testStrategy` per Subtask).
- **Single canonical `WorkStatus` master enum, per-surface subsets.**
  All surfaces share `lib/validation/work-status.ts`; each surface picks the
  semantically valid subset (Backlog = pre-work subset, Task list = in-work
  subset, Roadmap = forward-looking subset). Promotion (backlog → task →
  roadmap) needs no translation step — the subsets compose from the same
  constants. (See TECH §1.0.)
- **Drift resolution before §3 restructure.** Run the roadmap-roundtrip
  test to green BEFORE editing the JSON further. Migration cannot ship on
  top of a broken baseline.
- **One-shot in-place migration.** No transition window. The migration
  commit lands cleanly or rolls back; no parallel old/new surface.
- **Hard-renumber §3, no alias retention.** Cross-doc reference sweep
  rewrites references in the same commit.
- **Dogfood the new surface.** The final Task 1 Subtask seeds Tasks 2–5
  into the freshly-created `task-list.json`, demonstrating the workflow
  and proving the schema accepts realistic content from day one.

## Task list

### Phase 1: Foundation (parallel)

Two independent Tasks build the schema substrate. Both can dispatch to
parallel Executors with strict file-ownership boundaries.

- [ ] Task 1: Task list schema + initial file (dogfooded)
- [ ] Task 2: Backlog schema formalisation

### Checkpoint: Foundation

- [ ] Both new schema files compile and export expected types.
- [ ] New unit tests pass (`bun run test
      __tests__/validation/task-list-schema.test.ts
      __tests__/validation/backlog-schema.test.ts`).
- [ ] Existing tests unaffected (`bun run test` full suite shows only the
      2 pre-existing roadmap-roundtrip failures, no regressions).
- [ ] Task list JSON file exists, validates, and (per dogfooding) contains
      Tasks 2–5 as machine-readable records.

### Phase 2: Roadmap migration (sequenced)

Task 4 cannot start until Task 3's drift resolution lands. Both touch
the same JSON file.

- [ ] Task 3: Roadmap roundtrip drift resolution
- [ ] Task 4: Roadmap §3 restructure (depends on Task 3)

### Checkpoint: Roadmap migration

- [ ] `roadmap-roundtrip.test.ts` passes both `it()` blocks (0 failures).
- [ ] `roadmap-no-shipped-rows.test.ts` continues to pass.
- [ ] `bun run roadmap:render` produces byte-identical output to
      `docs/reference/product-roadmap.md`.
- [ ] Old §3.x ids no longer appear in always-rewrite scope (grep returns
      empty across `lib/`, `app/`, `__tests__/`, `scripts/`,
      `.claude/agents/`, `.claude/skills/`). Best-effort scope (prose
      archives) may carry stale refs.

### Phase 3: Integration

- [ ] Task 5: Freshness coupling + final regression

### Checkpoint: Complete

- [ ] All three documents (`product-roadmap.json`, `product-backlog.json`,
      `task-list.json`) registered in `tracked-reference-docs.ts`.
- [ ] `reference-doc-edit-coupled-freshness.test.ts` passes (new docs have
      `<!-- Last verified: YYYY-MM-DD -->` headers; last_updated lines
      bumped).
- [ ] Full Vitest suite shows the 2 pre-existing roadmap-roundtrip
      failures resolved; no new regressions; the 3rd pre-existing
      failure (`data-entry-points.md` freshness drift) acceptable to
      carry forward per FU-9.
- [ ] `update-roadmap-backlog` skill dry-run against a synthetic finding
      succeeds end-to-end.
- [ ] Liam has reviewed the deltas (cross-doc reference rewrites,
      Roadmap §3 visual diff, dogfooded Task list entries).

---

## Task detail

### Task 1: Task list schema + initial file (dogfooded)

**Description.** Create the Zod schema module for the new Task list
surface (`lib/validation/task-list-schema.ts`), the initial
`docs/reference/task-list.json` file, the supporting unit-test module,
and — as the final step — seed Tasks 2–5 of this plan into the file as
TM-shape records so the new surface contains realistic content from
landing.

**Acceptance criteria.**

- [ ] `lib/validation/work-status.ts` exists and exports `WorkStatus`,
      `RoadmapStatus`, `BacklogStatus`, `TaskListStatus`, `Priority`, plus
      inferred types. Per-surface subset compositions are verified to contain
      exactly the expected values.
- [ ] `task-list-schema.ts` exports `TaskSchema`, `SubtaskSchema`,
      `TaskListSchema`, `TaskListStatus`, `TaskPriority`, plus inferred
      types. Status field sources `TaskListStatus` from the shared module. The
      canonical written form is always underscore — no alias preprocessing.
- [ ] Sibling-only Subtask dependency constraint enforced via
      `.superRefine()` on `TaskSchema`. Cross-Task subtask deps are
      rejected at validation time.
- [ ] `task-list.json` exists at `docs/reference/task-list.json`,
      validates against `TaskListSchema`, and contains Tasks 2–5 from
      this PLAN.md (full Subtask trees per detail below).
- [ ] All unit tests in `__tests__/validation/task-list-schema.test.ts`
      pass (positive + negative coverage for each shape rule).

**Verification.**

- [ ] `bun run test __tests__/validation/task-list-schema.test.ts` —
      green.
- [ ] Manual: `cat docs/reference/task-list.json | jq '.tasks |
      length'` returns `4` (Tasks 2–5 present).
- [ ] Manual: importing `TaskListSchema` and parsing the file at runtime
      via a one-shot script returns the parsed object without throwing.

**Dependencies.** None (independent of Tasks 2–5).

**Files likely touched.**

- `lib/validation/work-status.ts` (new — shared module, created first)
- `lib/validation/task-list-schema.ts` (new)
- `docs/reference/task-list.json` (new)
- `__tests__/validation/work-status.test.ts` (new)
- `__tests__/validation/task-list-schema.test.ts` (new)

**Estimated scope.** M (3 new files, each focused; ~2–3h).

**Subtasks** (sibling-only deps; integer ids; restart at 1).

1. **Create `lib/validation/work-status.ts` shared module then create
   `task-list-schema.ts` shell with Subtask + Task + Root shapes** — first
   action: create `lib/validation/work-status.ts` with the unified `WorkStatus`
   + `Priority` master enums and per-surface subsets per TECH §1.0. Then
   define the three Task-list Zod schemas with all required fields per PRODUCT
   inv 4, 5, 9, **plus the KH-extension fields per inv 6** (`effort_estimate`,
   `owner`, `priority_note`, `status_note` as nullable; `cross_doc_links`,
   `session_refs`, `commit_refs` as arrays). Import `TaskListStatus` from the
   shared module for the status field. Skip refinements for now. Export
   inferred types. Deps: `[]`. testStrategy: "Import `WorkStatus` and
   `BacklogStatus` and `TaskListStatus` from the shared module in a one-shot
   tsx; verify the subset compositions contain exactly the expected values.
   Import schema in the same tsx; verify `TaskSchema.shape` lists every
   required field including the KH-extensions."

2. **Add status enum wiring from shared module** — import `TaskListStatus`
   from `lib/validation/work-status.ts` and attach to the `TaskSchema`
   status field (per PRODUCT inv 21–22 + TECH §1). No `.preprocess()` step —
   canonical underscore-form inputs only. The Subtask-level enum is the strict
   **subset** that drops `cancelled`, `spec_needed`, and `imp_deferred` —
   implement via `TaskListStatus.exclude(['cancelled', 'spec_needed',
   'imp_deferred'])` so `SubtaskSchema.status` only accepts the subset. Add
   `TaskPriority` derived from the shared `Priority` master enum in
   `work-status.ts`. Deps: `[1]`. testStrategy: "Verify `TaskSchema.safeParse
   ({..., status: 'in_progress'})` returns `success: true`. Verify
   `TaskSchema.safeParse({..., status: 'in-progress'})` returns
   `success: false` (no alias normalisation — canonical form only). Verify
   `SubtaskSchema.safeParse({..., status: 'cancelled'})` returns
   `success: false`."

3. **Add sibling-only dep `.superRefine()`** — walk
   `Task.subtasks[].dependencies[]` and assert every referenced integer
   matches some sibling's `id`. Reject otherwise with a clear error
   message naming the offending Subtask. Deps: `[1]`. testStrategy: "Construct
   a fixture Task with a cross-Task subtask dep; assert `TaskSchema.safeParse()`
   returns `success: false` with the expected message."

4. **Author `task-list-schema.test.ts`** — unit tests covering: empty
   `tasks[]` valid, valid Task with valid Subtasks, sibling-only
   enforcement (positive + negative), `TaskListStatus` membership (canonical
   underscore-form only; hyphenated form rejected), `Priority` subset
   membership, optional-field nullability. ~12 test cases. Also author
   `work-status.test.ts` covering master `WorkStatus` enum + per-surface
   subset compositions. Deps: `[2, 3]`. testStrategy: "`bun run test
   __tests__/validation/task-list-schema.test.ts
   __tests__/validation/work-status.test.ts` — green."

5. **Create initial `task-list.json` with empty `tasks[]`** — per TECH
   §2 exact content (document_name, document_purpose, last_updated,
   related_documents, tasks). Deps: `[1]`. testStrategy: "Run `bunx
   tsx --eval 'import {TaskListSchema} from \"./lib/validation/task-list-schema\";
   import doc from \"./docs/reference/task-list.json\";
   console.log(TaskListSchema.parse(doc))'` and verify no throw."

6. **Seed Tasks 2–5 into `task-list.json`** — transcribe each Task from
   this PLAN.md into TM-shape records under `tasks[]`. Populate full
   Subtask trees with `details` (markdown briefs per the PLAN.md text)
   and `testStrategy` per Subtask. **Task-level `details` and
   `testStrategy` fields are OMITTED entirely** (per PRODUCT inv 7 —
   they live on Subtasks only per TM convention). Populate sibling-only
   Subtask `dependencies`, correct `status: "pending"`, correct
   `priority`. Set Task-level `dependencies` per the PLAN.md Task-dep
   graph (`"2"` → `[]`, `"3"` → `[]`, `"4"` → `["3"]`, `"5"` →
   `["1", "2", "4"]`). Deps: `[4, 5]`. testStrategy: "`jq '.tasks |
   length' docs/reference/task-list.json` returns `4`; running the
   schema validator against the file passes; sibling-only enforcement
   does not trip; no Task carries `details` or `testStrategy` at root."

---

### Task 2: Backlog schema formalisation

**Description.** Formalise the Backlog shape with a new Zod schema
module, add the optional `details` + `testStrategy` fields per PRODUCT
inv 38, and refactor the existing forward-discipline test to source its
allowed status enum from the schema instead of a local constant.

**Acceptance criteria.**

- [ ] `backlog-schema.ts` exports `BacklogStatus`, `BacklogItemSchema`,
      `BacklogSchema` plus inferred types. `BacklogStatus` is sourced from
      the shared `work-status.ts` module (the `BacklogStatus` subset of
      `WorkStatus`): `{spec_needed, needs_research, parked, ready, blocked}`.
      New optional `details` + `testStrategy` fields are `string | null`.
- [ ] `backlog-no-closed-rows.test.ts` imports `BacklogStatus.options`
      rather than the local `ALLOWED_STATUSES` constant. All four
      existing `it()` blocks pass.
- [ ] Schema validates a representative subset of intended Backlog shapes
      including all new optional fields; existing 36 items' canonical-status
      retrofit deferred to FU-NEW (the existing file may contain `needs_spec`
      which does not validate against the canonical schema — that is expected
      and deferred, not a schema defect).
- [ ] All unit tests in `__tests__/validation/backlog-schema.test.ts`
      pass.

**Verification.**

- [ ] `bun run test __tests__/validation/backlog-schema.test.ts
      __tests__/docs/backlog-no-closed-rows.test.ts` — both green.
- [ ] Manual: construct 3–5 representative item fixtures covering each
      status value + each optional-field configuration; verify all validate
      against `BacklogSchema`. (Existing-items retrofit is a future
      workpackage per FU-NEW.)

**Dependencies.** None.

**Files likely touched.**

- `lib/validation/backlog-schema.ts` (new)
- `__tests__/validation/backlog-schema.test.ts` (new)
- `__tests__/docs/backlog-no-closed-rows.test.ts` (refactor only — swap
  local constant for schema import)

**Estimated scope.** S (2 new files + 1 edit; ~1–1.5h).

**Subtasks.**

1. **Create `backlog-schema.ts`** — Zod schema mirroring the intended
   Backlog shape. Import `BacklogStatus` from `lib/validation/work-status.ts`
   (the Backlog subset of the unified `WorkStatus` enum). Required fields per
   current items (`id`, `description`, `type`, `status`, `effort_estimate`,
   `priority`, `track`, `depends_on`, `surfaced`, `notes`). New optional
   fields: `details: string | null`, `testStrategy: string | null`. Deps:
   `[]`. testStrategy: "Construct 3–5 representative item fixtures covering
   each `BacklogStatus` value + each optional-field configuration; verify all
   validate against `BacklogItemSchema`. (Do NOT parse the existing 36-item
   `product-backlog.json` as the acceptance test — existing items may carry
   `needs_spec` which does not validate under the canonical schema; that
   retrofit is deferred to FU-NEW.)"

2. **Refactor `backlog-no-closed-rows.test.ts` to source enum from
   schema** — remove the local `ALLOWED_STATUSES` constant, replace with
   `import { BacklogStatus } from '@/lib/validation/backlog-schema';
   const ALLOWED_STATUSES = new Set(BacklogStatus.options);`. Note: the
   existing file carries `needs_spec` values; `BacklogStatus.options` will
   NOT include `needs_spec` under the canonical schema. The forward-discipline
   test's logic checks that statuses are within the allowed set — if existing
   items fail, that is expected (FU-NEW handles it). Adjust the test to parse
   fixtures rather than the live file if needed to keep it green during the
   FU-NEW deferral period. Deps: `[1]`. testStrategy: "`bun run test
   __tests__/docs/backlog-no-closed-rows.test.ts` — 4 of 4 green."

3. **Author `backlog-schema.test.ts`** — unit tests covering: valid
   item, each status enum value accepted, invalid status rejected, new
   optional fields accept null + string, root document validates. Deps:
   `[1]`. testStrategy: "`bun run test
   __tests__/validation/backlog-schema.test.ts` — green."

---

### Task 3: Roadmap roundtrip drift resolution

**Description.** Resolve the 2 failing `roadmap-roundtrip.test.ts`
blocks (1,386-token drift between rendered JSON and on-disk MD) so the
baseline is green before §3 restructure lands. Investigation-first
approach per TECH §5.

**Acceptance criteria.**

- [ ] Investigation diff identifies every drifted line between the
      rendered JSON and the on-disk MD, surfaced as a written
      summary for review.
- [ ] Each drifted entry is classified as "preserve in JSON"
      (back-fill) or "remove from MD" (was stale).
- [ ] Resolution applied; `roadmap-roundtrip.test.ts` passes both
      `it()` blocks.
- [ ] No new shipped/closed-marker rows introduced
      (`roadmap-no-shipped-rows.test.ts` still passes).

**Verification.**

- [ ] `bun run test __tests__/docs/roadmap-roundtrip.test.ts` — 2 of 2
      green.
- [ ] `bun run test __tests__/docs/roadmap-no-shipped-rows.test.ts` —
      passes.

**Dependencies.** None.

**Files likely touched.**

- `docs/reference/product-roadmap.md` (edit — strip stale entries per
  classification; default lean)
- `docs/reference/product-roadmap.json` (edit — back-fill JSON only for
  entries Liam confirms main-track requires)

**Estimated scope.** S–M (1–2 files, but classification work could
expand if drift turns out to span multiple sections; cap at 2h).

**Subtasks.**

1. **Produce drift diff** — render JSON to a tmp file via `bun run
   scripts/roadmap-from-json.ts --output=/tmp/rendered.md`, then `diff
   docs/reference/product-roadmap.md /tmp/rendered.md > /tmp/drift.diff`.
   Surface the diff content. Deps: `[]`. testStrategy: "Diff produced;
   line count reported; section headings of drifted blocks listed."

2. **Classify each drifted block** — for every contiguous drift block,
   annotate the classification table with: (a) which surface the block
   currently appears in (current Roadmap = high-priority surface that
   main-track will likely supersede; current Backlog = parked/deferred),
   (b) whether it describes already-shipped work, (c) default classification.
   **Default lean: strip stale from MD** (drift indicates content has fallen
   out of the canonical JSON source). Annotate each block as
   "appears in current Roadmap (high-priority) — candidate for back-fill"
   or "appears in current Backlog (parked) — safe to strip". Surface the
   table to Liam for ratification; back-fill JSON only for entries Liam
   confirms main-track requires. Deps: `[1]`. testStrategy: "Classification
   table reviewed; each block annotated with concept-flip framing; no
   ambiguous entries remain unclassified."

3. **Apply resolution** — execute the classification: back-fill JSON
   for preserves, edit MD for removals. Run `bun run roadmap:render` to
   regen MD from updated JSON. Deps: `[2]`. testStrategy: "`bun run
   test __tests__/docs/roadmap-roundtrip.test.ts` — 2 of 2 green."

---

### Task 4: Roadmap §3 restructure

**Description.** Flatten the Roadmap's §3 (AI Evaluation Pathway parent)
so its sub-sections §3.1–§3.7 (with §3.6 vacant) become top-level
sections. Renumber other top-level sections to maintain numeric
contiguity per the TECH.md §4 mapping table. Cascade per-item id
updates. Sweep cross-doc references and rewrite to new ids.

**Acceptance criteria.**

- [ ] `migrate-roadmap-section-3.ts` script exists, applies the
      renumbering mapping table from TECH.md §4 to
      `product-roadmap.json` in place, and is committed alongside the
      data change for reviewability.
- [ ] Post-migration JSON validates against `roadmap-schema.ts`.
- [ ] `roadmap-roundtrip.test.ts` passes (rendered MD matches on-disk).
- [ ] Cross-doc reference sweep grep returns zero matches for old §3.x
      ids in always-rewrite scope: `lib/`, `app/`, `__tests__/`, `scripts/`,
      `.claude/agents/`, `.claude/skills/`. Best-effort scope (prose archives,
      continuation prompts) may carry stale refs.

**Verification.**

- [ ] `bun run test __tests__/docs/roadmap-roundtrip.test.ts
      __tests__/docs/roadmap-no-shipped-rows.test.ts` — green.
- [ ] Manual: `grep -rn '§3\.\|"3\.[1-7]\.\|"3\.[1-7]"' --include="*.md"
      --include="*.ts" lib/ app/ __tests__/ scripts/ .claude/agents/
      .claude/skills/` returns no matches (always-rewrite scope only).
- [ ] Manual: visual diff of `product-roadmap.md` pre- vs post-migration
      shows §3 flattened to top-level sections; other sections
      renumbered.

**Dependencies.** Task 3 (drift must be resolved before further JSON
edits land).

**Files likely touched.**

- `docs/reference/product-roadmap.json` (edit — restructured)
- `docs/reference/product-roadmap.md` (regenerated)
- `scripts/migrate-roadmap-section-3.ts` (new, committed, deletable
  post-merge)
- Various cross-doc files containing §3.x references (count surfaces
  during sweep — likely 5–15 files).

**Estimated scope.** M–L (3–5 primary files + N cross-doc rewrites;
~2–3h).

**Subtasks.**

1. **Author migration script `migrate-roadmap-section-3.ts`** —
   implements the mapping table from TECH §4. Reads JSON, applies
   section renumbering, cascades item-id updates, writes JSON in place.
   Idempotent (running twice does not double-mutate). Deps: `[]`.
   testStrategy: "Dry-run produces expected JSON diff; second run
   produces no diff (idempotent)."

2. **Apply renumbering to `product-roadmap.json`** — run the script,
   commit result. Deps: `[1]`. testStrategy: "Manual jq inspection of
   top-level section ids matches the mapping table; item `id` and
   `section_id` fields are consistent."

3. **Cross-doc reference grep + rewrite** — pre-flight: run
   `grep -rn '§3\.\|"3\.[1-7]\.'` across all tracked areas and produce a
   count + per-area breakdown. Two scope tiers:

   **Always-rewrite scope** (must reach zero matches before this WP closes):
   `lib/`, `app/`, `__tests__/`, `scripts/`, `.claude/agents/`,
   `.claude/skills/`. For each match, rewrite to the new id per the mapping
   table. Group rewrites into one commit per file area for review.

   **Best-effort scope** (stale refs degrade gracefully; skip if time-boxed):
   `docs/continuation-prompts/`, `docs/plans/`, `docs/reference/state-of-the-product.md`,
   `.planning/.archive/`. Historical prose archives do not cause test failures.

   Deps: `[2]`. testStrategy: "Post-rewrite grep in always-rewrite scope
   returns zero matches; manual review of changed files confirms each rewrite
   preserves meaning. Best-effort scope may carry stale refs."

4. **Re-render and verify roundtrip** — `bun run roadmap:render` to
   regen MD; commit. Deps: `[2]`. testStrategy: "`bun run test
   __tests__/docs/roadmap-roundtrip.test.ts` — 2 of 2 green."

5. **Delete migration script** — `git rm scripts/migrate-roadmap-section-3.ts`
   in the same wave (one-shot script, role complete). Deps: `[4]`.
   testStrategy: "`git status` post-delete is clean; full test suite
   still green."

---

### Task 5: Freshness coupling + final regression

**Description.** Register the two new tracked documents
(`product-backlog.json`, `task-list.json`) in
`tracked-reference-docs.ts`, add their `<!-- Last verified -->`
headers, run a full regression check, and dry-run the
`update-roadmap-backlog` skill against a synthetic finding to confirm
the surface evolution did not break the consumer.

**Acceptance criteria.**

- [ ] `tracked-reference-docs.ts` lists all three:
      `product-roadmap.json`, `product-backlog.json`, `task-list.json`.
- [ ] Each tracked file carries a current
      `<!-- Last verified: YYYY-MM-DD -->` header (JSON files: header
      lives in `document_purpose` or a leading comment — pattern
      consistent with other tracked JSON files).
- [ ] `reference-doc-edit-coupled-freshness.test.ts` passes for the two
      newly-tracked docs (new headers bump cleanly).
- [ ] Full Vitest suite shows pre-existing 2 roadmap-roundtrip failures
      resolved; no new regressions; the separate pre-existing
      `data-entry-points.md` freshness drift may remain (out of scope,
      tracked as TECH §"Follow-ups" FU-9).
- [ ] `update-roadmap-backlog` dry-run with a synthetic finding writes
      successfully to both `product-roadmap.json` and
      `product-backlog.json` shapes.

**Verification.**

- [ ] `bun run test` — entire suite green.
- [ ] Manual: dry-run `update-roadmap-backlog` skill (or equivalent
      consumer script) with a synthetic Curator finding; verify JSON
      writes succeed and reading the file back round-trips through the
      schema.

**Dependencies.** Tasks 1, 2, 4 (all surfaces must exist before
registration + dry-run).

**Files likely touched.**

- `lib/docs/tracked-reference-docs.ts` (edit — append 2 entries)
- `docs/reference/product-backlog.json` (edit — header)
- `docs/reference/task-list.json` (edit — header + last_updated bump)
- Possibly `docs/reference/product-roadmap.json` (header confirmation)

**Estimated scope.** S (1–4 edits; ~1h).

**Subtasks.**

1. **Update `tracked-reference-docs.ts`** — append `'docs/reference/
   product-backlog.json'` and `'docs/reference/task-list.json'` to the
   `TRACKED_REFERENCE_DOCS` array. Deps: `[]`. testStrategy: "Type
   compiles; `bun run test __tests__/docs/reference-doc-edit-coupled-
   freshness.test.ts` passes."

2. **Derive then add `<!-- Last verified -->` headers to the two new
   tracked JSON files** — first action: read
   `__tests__/docs/reference-doc-edit-coupled-freshness.test.ts` and
   inspect the current `product-roadmap.json` header location to derive
   the exact header pattern the freshness test parses. Then apply the
   identical pattern to `product-backlog.json` and `task-list.json` so
   all three carry consistent header placement. Deps: `[1]`. testStrategy:
   "Freshness test passes; manual: `diff` the header conventions across
   the three files confirms identical placement and date format."

3. **Full regression + skill dry-run** — `bun run test` end-to-end,
   confirm zero failures. Construct a synthetic `triage-finding`
   output (a one-paragraph fake finding) and run
   `update-roadmap-backlog` against both targets. Verify the writes
   round-trip through the schemas. Deps: `[1, 2]`. testStrategy:
   "Full suite green; dry-run produces valid edits in a scratch
   branch (revert post-verification)."

---

## Task dependency graph

```
Task 1 (Task list)  ────────────────────┐
                                        │
Task 2 (Backlog)    ────────────────────┤
                                        │
Task 3 (Drift)  ──→  Task 4 (§3) ───────┤
                                        ↓
                                     Task 5 (Integrator)
```

- Task 1 and Task 2 are fully independent — parallel-safe via worktrees.
- Task 3 has no deps but Task 4 depends on Task 3 (both touch
  `product-roadmap.json`).
- Task 5 depends on Tasks 1, 2, and 4 (needs all surfaces to exist
  before registering them).

## Parallelisation strategy

**Wave A (3 streams in parallel via worktree isolation):**

- Worktree 1: Task 1 (schema + initial file + dogfood).
- Worktree 2: Task 2 (backlog formalisation).
- Worktree 3: Task 3 (drift resolution).

Cherry-pick or merge sequentially after Checker verification per WP.

**Wave B (sequential after Wave A green):**

- Task 4 (§3 restructure) — same worktree or fresh; runs against the
  drift-resolved main.
- Task 5 (integrator) — main session; merges + runs full regression.

**Worktree isolation reminder (CLAUDE.md Parallel agent isolation).**

Each worktree agent's first action is `git reset --hard main` (per the
worktree-staleness gotcha). Sequential merge on main; check
`git status` for leaked files between merges; `git clean -fd` if any.

## Risks and mitigations

(Tech-level risks fully covered in `TECH.md` §"Risks and mitigations".
Plan-level risks below.)

| Risk | Impact | Mitigation |
|---|---|---|
| Drift classification (Task 3 Subtask 2) reveals deeper structural problems than just §12 missing from JSON | Medium | Cap Task 3 at 2h; if classification surfaces scope expansion, escalate to Liam for re-prioritisation before any edits land. Default lean is strip-stale; Liam reviews the table before edits land (per Task 3 Subtask 2). |
| Strip-stale drift resolution (Task 3) removes MD entries main-track will need → content lost | Medium | Default lean is strip-stale; back-fill only on Liam ratification. Backups exist locally — strip is recoverable. Classification table surfaces per-block concept-flip framing. |
| Parallel workpackages produce git conflicts on `tracked-reference-docs.ts` (Task 5 edits) | Low | Task 5 runs AFTER Tasks 1+2+4 land — no parallel write contention. |
| Cross-doc reference sweep (Task 4 Subtask 3) finds 50+ references in always-rewrite scope and breaks the 2h cap | Medium | Pre-flight grep count before dispatch. Always-rewrite scope (lib/, app/, __tests__/, scripts/, .claude/agents/, .claude/skills/) must reach zero — split into 3a/3b if needed. Best-effort scope (prose archives) carries stale refs — do not block the WP on them. |
| Dogfooded Task list seeding (Task 1 Subtask 6) hits a schema constraint that the schema needs to relax | Low | Treat as a Checker finding; either fix schema (if constraint was wrong) or rework Task 1 details (if seed payload was wrong). Do not let dogfooding produce a relaxed-for-convenience schema. |

## Open questions

- **Q1.** When Task 3 Subtask 2 surfaces the drift classification, does
  Liam want to review the table before edits land, or trust the
  default-lean? **Resolved:** review for the first WP (concept-flip framing
  means the table needs human judgment on which stripped entries main-track
  requires back-filling). Default lean is strip-stale.
- **Q2.** Should Task 1 Subtask 6 (dogfood-seed) be a separate
  Subtask, or fold into Subtask 5 (initial file)? Lean: keep separate so
  the dogfood can be reverted if Checker finds an issue without
  blocking the schema landing.

## Verification (per skill)

- [x] Every task has acceptance criteria.
- [x] Every task has a verification step.
- [x] Task dependencies are identified and ordered correctly.
- [x] No task touches more than ~5 files (Task 4 has 3 primary + N
      cross-doc rewrites, but each Subtask is bounded).
- [x] Checkpoints exist between major phases.
- [ ] Liam has reviewed and approved the plan — gates S50.

---

## Appendix A: Future TM-shape view

Once Task 1 lands, the `tasks[]` array in `docs/reference/task-list.json`
will contain Tasks 2–5 from this plan as TM-shape records. Task 1 itself
is implicit — it's the bootstrap that creates the file, so it does not
appear in its own output (history lives in git log).

Sketch (illustrative; Task 1 Subtask 6 produces the authoritative form):

```json
{
  "tasks": [
    {
      "id": "2",
      "title": "Backlog schema formalisation",
      "description": "Formalise the Backlog shape with a new Zod schema module...",
      "status": "pending",
      "priority": "high",
      "dependencies": [],
      "updatedAt": "2026-05-18T00:00:00.000Z",
      "effort_estimate": "1-1.5h",
      "owner": "Engineering",
      "cross_doc_links": [
        {"path": "specs/surface-migration/PLAN.md", "anchor": "#task-2-backlog-schema-formalisation", "raw": "PLAN.md Task 2"}
      ],
      "session_refs": ["kh-prod-readiness-S50"],
      "commit_refs": [],
      "subtasks": [
        {
          "id": 1,
          "title": "Create backlog-schema.ts",
          "description": "Zod schema mirroring current product-backlog.json shape with optional details + testStrategy.",
          "details": "Required fields per current items (id, description, type, status, effort_estimate, priority, track, depends_on, surfaced, notes). New optional fields: details: string | null, testStrategy: string | null. Schema location: lib/validation/backlog-schema.ts.",
          "status": "pending",
          "dependencies": [],
          "testStrategy": "Construct 3-5 representative item fixtures covering each BacklogStatus value + each optional-field configuration; verify all validate against BacklogItemSchema. (Existing-items retrofit deferred to FU-NEW.)"
        }
      ]
    }
  ]
}
```

Tasks 3, 4, 5 follow the same shape with their respective Subtask trees,
`dependencies` array referencing prior Task ids (`"3"` → `[]`,
`"4"` → `["3"]`, `"5"` → `["1", "2", "4"]`), and `details` field
populated from the PLAN.md Subtask text above.

## Appendix B: Empirical observations on the planning skill

(Per Liam's S49 close-out note — this WP is the first formal use of
`planning-and-task-breakdown` against a KH spec, providing empirical
feedback on the skill itself.)

- **The skill's "vertical slicing" guidance produced a fit-for-purpose
  output here** because the surface migration *is* fundamentally
  schema-substrate work — each "slice" is a complete schema + file +
  test triad. For features where vertical slicing means cutting across
  database + API + UI, the skill's example would apply more directly.
- **The skill's task-size guidelines (S = 1–2 files, M = 3–5) sized
  most subtasks correctly** at XS/S, with Task 4 (Roadmap restructure)
  the only one approaching M–L due to the cross-doc sweep tail.
- **The skill's template did not natively output TM-shape JSON.**
  The PLAN.md format above is the canonical record; the TM-shape mapping
  required a separate Appendix A. This is consistent with A6
  (we adopt shape only; the skill remains tool-agnostic). For future
  WPs that target TM-shape directly, consider an enrichment to the skill
  or a wrapping convention (e.g. `planning-and-task-breakdown` outputs
  PLAN.md; a follow-on action transcribes to task-list.json).
- **Sibling-only dependency constraint (A6 forcing function) drove
  Task boundary discovery.** Initial decompose attempt had Task 4's
  §3-restructure Subtasks depending on Task 1's schema Subtasks (since
  Task 1 dogfoods Task 4 into the JSON). Resolution: separate Task 1's
  dogfood Subtask as its own final Subtask, drawing on Task 4's plan
  text but not its commits — Task 4 lands separately. This kept all
  cross-Task linkage at the Task level, not Subtask level.
