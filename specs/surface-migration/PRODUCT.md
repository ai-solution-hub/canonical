# Surface Migration — Roadmap, Backlog, Task List

## Change log

| Session | Change |
|---|---|
| S50 W0 | Alias removal, unified enums, WP2/3/4 reframes per Liam OQ + extension answers. |

## Summary

Migrate Knowledge Hub's task surfaces to a Taskmaster-shaped (TM-shaped) JSON
model so that the SDLC workflow has a coherent, machine-readable substrate to
orchestrate against. Creates a new **Task list** JSON file, restructures the
Roadmap's §3 (AI Evaluation Pathway) so its phases become top-level sections,
and extends the Backlog item shape to be promotion-compatible with the Task
list. Structurally enables the eventual content-level label-reversal between
Roadmap and Backlog — the *content* migration itself remains main-track scope
and is **not** delivered here.

## Goals / Non-goals

**Goals.**

- A single canonical Task list surface that the Workflow Orchestrator, Task
  Planner, Task Executor, Task Checker, and Workflow Curator can all read and
  write through a published schema.
- Roadmap and Backlog JSON shapes that are schema-coherent with the Task list
  so that promotion in either direction (backlog → task, task → roadmap, etc.)
  does not require a content-reshape.
- The pre-existing JSON ↔ MD round-trip drift on the Roadmap (three failing
  tests) resolved as part of the migration so the new surface ships against a
  clean baseline.

**Non-goals.**

- Installing the Taskmaster CLI, the Taskmaster MCP server, or any TM tooling.
  KH adopts the JSON *shape* only (per `s49-open-resolutions.md` A6). Linear is
  the future-state structured-task target; TM is a shape donor.
- Migrating the *content* of the conceptually-reversed Roadmap and Backlog
  (which items move where). That work is main-track scope and lands after
  feature-spec ratification, per the S48 framing.
- Updating consumer skills (`update-roadmap-backlog` CRUD extension,
  `triage-finding` ID-N terminology) — those are implementation tasks that sit
  on top of this surface and are decomposed separately.
- Re-authoring the SDLC workflow document, agents, or orchestration skill
  bodies. Those are the S49 Wave 3 / S50 Wave B deliverables.

## Behavior

The "consumer" for this feature is **any agent, skill, or script that reads
or writes the Task list, Roadmap JSON, or Backlog JSON.** Today that is the
`workflow-orchestration` skill (forthcoming), the `update-roadmap-backlog`
skill, the `roadmap-from-json` and `roadmap-to-json` render scripts, the
freshness-coupling tests, and any future Planner/Executor/Checker/Curator
agent that records its work in those files. Behavior is described from the
perspective of those consumers.

### A. Task list — file, location, root shape

1. A single canonical Task list file exists at a fixed repo-relative path.
   Every consumer that reads or writes a Task list resolves the path from a
   single shared constant; there is no per-consumer path configuration.

2. The Task list file is **valid JSON** at all times — partial writes are not
   observable to readers. A consumer that opens the file and finds it
   non-parseable treats that as a fatal error, not a recoverable state.

3. The Task list file **validates against the published Task-list schema**.
   Every successful write produces a document that round-trips through the
   schema validator without coercion.

4. The Task list root has these fields and only these fields:
   - `document_name` — string literal identifying the document.
   - `document_purpose` — one-paragraph human-readable purpose.
   - `last_updated` — freetext one-liner of the form
     `"kh-prod-readiness-SNN <wave> close-out"` matching the Roadmap and
     Backlog convention.
   - `related_documents` — array of repo-relative paths.
   - `tasks` — array of Task objects (see B).

   The TM `master` wrapper is **flattened away** — KH does not use TM's
   multi-tag mechanism. There is no `master` key.

### B. Task object shape

5. Every Task in `tasks[]` has these required fields:
   - `id` — string of digits (e.g. `"15"`). Stringified integer per TM
     convention; round-trips losslessly through `JSON.parse` / `JSON.stringify`.
   - `title` — short noun phrase (~30–60 chars).
   - `description` — markdown body with optional `##` sub-sections; may
     preview the Subtask plan in prose (TM convention from
     `taskmaster-schema-reference.md` §3.4).
   - `status` — Task-level enum value (see G).
   - `priority` — Task-level enum value (see H).
   - `dependencies` — array of stringified Task ids referencing other Tasks
     in the same Task list. Empty array when none.
   - `subtasks` — array of Subtask objects (see C). Empty array allowed when
     the Task is atomic.
   - `updatedAt` — ISO 8601 timestamp of the last write to the Task or any
     of its Subtasks.

6. Tasks also carry **KH-extension fields** preserved from the current
   Roadmap shape:
   - `effort_estimate` — nullable freetext (`"~15 min"`, `"1-2 sessions"`,
     `"Multiple sessions"`, `"XS"`, `"TBD"`).
   - `owner` — nullable freetext (e.g. `"Engineering"`,
     `"Engineering + product research"`).
   - `cross_doc_links` — array of structured doc references (path, anchor,
     raw-text triples) mirroring the Roadmap convention.
   - `session_refs` — array of session-id strings (e.g.
     `["S203 WP-C1", "kh-prod-readiness-S35"]`).
   - `commit_refs` — array of commit SHA strings.

7. TM's empty-by-convention fields (`details` and `testStrategy` on Tasks)
   are **omitted from the Task object** rather than carried as empty strings.
   They live on Subtasks only (see C).

8. The `parentId` field present in raw TM exports is **omitted entirely**.
   Parent linkage is positional (a Subtask's parent is the Task whose
   `subtasks[]` array contains it).

### C. Subtask object shape

9. Every Subtask in `Task.subtasks[]` has these required fields:
   - `id` — bare integer (e.g. `1`). Restarts at `1` for each parent Task —
     **local to the parent, not globally unique**.
   - `title` — short noun phrase (~40–80 chars).
   - `description` — one-sentence summary (~80–200 chars).
   - `details` — multi-line markdown brief: file paths, function names,
     "verify X" lines, spec-slice references. This is the **load-bearing
     dispatch brief** the Executor consumes; the canonical SDLC convention
     is that `details` is what gets handed to the Executor agent, not
     `description`.
   - `status` — Subtask-level enum value (see G).
   - `dependencies` — array of bare integers referencing **siblings within
     the same parent Task** (see D for the constraint).
   - `testStrategy` — nullable freetext prose acceptance statement.
     One-liner accepted (e.g. `"Run 'ls -la …' to verify all files
     exist"`). Explicit `null` allowed when the subtask *is* the test.

10. Subtasks may optionally carry:
    - `updatedAt` — ISO 8601 timestamp of last write. Omitted when the
      Subtask has not been touched since creation.

11. Subtasks **never** nest — `Subtask.subtasks` is not a valid field.
    Subtask depth is exactly 1.

12. Subtasks **do not** carry `priority`. Priority is Task-level only;
    Subtasks inherit their parent Task's priority implicitly.

13. The `details` field is **append-extensible** via the `<info added on
    YYYY-MM-DDTHH:MM:SS.sssZ> … </info added on …>` block convention. New
    blocks append to the end of `details`; existing content is preserved
    verbatim. This makes `details` simultaneously a dispatch brief and an
    in-task journal.

### D. Subtask dependency cardinality (forcing function)

14. A Subtask's `dependencies[]` may reference **only the integer ids of
    other Subtasks under the same parent Task**. Cross-Task subtask
    references are not expressible and not valid.

15. When a Planner finds it needs to express "Subtask X of Task M depends on
    Subtask Y of Task N", that is a **Task-boundary signal**: split or merge
    the Tasks until the dependency expresses as either a Task-to-Task
    dependency (recorded in `Task.dependencies[]`) or a sibling Subtask
    dependency.

16. Schema validation **enforces** invariant 14 — a Task list with a
    cross-Task subtask dependency does not round-trip through the validator.

### E. Composite id convention (prose)

17. Cross-document and in-prose references to Subtasks use the **`ID-N.M`**
    composite-id form: `ID-15.1` denotes Subtask `1` of Task `15`. The
    `ID-` prefix is KH convention (per `s48-feedback.md` B2); the `N.M`
    portion is identical to TM's prose convention. Composite ids are
    **never** stored as a field — they are derived at read time from
    positional nesting.

18. Cross-document and in-prose references to Tasks use the **`ID-N`** form
    (`ID-15`, no dot).

### F. Cardinality limits

19. A Task list may contain any number of Tasks; there is no hard cap.

20. A Task may contain up to **25 Subtasks**. The 25-Subtask soft ceiling is
    a Task-boundary signal: a Planner needing more should split into two
    Tasks linked by `Task.dependencies[]`. Schema validation warns at >25
    but does not reject.

### G. Status vocabulary

21. A single canonical `WorkStatus` enum spans all surfaces; each surface
    accepts a defined **subset** per its semantic role. See TECH.md §1.0 for
    the shared module definition and subset compositions.

    - **Task list (in-work):** `done | pending | in_progress | blocked |
      deferred | cancelled | spec_needed | imp_deferred` at Task level.
      At Subtask level the set is further reduced to `done | pending |
      in_progress | blocked | deferred` (drops `cancelled`, `spec_needed`,
      `imp_deferred` — Subtask-level only in the in-work phase).
    - **Roadmap (forward-looking thematic):** `pending | blocked |
      spec_needed | deferred | imp_deferred | needs_research`.
    - **Backlog (pre-work):** `spec_needed | needs_research | parked |
      ready | blocked`.

    The Subtask status set is a strict subset of the Task list subset;
    `cancelled`, `spec_needed`, and `imp_deferred` are Task-level-only values
    within the Task list surface.

22. The KH canonical form uses **underscores throughout** (`in_progress`,
    `spec_needed`). This is the **only** accepted written form across all three
    surfaces — there is no alias preprocessing on read. The Task list is NEW;
    no legacy data exists that requires aliasing.

    Note: the Backlog surface uses `spec_needed` and `needs_research` as valid
    Backlog-specific status values in their own right (not aliases for anything
    else — they are the canonical Backlog pre-work states). TM's `review`
    status is **not adopted** — the equivalent state in KH is captured by the
    Checker's `quality-review` variant interacting with a Subtask still in
    `in_progress`. See TECH.md §1.0 for the full master enum definition.

23. Status transitions are **consumer-side discipline**, not schema-enforced.
    The SDLC workflow doc owns the per-role transition rules (e.g. Executor
    may set `pending` → `in_progress` only; Checker may set
    `in_progress` → `done`).

24. A `status_note` freetext field is allowed at both levels for residual
    explanation that does not fit the enum (e.g.
    `"Blocked on bid-to-template linkage"`).

### H. Priority vocabulary

25. A single canonical `Priority` enum spans all surfaces; surfaces use
    subsets per their semantic role. See TECH.md §1.0 for the shared module
    definition and per-surface subset compositions. The master enum covers:
    MoSCoW values (`must`, `should`, `could`, `future`), Ranked values
    (`high`, `medium`, `low`), and the Trigger value (`trigger`). Each surface
    accepts the subset semantically meaningful for its function.

26. A `priority_note` freetext field is allowed at Task level for residual
    annotation beyond the canonical enum (e.g.
    `"Should (demoted from Must)"`, `"Medium (deferred)"`,
    `"Low (H2)"`).

### I. Roadmap restructure

27. The Roadmap remains a separate file from the Task list. Roadmap is
    forward-looking thematic capability planning; the Task list is active
    structured work. Roadmap items may reference Task list Tasks via
    `cross_doc_links`; the reverse reference (Task list → Roadmap item) is
    also allowed.

28. The Roadmap's current §3 (`AI Evaluation Pathway (active
    development)`) is **flattened**: the seven §3.x sub-sections (§3.1
    Pass 2, §3.2 Phase 2 outstanding, §3.3 Phase 3 Regression
    Infrastructure, §3.4 Phase 4 Human-in-the-Loop, §3.5 Phase 5 Full
    Coverage, §3.7 AI Telemetry — §3.6 is currently vacant) each become
    their own top-level Roadmap section. Other top-level sections (§4,
    §5, §8, §9, §11) renumber to maintain numeric contiguity.

29. Roadmap item content is preserved verbatim across the §3
    restructure — only the `section_id` and `id` (dotted-decimal) fields
    update to reflect the new section numbering. A Roadmap consumer
    querying by item content (title, description) sees no semantic
    change; only consumers keyed on section path see renumbering.

30. The Roadmap retains its **forward-looking-only doctrine** (no
    shipped items, no completed-status framings). The schema enforcement
    (`forward_looking_only: true` literal at root) is unchanged.

31. The Roadmap's `last_updated` field, `narrative` prose on sections,
    `spec_links`, `cross_doc_links`, `session_refs`, `commit_refs`, and
    per-item `phase_label` / `priority_note` / `severity` / `status_note`
    fields are **all preserved**.

### J. Roadmap render and round-trip

32. The Roadmap has a published bidirectional render pipeline (JSON ↔ MD):
    rendering JSON to MD reproduces the on-disk Markdown file; parsing the
    on-disk MD reproduces the JSON. Both directions are lossless at the
    word-token level — the existing `roadmap-roundtrip` test is the
    contract.

33. The pre-existing `roadmap-roundtrip` test failures (documented drift
    between `product-roadmap.json` and `product-roadmap.md`) are **resolved
    as part of this migration**. The migration cannot ship on top of a
    broken round-trip baseline. The specific drift content and the
    JSON-vs-MD reconciliation strategy are TECH.md decisions.

    Drift-resolution direction defaults to **strip stale from MD** (drift
    indicates content that has fallen out of the canonical JSON source).
    Back-fill JSON only for entries Liam confirms main-track requires
    (review the classification table per Task 3 Subtask 2 default-lean
    override). Liam holds local backups of current `product-roadmap.{json,md}`
    and `product-backlog.json`; aggressive strip is recoverable.

34. The render output is **deterministic** — the same input JSON produces
    byte-identical MD across runs and across machines. (This is the
    contract the round-trip test already asserts via word-token equality.)

35. The render script and parse script are invokable via the same
    `bun run roadmap:render` command surface that exists today. Consumers
    that depend on that command continue to work post-migration.

### K. Backlog extension

36. The Backlog remains a separate file from the Task list. Backlog is
    parked / deferred / speculative work; items move from Backlog to the
    Task list when a track is funded or a launch decision activates them.

37. Backlog items retain their existing flat shape (no sections, no
    sub-items) and their existing ids (e.g. `C2-PA5`,
    `C1-T3-Settings-3`) — id reuse is mandatory so external references
    do not break.

38. Backlog items gain TM-shape-compatible **optional** fields:
    - `details` — nullable markdown brief, populated when the item has
      been pre-thought beyond the one-sentence description.
    - `testStrategy` — nullable prose acceptance statement.
    - `dependencies` — already present as `depends_on`; canonicalised to
      `dependencies` to match Task list. Read-alias for the prior name is
      a TECH.md decision (whether and for how long).

39. Backlog items become **promotion-compatible** with the Task list — a
    Backlog item carrying `details` + `testStrategy` can become a Task
    (with subtasks added by a Planner) without a content reshape.

40. The Backlog retains its **forward-looking-only doctrine** (no closed
    rows). The existing
    `backlog-no-closed-rows` test continues to assert this.

### L. CRUD operations consumer surface

41. **Read** — any consumer may read any of the three files at any time.
    Read returns a value validated against the published schema, or the
    consumer treats the file as fatally corrupted (see invariant 2).

42. **Append** — any consumer may append a new Task to the Task list, a
    new Subtask to an existing Task, or a new item to the Backlog. Appended
    records are valid against the schema (the consumer validates pre-write).
    `last_updated` updates.

43. **Update** — any consumer may update an existing record's mutable
    fields in place. The id field is **immutable**. `updatedAt` (on Tasks
    and Subtasks) updates on every successful write; `last_updated` on the
    document root updates correspondingly.

44. **Delete** — the structural surface supports record deletion. Deletion
    *policy* (who may delete what, when) is consumer-side discipline; the
    schema does not enforce it. (For example: the SDLC workflow doc may say
    Subtasks should never be deleted, only marked `cancelled` — the schema
    allows both.)

45. **Concurrent writes** — the surface assumes a **single-writer
    convention** at any one moment: one consumer holds the write turn,
    other consumers read only. There is no in-file locking primitive;
    coordination lives in the workflow layer (the Orchestrator skill
    sequences writes through agents it dispatches). A consumer that
    detects an unexpected `updatedAt` change on a record it intended to
    update treats that as a write-race and surfaces it to the caller
    rather than silently overwriting.

    - **Open question:** does the surface need an explicit version
      counter at the root (e.g. `revision: <integer>`) to make optimistic
      concurrency control machine-checkable, or is `updatedAt` per-record
      sufficient? The Workflow Orchestrator skill body (S49 Wave 3 / S50
      Wave B) is the natural place to decide this.

### M. Cross-document references

46. Roadmap items, Backlog items, and Task list Tasks may reference each
    other via `cross_doc_links` (path + anchor). Anchors use the
    composite-id convention from invariants 17–18 (`#ID-15` for a Task,
    `#ID-15.1` for a Subtask).

47. Cross-references are **string-based**; nothing in the schema enforces
    that a referenced target exists. The freshness-coupling tests are the
    contract: a registered tracked-reference doc that names a stale
    cross-reference is a test failure.

48. All three files (`product-roadmap.json`, `product-backlog.json`,
    Task list JSON) are tracked by the freshness-coupling system so the
    coupling tests cover them.

### N. Label-reversal — structural enablement (content out of scope)

49. The schema is shape-symmetric between Roadmap and Backlog where it
    matters for promotion: a Backlog item carrying optional `details` +
    `testStrategy` and a Roadmap item carrying the same fields can both
    be promoted to a Task without a content reshape. The migration
    **does not** prevent the future content-level reversal between the
    two documents.

50. The migration **does not rename, move, or swap content between**
    `product-roadmap.json` and `product-backlog.json`. The conceptual
    reversal (per S48 framing: "Roadmap and Backlog are conceptually
    reversed, not just labelled wrong") is content work that lands on the
    main track after feature-spec ratification — separate from this WP.

51. File paths for all three documents are **stable through this migration
    only**. A subsequent content-reversal WP may choose to rename the
    files (`product-roadmap.json` ↔ `product-backlog.json`) or to swap
    their content in place; either path is permitted by this surface.

### O. Provenance and freshness

52. Each of the three documents records `last_updated` on the root in the
    standard KH freetext form (e.g.
    `"kh-prod-readiness-S50 W1 close-out — Task list created"`).

53. Records carry inline provenance where TM and the existing KH
    conventions overlap:
    - `session_refs[]`, `commit_refs[]`, `cross_doc_links[]` on Roadmap
      items and (newly) on Task list Tasks.
    - `<info added on …>` blocks within Subtask `details` (see
      invariant 13).

54. The freshness-coupling test
    (`__tests__/docs/reference-doc-edit-coupled-freshness.test.ts`) treats
    all three documents as tracked-reference-docs and fails if a `last_updated`
    line drifts unmodified after a content change.

### P. Migration / drift handling

55. The migration is a **one-time, in-place** restructuring of the three
    documents and their render pipeline. There is no parallel "old" and
    "new" surface during a transition window; the migration commit either
    lands cleanly or rolls back.

56. After the migration lands:
    - The Task list file exists, is schema-valid, contains zero Tasks
      initially (consumers add Tasks as work begins).
    - The Roadmap JSON reflects the §3 restructure and the
      drift-resolution, validates against its (updated) schema, and
      round-trips with the on-disk MD.
    - The Backlog JSON has the new optional fields available and adopts
      canonical status names (`spec_needed` not `needs_spec`). Existing
      items may be retrofitted in a follow-up if main-track plans preserve
      them, but the retrofit is not required for this migration (see TECH.md
      FU-NEW: Backlog 36-item canonical status retrofit).

57. Pre-migration, the Roadmap JSON↔MD round-trip is broken (3 test
    failures, ~1,400 token drift). Post-migration, the round-trip passes
    cleanly. The drift is resolved by stripping stale MD entries (default
    lean per inv 33) or, for any entries Liam confirms main-track requires,
    by back-filling JSON. The post-state is unambiguous: zero round-trip
    failures.

## Open questions

- **Revision counter for concurrent writes** (see invariant 45) — TECH.md
  decision. Default lean: no root-level counter; per-record `updatedAt` plus
  workflow-layer sequencing is sufficient for the single-writer convention.
- **Task list initial path** — `docs/reference/task-list.json` is the working
  proposal (matches the Roadmap and Backlog location convention). TECH.md
  picks the final path.
- **Render pipeline for Task list and Backlog** — Roadmap has bidirectional
  JSON ↔ MD; Backlog is JSON-only today. Does the Task list need a rendered
  MD view (for human readability when inspecting work-in-flight), or is
  JSON-only sufficient? Lean: JSON-only initially; revisit if consumers
  surface a readability gap.
- **Schema migration strategy for the §3 renumber** — does the migration
  preserve §3.x ids as historical aliases (so old session-refs resolve), or
  hard-renumber? Lean: hard-renumber and grep-rewrite any internal
  references in the same commit. TECH.md confirms.
