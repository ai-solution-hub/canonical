# Surface Migration — Implementation Plan

**Sibling:** `PRODUCT.md` — read first for user-facing behaviour invariants
(numbered 1–57). This document maps those invariants to concrete code work.

## Change log

| Session | Change |
|---|---|
| S50 W0 | Alias removal, unified enums, WP2/3/4 reframes per Liam OQ + extension answers. |

## Context

The Knowledge Hub today has two structured-task surfaces:

- **Roadmap** — `docs/reference/product-roadmap.json` (authoritative) +
  `docs/reference/product-roadmap.md` (rendered). 17 sections, 61 items.
  Schema at `lib/validation/roadmap-schema.ts` (260 lines, Zod, strict). 18
  fields per item. Forward-looking-only doctrine enforced via the literal
  `forward_looking_only: true` at the root plus the
  `__tests__/docs/roadmap-no-shipped-rows.test.ts` guard (operates on the
  rendered MD's Status column). Bidirectional render pipeline:
  `scripts/roadmap-from-json.ts` (355 lines, JSON → MD) +
  `scripts/roadmap-to-json.ts` (739 lines, MD → JSON). Round-trip CI guard:
  `__tests__/docs/roadmap-roundtrip.test.ts` (currently **2 failing `it()`
  blocks** — both fail with token-count drift between JSON (`2967` tokens)
  and on-disk MD (`4353` tokens), a `1,386`-token gap per
  `bun run test __tests__/docs/roadmap-roundtrip.test.ts`). The repo-wide
  test baseline at S49 close is `3 fail / 12451 pass / 24 skip` because
  `__tests__/docs/reference-doc-edit-coupled-freshness.test.ts` also fails
  on `docs/reference/data-entry-points.md` (a separate
  `<!-- Last verified -->` header drift, not in scope for this WP — see
  Follow-ups §FU-9).

- **Backlog** — `docs/reference/product-backlog.json` (authoritative, no
  rendered MD). Flat `items[]`, 36 items currently. No formal Zod schema
  file; shape enforced ad-hoc by
  `__tests__/docs/backlog-no-closed-rows.test.ts` (lines 30-36 hard-code
  `ALLOWED_STATUSES = {needs_spec, needs_research, parked, ready, blocked}`).
  Observed statuses in use today: those five exactly.

There is **no** Task list surface today. The SDLC workflow document
(`docs/plans/phase-0-investigation/kh-sdlc-workflow.md` §3) references
ID-N Tasks and ID-N.M Subtasks as the universal work unit, but the file
they live in does not exist.

Two consumer skills already reference these surfaces:

- `.claude/skills/update-roadmap-backlog/SKILL.md` — Curator's write half.
  Writes to JSON via `Edit` + regenerates MD via render pipeline. Aware of
  the label-reversal (target semantics vs legacy filename) and explicitly
  notes "when the migration WP runs and swaps the file names, this skill
  must be updated".
- `.claude/skills/triage-finding/SKILL.md` — Curator's decision half.
  Returns subtask / roadmap / backlog / no-action verdict.

Freshness coupling: `lib/docs/tracked-reference-docs.ts` (32 lines) is the
single source of truth for tracked docs. Currently registers
`docs/reference/product-roadmap.json` but **not** the backlog or any task
list. The freshness guard
(`__tests__/docs/reference-doc-edit-coupled-freshness.test.ts`) enforces a
`<!-- Last verified: YYYY-MM-DD -->` header bump when tracked docs change.

The empirical TM shape this migration aligns to is fully documented in
`docs/reference/taskmaster-schema-reference.md` (S48 W2 output). The
ratified scope decisions live in
`docs/plans/phase-0-investigation/s49-open-resolutions.md` (A6 = adopt TM
shape, never install TM; A1 = `implement-subtask` is a new skill, not an
adapt of `implement-specs`) and
`docs/plans/phase-0-investigation/s49-handoff-analysis.md` (§2.3 surface
scope = items 1–4; content migration explicitly main-track).

## Proposed changes

The work breaks into seven module-level changes plus three data-level
edits. Each item below maps to one or more `PRODUCT.md` invariants
(format: `inv N`).

### 1. New module — Task list schema

**File:** `lib/validation/task-list-schema.ts` (new).

Mirrors the structure of the existing `roadmap-schema.ts` (Zod, strict,
typed exports). Three exported schemas:

- `SubtaskSchema` — TM-shape Subtask object (inv 9–13). Required:
  `id` (number, integer, ≥ 1), `title` (string min 1), `description`
  (string min 1), `details` (string), `dependencies` (number array),
  `testStrategy` (string nullable), `status` (enum, see below).
  Optional: `updatedAt` (ISO 8601 string).
- `TaskSchema` — TM-shape Task object (inv 5–8). Required: `id` (string
  of digits), `title`, `description`, `status` (enum), `priority` (enum),
  `dependencies` (string array), `subtasks` (SubtaskSchema array, may be
  empty), `updatedAt` (ISO 8601 string). KH-extension nullable fields:
  `effort_estimate`, `owner`, `priority_note`, `status_note`. KH-extension
  array fields (always present, possibly empty): `cross_doc_links`
  (DocLinkSchema array — reuse from roadmap-schema), `session_refs`,
  `commit_refs`.
- `TaskListSchema` — root document (inv 4). Required: `document_name`
  literal `"Knowledge Hub Task List"`, `document_purpose`, `last_updated`,
  `related_documents` (string array), `tasks` (TaskSchema array, may be
  empty).

**Status enum** — exported as `TaskListStatus` (the Task-list subset of the
shared `WorkStatus` master enum defined in `lib/validation/work-status.ts`,
see §1.0 below). Values at Task level: `done | pending | in_progress |
blocked | deferred | cancelled | spec_needed | imp_deferred`. At Subtask
level the set is the same `.exclude(['cancelled', 'spec_needed',
'imp_deferred'])` subset. Implementation: import `TaskListStatus` from the
shared module; apply `.exclude(...)` for the Subtask variant.

**No alias preprocessing.** Single canonical underscore-form enum; the Task
list is NEW so no legacy data requires aliasing. Inputs must already carry the
canonical underscore form — no `.preprocess()` step is added. (inv 22)

**Priority enum** — exported as `TaskPriority`. Derive from the shared
`Priority` master enum in `lib/validation/work-status.ts` (see §1.0 below).
The existing `RoadmapPriority` export from `roadmap-schema.ts` becomes a
re-export of the Roadmap subset of the unified `Priority` enum.

**Sibling-only dependency enforcement** (inv 14–16) — implemented as a
`.superRefine(...)` on `TaskSchema` that walks each subtask's
`dependencies[]` and asserts every referenced integer matches some
sibling's `id`. Schema-level rejection — not a runtime check.

**No barrel re-export.** Consumers import directly from
`@/lib/validation/task-list-schema` per CLAUDE.md convention.

### §1.0 Shared work-status module

**File:** `lib/validation/work-status.ts` (new).

All three surfaces share a single canonical `WorkStatus` Zod enum (per
PRODUCT inv 21–22). Per-surface subsets are derived by `.exclude(...)` —
no per-surface inline `z.enum(...)` literals, no translation step on
promotion (backlog → task, task → roadmap). The master enum and its subsets:

```ts
// lib/validation/work-status.ts
export const WorkStatus = z.enum([
  'done', 'pending', 'in_progress', 'blocked', 'deferred',
  'cancelled', 'spec_needed', 'imp_deferred',
  'needs_research', 'parked', 'ready',
]);
export type WorkStatus = z.infer<typeof WorkStatus>;

// Per-surface subsets — each surface accepts the semantically valid slice:
export const RoadmapStatus = WorkStatus.exclude([
  'done', 'in_progress', 'cancelled', 'parked', 'ready',
]);
// Forward-looking thematic: pending | blocked | spec_needed | deferred |
// imp_deferred | needs_research

export const BacklogStatus = WorkStatus.exclude([
  'done', 'in_progress', 'cancelled', 'deferred', 'imp_deferred',
]);
// Pre-work: pending | blocked | spec_needed | needs_research | parked | ready

export const TaskListStatus = WorkStatus.exclude([
  'spec_needed', 'imp_deferred', 'needs_research', 'parked', 'ready',
]);
// In-work (Task level): done | pending | in_progress | blocked | deferred | cancelled
// Subtask level further excludes 'cancelled' — see §1 above.
```

The same pattern applies to **Priority** (per PRODUCT inv 25):

```ts
export const Priority = z.enum([
  'must', 'should', 'could', 'future',  // MoSCoW
  'high', 'medium', 'low',              // Ranked
  'trigger',                             // Trigger
]);
export type Priority = z.infer<typeof Priority>;

// Subsets per surface based on what each surface meaningfully uses.
// (Detailed per-surface subset compositions TBD by the implementing Executor
// based on inspection of which values appear in each live file.)
```

`TaskListStatus`, `BacklogStatus`, and `RoadmapStatus` are each re-exported
from their respective schema modules (`task-list-schema.ts`, `backlog-schema.ts`,
`roadmap-schema.ts`). The shared module is NOT barrel-re-exported — always
import from the surface-specific schema module or directly from
`@/lib/validation/work-status` by name.

**Dependency note for §3:** The `BacklogStatus` subset uses canonical
`spec_needed` (not the legacy `needs_spec` string used by some existing
backlog items). The 36 existing backlog items may carry `needs_spec` — that
retrofit is **deferred** (see FU-NEW below). The schema is correct first;
data alignment follows when main-track demands. Executors must NOT alter the
shared module subset definitions to accommodate legacy data.

### 2. New file — initial Task list

**File:** `docs/reference/task-list.json` (new).

Contents (inv 56):

```json
{
  "document_name": "Knowledge Hub Task List",
  "document_purpose": "Active structured work — Tasks and Subtasks following the Taskmaster JSON shape. Forward-looking only; closed Tasks are removed and their history lives in git log + continuation prompts. Per s49-open-resolutions.md A6.",
  "last_updated": "kh-prod-readiness-S?? — surface migration creation",
  "related_documents": [
    "docs/reference/product-roadmap.json",
    "docs/reference/product-backlog.json",
    "docs/plans/phase-0-investigation/kh-sdlc-workflow.md",
    "docs/reference/taskmaster-schema-reference.md"
  ],
  "tasks": []
}
```

Empty `tasks[]` is valid per the schema and per inv 56.

### 3. New module — Backlog schema (formalise)

**File:** `lib/validation/backlog-schema.ts` (new).

Today the backlog has no Zod schema; the test enforces a hard-coded
`ALLOWED_STATUSES` set. This WP formalises the shape so the schema is
the source of truth, the test re-imports the enum from the schema, and
the new optional `details` + `testStrategy` fields (inv 38) are
machine-validatable.

- `BacklogStatus` — the Backlog subset of the unified `WorkStatus` enum,
  imported from `lib/validation/work-status.ts` (see §1.0). Canonical values:
  `spec_needed | needs_research | parked | ready | blocked`. Note: the current
  36 backlog items may carry `needs_spec` (legacy string, pre-unification). The
  schema uses the canonical `spec_needed` form; a 1-row-per-item retrofit of the
  existing data is deferred to FU-NEW (see Follow-ups). The schema is correct
  first; do NOT define `BacklogStatus` as `z.enum(['needs_spec', ...])` to
  match legacy data — the schema drives the data, not vice versa.
- `BacklogItemSchema` — captures the current shape (`id`, `description`,
  `type`, `status`, `effort_estimate`, `priority`, `track`, `depends_on`,
  `surfaced`, `notes`) plus the new optional fields:
  - `details` — string nullable. Populated when the item has been
    pre-thought beyond the one-sentence `description`.
  - `testStrategy` — string nullable. Optional pre-thought acceptance.
  - Note: the schema retains `depends_on` (not renamed to `dependencies`)
    to avoid breaking existing items and the consumer skill. PRODUCT inv 38's
    `dependencies` canonicalisation is **deferred to a follow-up WP** — see
    Follow-ups §FU-2.
- `BacklogSchema` — root document.

`__tests__/docs/backlog-no-closed-rows.test.ts` updates to import
`BacklogStatus.options` instead of the local `ALLOWED_STATUSES` constant
(removes the duplication; the test still enforces forward-discipline but
sources its allowed set from the schema).

### 4. Edit — Roadmap §3 restructure

**File:** `docs/reference/product-roadmap.json` (in-place edit).

Per inv 28–31 and `s48-feedback.md` general comments. The current §3 is
the parent of seven sub-sections (§3.1–§3.7, with §3.6 vacant). Flatten:
each §3.x sub-section becomes a new top-level section with a fresh `id`
and `number`. The §3 parent disappears (its `narrative` and `spec_links`
either move to a new umbrella section or are absorbed into the first
phase — TBD via inspection of current §3 content).

**Renumbering rule.** Other top-level sections keep their semantic
identity but renumber to maintain numeric contiguity:

| Current `id` | New `id` | Reason |
|---|---|---|
| `"1"` | `"1"` | Unchanged (pre-§3) |
| `"3"` (umbrella) | (removed) | Flattened into children |
| `"3.1"` | `"3"` | §3 Pass 2 improvements |
| `"3.2"` | `"4"` | §4 Phase 2 outstanding |
| `"3.3"` | `"5"` | §5 Regression Infrastructure |
| `"3.4"` | `"6"` | §6 Human-in-the-Loop |
| `"3.5"` | `"7"` | §7 Full Coverage |
| `"3.7"` | `"8"` | §8 AI Telemetry (note: §3.6 was vacant, no gap) |
| `"4"` (Bid Workflow & Templates) | `"9"` | shifted +5 |
| `"5"` (Document Control) | `"10"` | shifted +5 |
| `"8"` (E2E Test Expansion) | `"11"` | shifted +3 |
| `"9"` (Codebase Health) | `"12"` | shifted +3 |
| `"11"` (Context Graph Phase 5) | `"13"` | shifted +2 |

(§2, §6, §7, §10 are currently vacant in the roadmap; the renumber closes
those gaps too. Verify against the live JSON before applying.)

**Per-item `id` cascade.** Each item's `id` is dotted-decimal positional
(e.g. `"3.1.8"`). Items keep their leaf number but the parent prefix
updates. Example: current item `"3.1.5"` becomes `"3.5"` (its parent
renumbered from `"3.1"` to `"3"` and the item's leaf-position stays the
same — wait, this is wrong; the cascade requires careful handling).

**Decision:** the renumber is implemented as a one-shot Python or Node
script (`scripts/migrate-roadmap-section-3.ts`) that takes the current
JSON, applies the mapping table, regenerates per-item `id` and
`section_id` consistently, and writes the new JSON in place. The script
is committed alongside the migration so the renumber is reproducible and
reviewable; the script can be deleted post-merge.

**Cross-doc reference sweep.** After the renumber, run a pre-flight grep to
produce a count and per-area breakdown of old §3.x id references:

```
grep -rn '§3\.\|"3\.[1-7]\.' --include="*.md" --include="*.ts" \
  lib/ app/ __tests__/ scripts/ .claude/agents/ .claude/skills/ \
  docs/ .planning/
```

**Always-rewrite scope** (must be zero matches after this WP lands):
`lib/`, `app/`, `__tests__/`, `scripts/`, `.claude/agents/`, `.claude/skills/`.
These are active code paths where stale references cause real failures.

**Best-effort scope** (stale refs degrade gracefully; may carry to follow-up):
`docs/continuation-prompts/`, `docs/plans/`, `docs/reference/state-of-the-product.md`,
`.planning/.archive/`. Historical prose archives do not cause test failures;
sweep them if time permits but do not block the WP on them.

For each match in always-rewrite scope, rewrite to the new id per the mapping
table. Group rewrites by file area for review. Expected sites in always-rewrite:
skill bodies, agent bodies, freshness tests.

### 5. Edit — Drift resolution

**Files:** `docs/reference/product-roadmap.json` and/or
`docs/reference/product-roadmap.md` (in-place edits).

Per inv 33 — the pre-existing `roadmap-roundtrip` test failures must
resolve as part of this WP. Investigation step (do this first, before
the §3 restructure):

1. Render the JSON to MD via `bun run roadmap:render` to a tmp file.
2. `diff` the rendered MD against `docs/reference/product-roadmap.md`.
3. Identify the drifted content (per S48 investigation, ~1,400 tokens of
   §12 material — but verify; the live diff is the source of truth).
4. Decide direction:
   - **(a)** Add the missing JSON entries — if the MD content is the
     intended forward state.
   - **(b)** Remove the MD-only entries — if they are stale.
   - **(c)** Mixed — for each drifted section, apply (a) or (b)
     individually.

**Default lean:** **(b) — strip stale MD entries.** Drift indicates content
has fallen out of the canonical JSON source. Back-fill JSON only for entries
Liam confirms main-track requires (review the classification table per Task 3
Subtask 2 default-lean override). Liam holds local backups of current
`product-roadmap.{json,md}` and `product-backlog.json`; aggressive strip is
recoverable. The concept-flip framing (current Roadmap = high-priority surface
that main-track will likely supersede; current Backlog = parked/deferred) is
relevant: drifted MD blocks that appear in the current Roadmap are likely
main-track scope and warrant back-fill consideration; drifted MD blocks that
appear only in the current Backlog are likely safe to strip.

The drift resolution lands as a separate commit before the §3 restructure
so the roundtrip baseline is green before any further changes touch the
file.

### 6. Edit — Render pipeline updates

**Files:** `scripts/roadmap-from-json.ts`, `scripts/roadmap-to-json.ts`.

The §3 flattening changes the nesting depth in places. The renderer and
parser both need to handle:

- Sections at depth 1 that previously had subsections — now they're flat
  top-level sections.
- Numbering with `+5`/`+3`/`+2` jumps in the source — but the renderer
  reads from JSON so this is transparent; no code change needed if the
  JSON is correct.
- The parser (`roadmap-to-json.ts`) must still produce identical JSON
  for the new MD structure — verify by re-parsing the post-restructure
  MD back to JSON and confirming round-trip.

**Likely outcome:** zero code changes to the render scripts. The
restructure is data-only. Confirm by running the round-trip test
post-restructure; if it passes, no script edit needed.

### 7. Edit — Freshness coupling registration

**File:** `lib/docs/tracked-reference-docs.ts`.

Append two entries to `TRACKED_REFERENCE_DOCS`:

```ts
'docs/reference/product-backlog.json',
'docs/reference/task-list.json',
```

This satisfies inv 48 and addresses Checker observation O1 from the
PRODUCT.md review pass. The freshness-coupling test
(`reference-doc-edit-coupled-freshness.test.ts`) automatically picks up
the new entries.

### 8. Test updates

**Files:** existing test files in `__tests__/docs/`.

- `roadmap-roundtrip.test.ts` — should pass unchanged once drift is
  resolved + restructure lands.
- `backlog-no-closed-rows.test.ts` — refactor to import `BacklogStatus`
  from the new schema module rather than hard-coding `ALLOWED_STATUSES`.
- `roadmap-no-shipped-rows.test.ts` — should pass unchanged (operates on
  rendered MD's Status column; restructure preserves forward-looking
  doctrine per inv 30).
- `reference-doc-edit-coupled-freshness.test.ts` — should pass unchanged
  once the new tracked docs have `<!-- Last verified: YYYY-MM-DD -->`
  headers.

**New tests** (in `__tests__/validation/`):

- `work-status.test.ts` — unit tests against the shared module. Cover:
  master `WorkStatus` enum contains all expected values; each per-surface
  subset (`TaskListStatus`, `BacklogStatus`, `RoadmapStatus`) contains
  exactly the expected values and rejects out-of-subset inputs; `Priority`
  master enum and any per-surface subsets compose correctly.
- `task-list-schema.test.ts` — unit tests against the new schema. Cover:
  valid Task, valid Subtask, sibling-only dep enforcement (positive +
  negative cases), status enum membership (uses `TaskListStatus` from shared
  module), immutable id (consumer-side, not schema), required fields present,
  optional fields nullable. No alias-normalisation tests — canonical form only.
- `backlog-schema.test.ts` — unit tests against the new formalised
  schema. Cover: valid item, status enum membership, new optional fields
  accept null + populated.

### 9. Open Question resolutions (deferred to consumer-layer)

PRODUCT.md raised four open questions; this TECH.md takes a position on
each:

- **Revision counter (inv 45 OQ)** — no root-level counter in this WP.
  Per-record `updatedAt` plus the workflow-layer's single-writer
  sequencing is sufficient. Revisit if a consumer hits a real write-race.
- **Task list initial path (PRODUCT OQ)** — `docs/reference/task-list.json`.
  Matches the Roadmap + Backlog location convention.
- **Task list MD renderer (PRODUCT OQ)** — not in scope. JSON-only.
  Revisit when a consumer asks for human-readable workflow-in-flight view.
- **§3 renumber alias retention (PRODUCT OQ)** — hard-renumber, no
  historical aliases. Cross-doc reference sweep (§4 above) rewrites
  references in the same commit. Old ids stop resolving — acceptable
  cost because main-track is the primary consumer and the renumber is a
  one-time discontinuity.

## Testing and validation

Each numbered PRODUCT.md invariant maps to one or more verification
steps below.

| Invariant(s) | Verification |
|---|---|
| 1–3, 41 | `task-list-schema.test.ts` — file exists, parses, validates |
| 4 | `task-list-schema.test.ts` — root shape only allows the listed keys (Zod strict mode) |
| 5–8 | `task-list-schema.test.ts` — Task shape (required + optional fields, type-checks) |
| 9–13 | `task-list-schema.test.ts` — Subtask shape (id is integer, `<info added on …>` accepted in `details`) |
| 14–16 | `task-list-schema.test.ts` — sibling-only dep `superRefine` (positive: sibling id present; negative: cross-Task id rejected) |
| 17–18 | Manual: spot-check `kh-sdlc-workflow.md` and `taskmaster-schema-reference.md` use `ID-N`/`ID-N.M` consistently (no test — convention is prose-only) |
| 19–20 | `task-list-schema.test.ts` — empty `tasks[]` valid; 25-subtask Task valid; 26-subtask Task warns (custom assertion) |
| 21–22 | `work-status.test.ts` — `WorkStatus` master enum + per-surface subset composition; `task-list-schema.test.ts` — `TaskListStatus` membership; `review` rejected at Task level; canonical underscore-form enforced (no alias normalisation) |
| 23–24 | Manual: workflow doc §3.5–3.6 owns transitions; spot-check |
| 25–26 | `work-status.test.ts` — `Priority` master enum membership; `task-list-schema.test.ts` — per-surface subset enforced |
| 27, 36 | Manual: file inspection confirms Roadmap, Backlog, Task list are three separate files |
| 28–31 | `roadmap-roundtrip.test.ts` (passes post-restructure); manual: spot-check the rendered §3 → top-level transition produces the expected MD |
| 32–35 | `roadmap-roundtrip.test.ts` — token equality between rendered + on-disk MD |
| 37–40 | `backlog-schema.test.ts` — current ids unchanged; new optional fields accept null + populated; forward-looking doctrine preserved |
| 42–44 | Manual: dry-run an append (Curator skill writes a new Task), update (mark a Subtask `done`), and delete (remove a cancelled Task) against the new schema |
| 45 | OUT OF SCOPE (deferred per OQ resolution above) — no test |
| 46–47 | Manual: spot-check that cross_doc_links anchors resolve (`grep -rn "#ID-"` produces matches against actual Tasks/Subtasks) |
| 48 | `reference-doc-edit-coupled-freshness.test.ts` — all three files in tracked-reference-docs list (assertion exists post-edit) |
| 49–51 | Manual: spec compliance — no file rename, no content move between roadmap and backlog (verify via `git diff --stat`) |
| 52–54 | `reference-doc-edit-coupled-freshness.test.ts` — last_updated bumps; `<!-- Last verified -->` headers present on all three |
| 55–57 | Manual: post-merge inspection of all three files; full test suite green; `bun run roadmap:render` produces zero-diff output |

**Full regression checkpoint.** Before any commit lands, run
`bun run test` (full Vitest, not changed-only) and confirm the **2 known
roadmap-roundtrip failures** (per S49 baseline) become **0 failures**.
The pre-existing 3rd failure (`data-entry-points.md` freshness drift) may
remain and is acknowledged as a separate carry-forward — landing at
`2 fail / 12453 pass / 24 skip` is acceptable for this WP; landing at
`1 fail` (data-entry-points-only) is success.
Any other test regression is a blocker.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **R1.** §3 cross-doc references in always-rewrite scope (skill/agent bodies, lib/, app/) are missed → references break silently in active code paths | Medium | Medium | Pre-flight grep produces per-area count before any edits. Always-rewrite scope (`lib/`, `app/`, `__tests__/`, `scripts/`, `.claude/agents/`, `.claude/skills/`) must reach zero before WP closes. Best-effort scope (prose archives) may carry stale refs — they degrade gracefully. Commit the script in §4 with the rewrite mapping so review is mechanical. |
| **R2.** Drift-resolution strips MD entries that main-track will need → content is lost | Medium | Medium | Step 1 of drift resolution is INSPECTION, not editing; surface the classification table to Liam for direction before any edits land. Default lean is strip-stale; back-fill JSON only on Liam ratification. Backups exist locally — strip is recoverable. The concept-flip framing helps classify: entries appearing in the current Roadmap (high-priority surface) warrant back-fill consideration; entries only in Backlog (parked) are likely safe to strip. |
| **R3.** Render-pipeline coupling — `roadmap-from-json.ts` or `roadmap-to-json.ts` has implicit assumptions about §3-as-parent that break on flatten | Low | High | Run `bun run roadmap:render` against the restructured JSON locally first; if it fails, inspect script for hard-coded §3 logic before §4 commit. Likely-clean outcome per §6 analysis. |
| **R4.** Backlog schema defines `BacklogStatus` using canonical `spec_needed` but existing 36 items carry `needs_spec` → `backlog-no-closed-rows.test.ts` trips or parse fails | Low | Medium | The schema is correct first (per §1.0 shared module design). The 36-item retrofit is deferred to FU-NEW. The Executor must NOT adjust the schema to accept `needs_spec` as a valid status — that would undermine the unification. Existing backlog tests parse the raw JSON; those tests will need updating per FU-NEW when the retrofit lands, not here. |
| **R5.** `update-roadmap-backlog` skill becomes incompatible with the new shapes mid-migration | Low | Medium | The skill writes via `Edit` (no schema validation in the skill itself) and uses generic `Read`. It tolerates schema additions; only a schema *restriction* would break it. This WP only adds optional fields. Run a dry-run of the skill against a synthetic finding post-migration to verify. |
| **R6.** Concurrent-write race during the migration itself (Liam edits backlog while migration runs) | Low | Medium | Migration is a single-session WP; freeze backlog edits via the session-counter convention (S50 wave A holds the write turn). |
| **R7.** (Removed — alias preprocessing not implemented; no alias risk.) | — | — | — |

## Parallelization

The seven module-level changes split cleanly across three parallel work
streams once §5 (drift resolution) lands. Strict file-ownership boundaries
prevent merge conflicts:

| Stream | Owns | Depends on |
|---|---|---|
| **S-A** Task list | `lib/validation/work-status.ts` (new shared module) + `lib/validation/task-list-schema.ts` + `docs/reference/task-list.json` + `__tests__/validation/work-status.test.ts` + `__tests__/validation/task-list-schema.test.ts` | (none — fully independent; S-A owns work-status.ts since Task list creates it first) |
| **S-B** Roadmap restructure | `docs/reference/product-roadmap.{json,md}` + `scripts/migrate-roadmap-section-3.ts` | §5 drift resolution must land first |
| **S-C** Backlog formalise | `lib/validation/backlog-schema.ts` + `__tests__/validation/backlog-schema.test.ts` + edit to `__tests__/docs/backlog-no-closed-rows.test.ts` | S-A must land first (imports `BacklogStatus` from `work-status.ts`) |

After all three streams land, a single integrator commit handles §7
(`lib/docs/tracked-reference-docs.ts` registration). That commit also
runs the cross-doc reference sweep against §3 ids.

**Worktree isolation requirement.** Per CLAUDE.md "Parallel agent
isolation" — each stream gets `isolation: "worktree"` if dispatched to
agents. Each stream's first action is `git reset --hard main` to escape
worktree staleness (per the gotcha). Sequential merge on main; check
`git status` for leaked files between merges; `git clean -fd` if any.

## Follow-ups

These are deferred items surfaced by this WP. They do **not** land here.

- **FU-1: Content migration of items between Roadmap and Backlog** —
  main-track scope per S48 framing. Triggers after main-track feature-spec
  ratification. This WP's only obligation is that the new schemas do not
  prevent the future move (inv 49–51 satisfy this).
- **FU-2: `depends_on` → `dependencies` rename in Backlog** — per PRODUCT
  inv 38, the canonicalisation is deferred to a separate WP. When it
  lands, the schema gains a read-alias and the field rename runs once
  across all 36 backlog items.
- **FU-3: `update-roadmap-backlog` skill CRUD extension** — currently the
  skill appends only; future Curator workflows want in-place updates and
  deletions. Owner: ID-2 follow-on or a separate roadmap-backlog skill
  pass. References this WP's schema additions.
- **FU-4: `triage-finding` ID-N terminology pass** — per S49 ratification
  B10, the binary in-scope-ness rule + ID-N composite-id terminology
  needs to land in the skill body. Bundled with FU-3.
- **FU-5: File-rename WP (label-reversal content swap)** — when the
  content migration (FU-1) is ready, file paths may swap
  (`product-roadmap.json` ↔ `product-backlog.json`) per the
  update-roadmap-backlog skill's own forward-looking note. Will require
  a sweep of `lib/docs/tracked-reference-docs.ts`, the
  `update-roadmap-backlog` skill body, the freshness test, any CI
  workflows, and MCP resource registrations. Surfaced by Checker
  observation O3.
- **FU-6: Task list MD renderer** — if consumers ask for a human-readable
  Task list view, author a renderer modelled on `roadmap-from-json.ts`
  with a tabular layout per ID-N. Deferred until ask.
- **FU-7: Per-record revision counter** (PRODUCT OQ inv 45) — if
  per-record `updatedAt` proves insufficient for a future concurrent-write
  scenario, add a root-level revision counter and an optimistic-concurrency
  check on writes. Deferred until needed.
- **FU-8: Status data migration for backlog** — superseded by FU-NEW below
  for the canonical-status rename specifically. If further status-semantics
  unification is needed beyond the `needs_spec → spec_needed` rename, that
  work runs as part of FU-3 or a successor WP.
- **FU-NEW: Backlog 36-item canonical status retrofit** — rename `needs_spec`
  → `spec_needed` across the existing 36 items in `product-backlog.json` in a
  single edit. Deferred until main-track confirms which existing items will be
  preserved (items superseded by main-track work may be removed rather than
  renamed). Can run alongside FU-2 (`depends_on → dependencies`) since both
  are single-pass field-value edits on the same file.
- **FU-9: `data-entry-points.md` freshness drift** — surfaced at S49
  test baseline (`reference-doc-edit-coupled-freshness.test.ts` fails on
  this one tracked doc). Out of scope for this surface migration but
  worth resolving in the same close-out as WP5 if a hand is free —
  one-line `<!-- Last verified: YYYY-MM-DD -->` header bump.
