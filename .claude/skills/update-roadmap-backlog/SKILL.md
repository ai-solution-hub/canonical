---
name: update-roadmap-backlog
description:
  Full-CRUD + Promote maintenance of the roadmap and backlog JSON ledgers — create
  new items from a triaged finding (with provenance: source ID-N, source-commit-sha,
  or session counter), update existing items' status / priority / notes fields
  (covers status transitions like pending → in-progress → done), delete items
  (strictly cancelled / reclassified items — never done closures, which retain
  in-place per s48-feedback B6), or promote a backlog item atomically to
  task-list.json as a new Task or Subtask (the canonical done-closure path for
  backlog items). Regenerates the rendered MD if a render pipeline exists. Invoked
  by the workflow-curator agent (Create after triage-finding returns roadmap/backlog)
  or directly by the workflow-orchestration skill (Update for status transitions;
  Delete for cancellations; Promote when picking up a backlog item for
  implementation).
allowed-tools: Read, Edit, Bash, Grep
---

# update-roadmap-backlog — CRUD Maintenance of the Ledger

Maintains the roadmap and backlog JSON ledgers across the full Create / Read / Update / Delete lifecycle, regenerating the rendered MD via the project's render pipeline if available.

**Operation modes:**

| Mode | Invoked by | Purpose |
|------|------------|---------|
| **Create** | workflow-curator (after `triage-finding` returns `roadmap` or `backlog`) | Append a new item with provenance. Default mode. |
| **Update** | workflow-orchestration skill (status transitions); curator (priority/notes edits) | Edit `status`, `priority`, or `notes` on an existing item. Canonical use case: S52 WP2 ID-11-14 pattern (status moves from `pending` → `in-progress` → `done`). |
| **Delete** | workflow-orchestration skill (cancellations); curator (reclassifications) | Remove an item. **Scope: `cancelled` items and reclassifications only.** Never used for `done` closures — those use Promote. |
| **Promote** | workflow-orchestration skill (at session-start when picking up a backlog item) | Atomically remove a backlog item and add it as a Task or Subtask on `docs/reference/task-list.json`. The canonical done-closure path for backlog items. |

The Create path (Steps 1–7 below) is the original append-only flow and remains the default. Update, Delete, and Promote sections at the end of this skill define their own invocation flows; all share the target → file mapping (Step 1) and the validation gate (Step 5).

---

## Inputs

The curator invokes this skill with:

| Field | Description |
|-------|-------------|
| `target` | `roadmap`, `backlog`, or `task-list` (the **target semantics**, not the current legacy filename) — `task-list` writes a new top-level Task per Subtask 31.9 (T-OQ-2 RATIFIED) |
| `finding_detail` | The finding from the source agent, summarised for ledger storage |
| `provenance.source_task_id` | Workpackage ID (e.g. `WP1.2`) or null |
| `provenance.source_commit_sha` | Short SHA from the source commit, or null |
| `provenance.session_counter` | Session ID (e.g. `kh-prod-readiness-s47`) |
| `triage_payload` | The full `triage-finding` output (carries section / track / type / priority) |
| `umbrella_id` | `string` (kebab-case) or `null` (default `null`). Shared on Create + Promote per Subtask 31.9. When non-null AND destination resolves to a top-level Task: triggers same-commit edit to `docs/reference/umbrellas.json` appending the new Task id to that umbrella's `task_ids[]` (idempotent — see Step 8 below). When null: no umbrella edit (Task lands as orphan per P-OQ-2 soft warning). Ignored when destination is a Subtask (subtasks inherit parent Task's umbrella membership). |

---

## `last_updated` field-discipline (load-bearing)

The `last_updated` field on every ledger (`product-roadmap.json` /
`product-backlog.json` / `task-list.json`) is a **single-line freshness marker only**.
It is NOT a session-log, NOT a diary, NOT a place to record narrative. The
Zod schema (`lib/validation/task-list-schema.ts`) enforces:

- `max(200)` chars hard cap
- `^kh-(prod-readiness|main)-S\d+` prefix
- single-line (no embedded newlines)
- **exactly one session-id** (rejects diary-style "Earlier: kh-..." concat)

### Canonical shape

```
kh-{track}-S{N}[letter] {wave} close-out — curator {verb} {item_id}[ ({short reason})]
```

`{verb}` ∈ `added | updated | deleted | promoted`. `{short reason}` is bounded
to ≤80 chars and OPTIONAL — omit if the verb + item_id is self-explanatory.

### Examples (Create / Update / Delete / Promote)

```
kh-prod-readiness-S64 W0c close-out — curator added 35 (ledger-CLI Task stub)
kh-prod-readiness-S64 W1 close-out — curator updated 32 (status flip)
kh-prod-readiness-S64 W2 close-out — curator deleted 99 (cancelled, superseded)
kh-prod-readiness-S64 W3 close-out — curator promoted backlog/12 → task-list/36
```

### MUST NOT

- Narrative (test counts, finding SHAs, multi-paragraph summaries) — those belong
  in per-Subtask `details` `<info added on ...>` journal blocks (PRODUCT inv 13),
  commit messages, continuation prompts, or the mempalace diary.
- Concatenated prior-session narrative (`. Earlier: kh-...`). The root cause of
  S64 W0 remediation was the historical convention of prepending prior values
  on cherry-pick conflict — DO NOT continue that pattern.
- Multi-line values (embedded `\n`).
- `{summary}` freetext placeholders inviting unbounded prose. Wherever a
  format-string template appears below, the slot is bounded by the rule above.

If a write violates the shape, the schema parse fails at session-start
(`parseTaskListWithWarnings` throws), surfacing the violation before any
downstream work begins.

---

## Step 1: Resolve target → file

| Target semantics | File |
|---|---|
| Strategic / cross-cutting / multi-month | `docs/reference/product-roadmap.json` |
| Tactical / single-feature / weeks-scope OR parked / deferred / pre-work | `docs/reference/product-backlog.json` |
| Forward Task creation (new top-level Task, with or without umbrella membership) | `docs/reference/task-list.json` |

The mapping is 1:1 by `document_purpose`. The skill enforces target-semantic routing; the curator never auto-corrects the destination.

**`task-list` target (per Subtask 31.9 — T-OQ-2 RATIFIED):** writes a new top-level Task into `task-list.json#/tasks`. Used by the Orchestrator when opening a forward Task JIT (per TECH §6.5 of `docs/specs/canonical-pipeline-task-list-migration/TECH.md`). The Promote mode (below) handles backlog → task-list MOVE semantics — Create with `target: 'task-list'` is the **new-Task creation** path (no backlog source).

---

## Step 2: Read the current file

Read the target file with the `Read` tool. Validate the JSON is well-formed.

Roadmap schema reference: `lib/validation/roadmap-schema.ts` (Zod, `.strict()`).
Backlog schema: documented inline in `docs/reference/product-backlog.json` `items[*]` shape:

```json
{
  "id": "string",
  "description": "string",
  "type": "feature | research | infra | tech_debt | ...",
  "status": "spec_needed | needs_research | parked | ready | blocked",
  "effort_estimate": "string | null",
  "priority": "high | medium | low",
  "track": "string",
  "dependencies": ["..."],
  "session_refs": ["..."],
  "commit_refs": ["..."],
  "cross_doc_links": ["..."],
  "notes": "string | null"
}
```

---

## Step 3: Compose the new entry

### For roadmap (Shape A — `RoadmapThemeSchema`)

Under Shape A (per PRODUCT inv 6-9 + TECH §3.1 + §4.2), the Roadmap is a flat list of **themes** — multi-month capability areas, NOT sections of typed items. The Step 3 field set targets `RoadmapThemeSchema` (added in PR-A; see `lib/validation/roadmap-schema.ts`). The pre-Shape-A field set (`section_id`, `phase_label`, `severity`, `priority`, `status_note`, `owner`, `depends_on`, `blocks`, `coordinates_with`) is dropped wholesale — none of those fields exist under Shape A.

Required fields per `RoadmapThemeSchema`:

| Field | How to populate |
|-------|-----------------|
| `id` | Next free bare-digit id across `themes[]` (e.g. if existing theme ids are 1-10, new id is `"11"`). Schema enforces `BARE_ID_REGEX`. |
| `title` | Short capability name from `triage_payload.roadmap_proposed_theme.title`. UK English. |
| `description` | Multi-paragraph Markdown — why this capability matters, the outcome shape, optional bullet list of constituent work. From `triage_payload.roadmap_proposed_theme.description`. |
| `time_horizon` | From `triage_payload.roadmap_proposed_theme.time_horizon`. Default `"later"` per PRODUCT inv 13 a + P-OQ-2. Enum: `now | next | later`. |
| `status` | `"pending"` by default per P-OQ-1. Enum: `pending | in_progress | done`. |
| `linked_tasks` | From `triage_payload.roadmap_proposed_theme.initial_linked_tasks[]`. Array of task ids that contribute to this theme; `[]` if none yet. |
| `linked_backlog` | From `triage_payload.roadmap_proposed_theme.initial_linked_backlog[]`. Array of backlog item ids that contribute to this theme; `[]` if none yet. |
| `session_refs` | `[provenance.session_counter]` at minimum. Add `provenance.source_task_id` if available. |
| `commit_refs` | `[provenance.source_commit_sha]` if available, else `[]`. |
| `cross_doc_links` | If the finding cites a spec, populate with `[{ path, anchor, raw }]`. Else `[]`. |
| `notes` | Free text; default `null`. |

**Provenance lives in `session_refs` + `commit_refs`** because `RoadmapThemeSchema` is `.strict()` and does not accept a separate `metadata.source` field — the existing convention is for `last_updated` and item-level `session_refs` / `commit_refs` to carry tracing data.

**Soft-cap awareness (PRODUCT inv 8 + failure-modes bullet 8):** Before appending the theme, count `themes[].length`. If the new entry would push the count to 13+, surface a warning to the curator (the `parseRoadmapWithWarnings()` helper will emit a warning at write-time; consider whether two existing themes should merge first per PRODUCT inv 8 soft cap).

### For backlog

Required fields per `BacklogItemSchema` (`lib/validation/backlog-schema.ts`):

| Field | How to populate |
|-------|-----------------|
| `id` | Allocate next bare-digit integer above the current highest id in the file (post ID-15.4 migration all ids are bare digits, e.g. `66` if the current highest is `65`). |
| `description` | One-sentence description of the finding. UK English. |
| `type` | From triage payload `backlog_slot.type`. |
| `status` | From triage payload `backlog_slot.status`. Default `spec_needed`. |
| `effort_estimate` | From triage payload, e.g. `"3-5h"` or `null` if unknown. |
| `priority` | From triage payload `backlog_slot.priority`. Default `medium`. |
| `track` | From triage payload `backlog_slot.track`. |
| `dependencies` | [] unless triage identifies dependencies. |
| `session_refs` | Array of session identifiers. Populate with `[provenance.session_counter]` at minimum, plus `provenance.source_task_id` if available. |
| `commit_refs` | Array of commit SHAs. Populate with `[provenance.source_commit_sha]` if available, else `[]`. |
| `cross_doc_links` | Array of DocLink objects `{ path, anchor, raw }`. Populate if the finding cites a spec or doc; else `[]`. |
| `notes` | Free-text. Include the finding's evidence reference (`file:line`) if available. |
| `rank` | From triage payload `backlog_slot.rank`. Default `null`. If the triage payload supplies an explicit integer, use it. If the priority tier already has items ranked (e.g. tier `high` has items ranked 1-5), the curator may choose to insert at the next free integer (e.g. `6`) or leave `null` — the auto-shift collision policy in Update mode handles re-ranking when an explicit collision occurs. Per PRODUCT inv 3, the schema does NOT enforce uniqueness or contiguity within a priority tier. |

**Provenance lives in `session_refs` + `commit_refs`** for backlog items, populated at creation time from the curator's current session context.

### For task-list (new top-level Task — Subtask 31.9 / T-OQ-2 RATIFIED)

Required fields per `TaskSchema` (`lib/validation/task-list-schema.ts`, `.strict()`):

| Field | How to populate |
|-------|-----------------|
| `id` | **MUST equal `MAX_ID_ACROSS_BRANCHES + 1`** per cross-branch MAX-ID discipline (PRODUCT inv 10 + `workflow-orchestration` SKILL.md §`Task ID assignment: cross-branch MAX-ID discipline`). The caller (Orchestrator) computes this via the documented `git show origin/{branch}:docs/reference/task-list.json` sweep; this skill does NOT re-compute. Bare-digit string regex (`^\d+$`). |
| `title` | Human-readable Task title from the caller's forward-Task open brief. UK English. |
| `description` | One-paragraph overview. |
| `status` | Default `"pending"`. Use `"done"` only for retrospective Tasks per `umbrellas-helpers.formatRetrospectiveJournalBlock()`. |
| `priority` | From caller; valid values per shared `Priority` enum (`must | should | could | future | high | medium | low | trigger`). |
| `dependencies` | Caller-supplied array of sibling Task ids; `[]` if none. |
| `subtasks` | Initially `[]` for forward Tasks; the spec-chain Subtasks (`{N.1 RESEARCH, N.2 PRODUCT, N.3 TECH, N.4 PLAN}`) are populated separately via `spec-driven-implementation`. |
| `updatedAt` | ISO 8601 timestamp at creation time (`new Date().toISOString()`). |
| `effort_estimate` | **MUST be present (explicit `null` acceptable).** |
| `owner` | **MUST be present (explicit `null` acceptable).** |
| `priority_note` | **MUST be present (explicit `null` acceptable).** |
| `status_note` | **MUST be present (explicit `null` acceptable).** |
| `cross_doc_links` | Array of `DocLink` objects `{ path, anchor, raw }`. Populate with spec-substrate links (e.g. PLAN.md/PRODUCT.md/TECH.md) when present; else `[]`. |
| `session_refs` | `[provenance.session_counter]` at minimum; add `provenance.source_task_id` if available. |
| `commit_refs` | `[provenance.source_commit_sha]` if available, else `[]`. |
| `capability_theme` | Optional. Roadmap theme id back-link (per ID-30 PR-A copy-through). Distinct from `umbrella_id`: `capability_theme` points at the Shape A Roadmap; `umbrella_id` points at the umbrella (Linear-Initiative analogue). Both may coexist. |

All four nullable fields (`effort_estimate`, `owner`, `priority_note`, `status_note`) MUST be present in the JSON object even if the value is `null` — the schema requires the keys.

**Provenance lives in `session_refs` + `commit_refs` + `cross_doc_links`** (same convention as roadmap themes and backlog items).

---

## Step 4: Append the entry

### For roadmap

Use `Edit` to insert the new item into the target section's `items` array. Maintain JSON formatting:

- Indent matches surrounding items (2-space).
- Trailing commas: no (JSON, not JSON5).
- Field order: match the schema field order seen in other items in the same section.

After the entry append, update the roadmap-level `last_updated` field per the §`last_updated` field-discipline rule above. Format: `"{session-counter} {wave} close-out — curator added {new-id}[ ({≤80-char reason})]"`.

### For backlog

Use `Edit` to insert the new item into `items[]`. Same JSON-formatting rules. Update the `last_updated` field per the same field-discipline rule above (no diary-style append).

### For task-list

Use `Edit` to insert the new Task into `tasks[]` of `docs/reference/task-list.json`. Same JSON-formatting rules (2-space indent, no trailing commas, field-order match). Update the file-level `last_updated` field per the §`last_updated` field-discipline rule above. Format: `"{session-counter} {wave} close-out — curator added {new-task-id}[ ({≤80-char reason})]"`.

---

## Step 5: Validate

After the edit, re-read the file and confirm the JSON parses. Run:

```bash
# Roadmap: validate via the schema (round-trip is the strongest test)
bun run roadmap:render
```

If `bun run roadmap:render` exits non-zero, the JSON has drifted from the schema — revert your edit and report the validation error to the curator. The roadmap render is the canonical guard for `product-roadmap.json` (round-trip CI guard at `__tests__/docs/roadmap-roundtrip.test.ts`).

**Shape A soft-cap warning (PRODUCT inv 8):** For Roadmap Create operations, also invoke `parseRoadmapWithWarnings()` from `@/lib/validation/roadmap-schema` (added in PR-A per TECH §3.3). The helper returns `{ value, warnings }`; surface any warnings (e.g. "Roadmap has 13 themes (>12). Per PRODUCT inv 8, consider merging.") to the curator before completing the Create. The schema parse itself does not block 13+ themes — the soft cap is enforced via warning, not error.

For the backlog there is **no render pipeline** today (the file is read directly). Validation is JSON well-formedness only — confirm:

```bash
bun -e "JSON.parse(require('fs').readFileSync('docs/reference/product-backlog.json', 'utf8')); console.log('OK')"
```

If the JSON fails to parse, revert your edit and report.

For the `task-list` target, validate via `parseTaskListWithWarnings()` from `@/lib/validation/task-list-schema` — schema parse must succeed and any surfaced warnings should be reported to the curator. If validation fails, revert your edit. The umbrella round-trip test (`__tests__/docs/umbrellas-task-list-roundtrip.test.ts`) covers the cross-doc invariant separately at next test run.

---

## Step 6: Render the MD (roadmap only)

If `bun run roadmap:render` succeeded in Step 5, the MD is already regenerated. Confirm `docs/reference/product-roadmap.md` reflects the new entry by grepping for the new item ID:

```bash
grep "{new-id}" docs/reference/product-roadmap.md
```

If the grep returns no match, something is off — report to the curator. Otherwise the write is complete.

The backlog has no MD render today; the JSON is the only artefact.

---

## Step 7: Report back to the curator

```yaml
WRITE COMPLETE

target: roadmap | backlog | task-list
file: docs/reference/product-{roadmap|backlog}.json | docs/reference/task-list.json
new_item_id: "{id}"
section_id_or_track: "{section or track}"
last_updated_field: "{new last_updated value}"
md_render: rendered | n/a
validation: passed | failed
provenance:
  source_task_id: "{value or null}"
  source_commit_sha: "{value or null}"
  session_counter: "{value}"
umbrella_membership:  # populated only when umbrella_id was supplied and destination is a Task
  umbrella_id: "{id}" | null
  task_ids_updated: true | false
```

---

## Step 8: Umbrella membership edit (optional) — Subtask 31.9 / TECH §6.4

**Applies when:** `umbrella_id` input is non-null AND the destination resolves to a top-level Task (i.e. `target === 'task-list'` Create OR Promote mode with `destination_shape === 'new_top_level_task'`). Ignored for Subtask destinations and for roadmap/backlog Create targets.

**Spec reference:** the spec slice for this step uses the label `9.` per `docs/specs/canonical-pipeline-task-list-migration/TECH.md` §6.4 line 627. The label here is `8.` because the post-ID-30 Create-mode flow numbers 1-7; this step follows immediately. The semantic position (after Step 7 Report and before mode-specific sections) and the procedure below are exactly as specified.

After the existing Create-mode (or Promote-mode) write completes:

1. **Load** `docs/reference/umbrellas.json` via the `Read` tool.
2. **Parse** via `UmbrellasSchema` (import: `import { UmbrellasSchema } from '@/lib/validation/umbrellas-schema'`). On parse failure, abort and report `STEP 8 ABORTED: umbrellas.json failed UmbrellasSchema parse — {error}`. Do NOT proceed; the curator must repair `umbrellas.json` first.
3. **Find** the umbrella entry with `id === input.umbrella_id`. If not found, abort and report `STEP 8 ABORTED: umbrella_id "{id}" not found in umbrellas.json#/umbrellas[]`. Do NOT auto-create the umbrella entry — umbrella creation is a curator decision, not a Create-side-effect.
4. **Append the destination Task id** to that umbrella's `task_ids[]` array. **Idempotent:** if the id is already present, skip the append (the membership write is a no-op; the rest of the step still runs).
5. **Bump `last_updated`** on `umbrellas.json` per the §`last_updated` field-discipline rule above (single line, ≤200 chars, single session-id, `kh-{prod-readiness|main}-S{N}` prefix). Format: `"{session-counter} {wave} close-out — curator added task {new-task-id} to umbrella {umbrella-id}"`.
6. **Re-validate** the modified `umbrellas.json` via `UmbrellasSchema.parse(...)`. On failure, abort and revert the `umbrellas.json` edit; report `STEP 8 ABORTED: post-edit UmbrellasSchema.parse failed — {error}`.
7. **Commit-coupling (PRODUCT inv 17 — load-bearing):** the caller (Orchestrator or curator) MUST include BOTH `docs/reference/task-list.json` AND `docs/reference/umbrellas.json` edits in a **single commit**. This is procedural — there is no automated guard. The umbrella round-trip test (`__tests__/docs/umbrellas-task-list-roundtrip.test.ts`) catches broken references (orphans warn but don't fail per P-OQ-2).

**Capability theme coexists peacefully (per ID-30 PR-A):** `capability_theme` (set on the Task object itself, points at a Roadmap theme) and `umbrella_id` (drives the umbrellas.json membership append) are orthogonal fields — both may be supplied in the same Create or Promote call. Combined Promote signature: `Promote(source_backlog_id, dest_task_id, [capability_theme], [umbrella_id])`. Both optional; different surfaces.

**Forward-Task open pattern (per TECH §6.5 of `docs/specs/canonical-pipeline-task-list-migration/TECH.md`):**

When the orchestrator opens each forward Task JIT (per PRODUCT inv 6 of the same spec):

1. Compute fresh resolved id via cross-branch MAX-ID query (per `workflow-orchestration` SKILL.md §`Task ID assignment: cross-branch MAX-ID discipline`).
2. Open the Task with spec-chain Subtasks (`{N.1 RESEARCH, N.2 PRODUCT, N.3 TECH, N.4 PLAN}`) per `spec-driven-implementation` skill.
3. Call this skill's Create mode with `target: 'task-list'` and `umbrella_id: 'canonical-pipeline'` (or other applicable umbrella).
4. Optionally append `(see Task ID-NN)` backlink to PLAN.md §4.n header per PRODUCT inv 14 of the migration spec.

---

## Update mode — edit existing item fields

Used to transition an existing item's `status`, `priority`, or `notes` field. **Canonical use case:** S52 WP2 ID-11-14 status transitions (e.g. roadmap item moves from `pending` to `in-progress` when work starts, then to `done` when the wave-close confirms acceptance). Other allowed edits: `priority` bump in response to new evidence; `notes` append to record a decision or block.

### Inputs (Update)

| Field | Description |
|-------|-------------|
| `target` | `roadmap` or `backlog` |
| `item_id` | The ID of the existing item to edit (e.g. `"ID-11"`, `"9.15"`, `"28"`). |
| `field_edits` | Map of allowed mutable fields. Backlog: `{ status?, priority?, notes?, rank? }`. Roadmap (Shape A theme): `{ status?, notes?, time_horizon? }`. Only allowed fields are mutable via this skill. |
| `provenance.session_counter` | Session ID for the `last_updated` stamp. |
| `provenance.source_commit_sha` | Optional, appended to `commit_refs` (roadmap) or `notes` (backlog) if supplied. |

### Update flow

1. **Resolve target → file** (same mapping table as Step 1 of Create).
2. **Read the file** and locate the item by `id`. If the ID does not exist, abort and report `UPDATE FAILED: item_id "{id}" not found in {file}`.
3. **Validate the proposed edits:**
   - For `status`: must be a value in the schema enum. Roadmap theme status enum (per `RoadmapThemeSchema`): `pending | in_progress | done` (per P-OQ-1 default; verify the live enum at edit time — schema is `.strict()`). Backlog status enum: `spec_needed | needs_research | parked | ready | blocked` (no `done` — done items follow Delete-or-retain rules below).
   - For `priority` (backlog only): must be a value in the shared `Priority` master enum (`must | should | could | future | high | medium | low | trigger`).
   - For `notes`: free text. **Do not overwrite existing notes** — append with a session-counter prefix (e.g. `"[s52] Status moved to in-progress because …"`).
   - For `rank` (backlog only): integer (positive, negative, or zero — schema imposes no sign constraint) or `null`. Per PRODUCT inv 3, the schema does NOT enforce uniqueness or contiguity within a priority tier. **Collision behaviour (per P-OQ-3 default):** the curator skill auto-shifts existing items in the same priority tier — inserting at `rank: N` in tier T pushes every item in tier T with `rank ≥ N` to `rank + 1`. See "Rank auto-shift policy" below.
   - For `time_horizon` (roadmap only): must be one of `now | next | later`.
4. **Apply the edit** with `Edit` (one targeted `old_string` / `new_string` pair per field). Preserve surrounding fields, indentation, and trailing-comma rules (JSON, not JSON5).

   **Rank auto-shift policy (Backlog `rank` Update only, per P-OQ-3 default):**

   ```
   if field_edits.rank is set AND target tier has items with rank >= new_rank:
     for each item in tier with rank >= new_rank, increment item.rank by 1
     apply field_edits.rank
     emit warning: "auto-shifted N items in tier T to accommodate insert at rank=K"
   ```

   Pseudocode:
   1. Read the backlog `items[]`. Filter to items where `item.priority == target.priority` AND `item.id != target.id` (the tier members excluding the item being edited).
   2. Find collisions: items where `item.rank !== null && item.rank >= field_edits.rank`.
   3. For each collision, emit a separate `Edit` operation incrementing `item.rank` by 1. Preserve insertion order so the auto-shift is deterministic.
   4. Apply the original `field_edits.rank` to the target item.
   5. Surface a warning in the YAML report: `auto_shifted: { tier: "{priority}", count: N, items: ["{id1}", "{id2}", ...] }`.

   Items with `rank: null` in the same tier are NOT touched by auto-shift (they have no ordering signal to preserve).

5. **Update `last_updated`** at the file level per the §`last_updated` field-discipline rule above. Format: `"{session-counter} {wave} close-out — curator updated {item_id}[ ({≤80-char field-summary, e.g. status flip})]"`. **Do NOT** embed multi-sentence prose or test counts — that violates the rule.
6. **Run the same validation gate as Step 5 of Create** (`bun run roadmap:render` for roadmap; JSON well-formedness check for backlog). Revert and report on failure.
7. **Report:**

```yaml
UPDATE COMPLETE

target: roadmap | backlog
file: docs/reference/product-{roadmap|backlog}.json
item_id: "{id}"
fields_changed:
  status: "{old} → {new}" | unchanged
  priority: "{old} → {new}" | unchanged
  notes: "appended" | unchanged
  rank: "{old} → {new}" | unchanged  # backlog only
  time_horizon: "{old} → {new}" | unchanged  # roadmap only
auto_shifted:  # backlog rank Update only; null if no collisions
  tier: "{priority}"
  count: {N}
  items: ["{id1}", "{id2}"]
last_updated_field: "{new last_updated value}"
md_render: rendered | n/a
validation: passed | failed
```

### What Update is NOT

- **Not for `done` closures on the backlog.** Backlog `status` enum has no `done` value. A finished backlog item is either removed via Delete (if it was reclassified or cancelled) or — when work is being picked up — moved to the task-list via **Promote** (the canonical done-closure path; see Promote mode section below).
- **Not for ID changes.** Renaming an item's ID is a separate migration concern (delete + re-create); not in scope here.
- **Not for `description` / `title` rewrites.** Item bodies are append-only via `notes`. Substantive rewrites require a delete-and-create cycle to preserve audit trail.

---

## Delete mode — remove an item

Used **only** for `cancelled` items (work that was abandoned or superseded) and **reclassifications** (an item moves from roadmap to backlog, or vice versa, requiring a delete from the source ledger followed by a Create on the destination). Most commonly invoked by the workflow-orchestration skill when closing a cancelled WP, or by the curator after a re-triage decides the item should move ledgers.

**Non-goal — explicitly excluded from Delete:**

- **`done` closures.** A roadmap item moving to `status: "done"` is an **Update** operation, not a Delete. The item retains in-place for traceability per s48-feedback B6 (Continuation-prompt mode declaration retains historical context) and the S51 close-out remediation Fix A correction (task-list retains `done` Tasks; closure is a status transition, not a deletion). The roadmap's `forward_looking_only: true` schema literal applies to new entries — existing items that complete are not retroactively pruned.

### Inputs (Delete)

| Field | Description |
|-------|-------------|
| `target` | `roadmap` or `backlog` |
| `item_id` | The ID of the item to remove. |
| `reason` | One of: `cancelled`, `reclassified_to_roadmap`, `reclassified_to_backlog`, `superseded_by_{other_id}`. **No other reasons accepted.** |
| `provenance.session_counter` | Session ID for the `last_updated` stamp. |
| `reclassification_target` | If `reason` starts with `reclassified_`, the new `target` for the Create that will follow. |

### Delete flow

1. **Resolve target → file** (same mapping table as Step 1 of Create).
2. **Validate `reason`.** If `reason` is anything outside the allowed set (in particular, anything that looks like a closure — `done`, `completed`, `finished`, `shipped`), abort and report `DELETE REJECTED: reason "{reason}" not in allowed set; done closures use Update mode`.
3. **Read the file** and locate the item by `id`. If not found, abort and report `DELETE FAILED: item_id "{id}" not found in {file}`.
4. **Capture the item's body** (read the full JSON object) before removing — needed for the audit trail.
5. **Remove the item** with `Edit`. Be careful with the trailing comma on the preceding item (or the leading comma on the next item) — JSON has no trailing-comma tolerance.
6. **Update `last_updated`** at the file level per the §`last_updated` field-discipline rule above. Format: `"{session-counter} {wave} close-out — curator deleted {item_id} (reason: {reason})"`. `{reason}` is one of the enum values from the Inputs table; do not append narrative.
7. **Run the same validation gate as Step 5 of Create.** Revert and report on failure.
8. **If reason is `reclassified_*`**, the curator's caller is responsible for the follow-up Create on the destination ledger. Pass the captured item body forward so provenance is preserved.
9. **Report:**

```yaml
DELETE COMPLETE

target: roadmap | backlog
file: docs/reference/product-{roadmap|backlog}.json
item_id: "{id}"
reason: cancelled | reclassified_to_roadmap | reclassified_to_backlog | superseded_by_{id}
captured_body: { ... }  # full JSON of the deleted item, for audit
last_updated_field: "{new last_updated value}"
md_render: rendered | n/a
validation: passed | failed
follow_up_create_required: true | false
```

### What Delete is NOT

- **Not a closure mechanism.** Repeating for emphasis: a roadmap item completing is `status: "done"` via Update mode. Deletion is reserved for items that should not exist on the ledger at all.
- **Not for cleanup of stale items.** Stale-but-not-cancelled items remain on the ledger until the product owner explicitly cancels them. Curator agents do not auto-prune.
- **Not for typo / data-entry corrections.** Minor field corrections use Update mode where possible; if a full rewrite is needed, the Delete is paired with a Create on the same ledger (not a reclassification).
- **Not the path for backlog → task-list pickup.** When a backlog item is picked up for implementation, use **Promote** (below), not Delete. The Promote operation captures the source → destination link with provenance; Delete loses that traceability.

---

## Promote mode — move a backlog item to the task-list

Used when a backlog item is picked up for implementation. The item is REMOVED from `docs/reference/product-backlog.json` and ADDED to `docs/reference/task-list.json` as either a new top-level Task or a new Subtask under an existing Task. The backlog stays as a queue of OUTSTANDING work; the task-list carries the canonical `done` state for traceability. (Ratified S60 per Liam's S250 clarification — backlog → task-list MOVE convention codified in ID-15.10 Phase E.)

**Invoked by:** workflow-orchestration skill at session-start (when the Orchestrator + product owner select a backlog item to pick up), or by the curator if a finding triages to `subtask` but the underlying need is already captured as a backlog item that should be promoted.

### Inputs (Promote)

| Field | Description |
|-------|-------------|
| `source_backlog_id` | The bare-digit id of the backlog item being promoted (e.g. `"67"`). |
| `destination_shape` | One of: `new_top_level_task` (creates a new Task ID-N on task-list) or `new_subtask_under_task_id` (appends a Subtask to an existing Task). |
| `destination_task_id` | Required if `destination_shape = new_subtask_under_task_id` — the parent Task's id (e.g. `"15"`). The new Subtask gets `id: N` where N = next-available integer in that Task's subtasks array. |
| `provenance.session_counter` | Session ID for `last_updated` stamps (both surfaces). |
| `provenance.source_commit_sha` | If the promotion is occurring after the underlying work has already shipped (rare but valid — e.g. ID-67 promoted post-impl during S60), include the commit SHA so the journal block captures it. Else null. |
| `provenance.promotion_rationale` | One-line `notes` explaining why this item is being picked up now. |
| `umbrella_id` | Optional. `string` (kebab-case) or `null` (default `null`) — Subtask 31.9 / T-OQ-2 RATIFIED. When non-null AND `destination_shape === 'new_top_level_task'`: triggers Step 8 above (same-commit `umbrellas.json` membership edit). When `destination_shape === 'new_subtask_under_task_id'`: ignored (subtasks inherit parent Task's umbrella membership). When `null`: no umbrella edit (Task lands as orphan per P-OQ-2 soft warning). Coexists peacefully with `capability_theme` — combined signature: `Promote(source_backlog_id, dest_task_id, [capability_theme], [umbrella_id])`. |

### Promote flow

1. **Read source.** Open `docs/reference/product-backlog.json`; locate the item with `id === source_backlog_id`. Validate the item exists; if absent, error: `"Promote source not found: id={id}. Already promoted?"` (idempotency guard).
2. **Compose destination entry.** Copy the backlog item's load-bearing fields (description, type semantics, effort_estimate, etc.) into the appropriate task-list shape:
   - If `destination_shape = new_top_level_task`: build a new top-level Task per `TaskSchema` — assign next-available top-level Task id, populate `title`, `description`, `details`, `status` (typically `pending`; or `done` if work already shipped — see provenance.source_commit_sha), `priority`, `dependencies`, `subtasks: []`, `effort_estimate`, `owner`, `session_refs`, `commit_refs`, `cross_doc_links`, `updatedAt`. **Also set `capability_theme` per the lookup below.**
   - If `destination_shape = new_subtask_under_task_id`: build a Subtask record (`id` numeric, `title`, `description`, `details`, `status`, `dependencies` — sibling-only per Q-PLANNER-2, `testStrategy`). Subtasks do NOT carry `capability_theme` — only Tasks do (the back-link is set on the parent Task, not the Subtask).

   **`capability_theme` copy-through lookup (Tasks only, per PRODUCT inv 13 d + P-OQ-4 default):**

   ```
   1. Read docs/reference/product-roadmap.json themes[].
   2. Find themes where source_backlog_id appears in theme.linked_backlog[].
   3. If exactly one match: set destination Task.capability_theme = that theme.id.
   4. If zero matches: leave capability_theme unset (null / omitted — the TaskSchema field is nullable + optional per PR-A schema).
   5. If two or more matches: leave capability_theme unset AND emit a warning in
      the Promote report's YAML: warning: "source_backlog_id={id} linked from
      {N} themes ({theme.id list}); capability_theme left unset for explicit
      curator decision".
   ```

   The lookup is best-effort — it does NOT block the Promote. A zero-match case is the normal shape for promotions that pre-date theme back-links; the curator may later set `capability_theme` via Update mode against `task-list.json` (out of this skill's scope; Update mode here covers roadmap/backlog only).

3. **Append journal block to destination.** Add `<info added on YYYY-MM-DDTHH:MM:SS.000Z>` block to the destination's `details` field referencing: source backlog id, promotion session, promotion rationale, optional commit SHA. Format:
   ```
   <info added on 2026-05-21T14:15:00.000Z>
   Promoted from backlog item id=67 during kh-prod-readiness-S60. Rationale:
   {provenance.promotion_rationale}. Underlying work shipped at commits
   {provenance.source_commit_sha}.
   </info added on 2026-05-21T14:15:00.000Z>
   ```
4. **Delete source entry.** Remove the backlog item from `items[]`. Bump backlog `last_updated` per the §`last_updated` field-discipline rule. Format: `"{session-counter} {wave} close-out — curator promoted backlog/{src-id} → task-list/{dst-id}"`.
5. **Write destination entry.** Append the new Task/Subtask. Bump task-list `last_updated` per the same field-discipline rule (single line, ≤200 chars, no diary). Bump the parent Task's `updatedAt` if `destination_shape = new_subtask_under_task_id`.
6. **Validate.** Run `BacklogSchema.parse()` against the new backlog state and `TaskSchema.parse()` against the new task-list state. If either fails, abort + restore source entry (the write order [delete first, then add] makes this rollback-safe; if add fails, source is gone — re-stage from git).
7. **Umbrella membership (optional — Step 8 above).** If `umbrella_id` is non-null AND `destination_shape === 'new_top_level_task'`, run Step 8 (umbrella membership edit). The caller MUST include the resulting `umbrellas.json` edit in the same commit as the backlog/task-list edits (PRODUCT inv 17 commit-coupling, per `docs/specs/canonical-pipeline-task-list-migration/PRODUCT.md` Inv 17).
8. **Report back.** YAML packet:
   ```yaml
   operation: promote
   source_backlog_id: "{id}"
   destination_target: task-list
   destination_path: tasks[].id={N} | tasks[].id={N}.subtasks[].id={M}
   item_title: "{title}"
   journal_block: appended
   source_deleted: true
   destination_added: true
   capability_theme:
     status: set | unset | warned_multi_match  # per the lookup above
     theme_id: "{id}" | null
     multi_match_theme_ids: ["{id1}", "{id2}"] | null  # populated only on warned_multi_match
   umbrella_membership:  # populated only when umbrella_id supplied and destination is a Task
     umbrella_id: "{id}" | null
     task_ids_updated: true | false  # true if append occurred, false if idempotent skip
   validation: passed | failed
   ```

### What Promote is NOT

- **Not for one-way Backlog cleanup.** If a backlog item should be removed without becoming a Task (e.g. it was duplicated, abandoned, or absorbed into another effort), use Delete with `reason: cancelled` or `reason: superseded_by_{other_id}`. Promote requires a real destination entry.
- **Not idempotent.** Re-promoting the same backlog id fails (the source is gone after the first promotion). This is intentional — Promote captures a unique pickup event; re-pickup of the same work is an error.
- **Not for cross-ledger reclassification.** Moving an item from backlog to roadmap (or vice versa) still uses Delete + Create. Promote is exclusively backlog → task-list.

---

## Critical conventions

1. **Provenance is mandatory.** Every entry carries at least one of: `source_task_id`, `source_commit_sha`, `session_counter`. The curator must pass the session counter even if the others are null.
2. **`.strict()` schema for roadmap.** No new fields beyond what `RoadmapItemSchema` allows. Provenance lives in `session_refs` + `commit_refs`.
3. **UK English throughout.** "colour", "organisation", "behaviour", DD/MM/YYYY dates.
4. **Forward-looking only for roadmap.** Never add a SHIPPED marker or completed-status item to the roadmap. The roadmap is for active and ready-for-implementation only (per `update-docs` skill rules and the `forward_looking_only: true` schema literal).
5. **No closure values in backlog status.** Backlog status enum is `spec_needed | needs_research | parked | ready | blocked`. When work is picked up, items are PROMOTED to task-list (where `done` lives); when cancelled or reclassified, items are Deleted. Backlog itself never carries a `done` state.
6. **Never `git commit` from this skill.** The curator returns to the orchestrator; the orchestrator's wave-close commit captures the JSON edits along with code changes.

---

## Failure modes to avoid

1. **Forgetting provenance.** Every Create entry must have at least a `session_counter`. Update / Delete operations bump `last_updated` with the session counter. Without provenance, edits can't be traced — the curator's primary value (clean ledger discipline) is lost.
2. **Adding a `metadata` field to roadmap.** The schema is `.strict()` — extra fields fail Zod validation and break the round-trip.
3. **Committing from this skill.** The orchestrator owns commit sequencing. Edit the file, report back, let the orchestrator commit. Applies to Create, Update, and Delete equally.
4. **Writing to both files for one finding.** A finding goes to exactly one of roadmap or backlog. The triage decision is binary. (Reclassifications use Delete-then-Create across files, not concurrent writes.)
5. **Forgetting `bun run roadmap:render` for roadmap edits.** Without rendering, the MD drifts from JSON and the round-trip CI test fails. Applies to Create, Update, and Delete on the roadmap.
6. **Using Delete for `done` closures.** A completed roadmap item is `status: "done"` via Update mode. Delete is reserved for cancellations and reclassifications only — see Delete mode's "What Delete is NOT" section.
7. **Overwriting `notes` on Update.** Append with a session-counter prefix to preserve audit trail.
8. **Creating a 13th theme without first checking whether two existing themes should merge per inv 8 soft cap.** Per PRODUCT inv 8, the schema does NOT block 13+ themes — the cap is enforced via `parseRoadmapWithWarnings()` warning at write-time. When the warning fires, pause and consider whether two existing themes' capability scopes overlap enough to merge (multi-month capabilities should still be coherent at the headline level). If merging is justified, propose the merge to the curator before completing the Create. Re-evaluation cadence is quarterly per RESEARCH §4.5.
9. **Forgetting to set `rank` on Create when the priority tier is otherwise empty.** Leaving `rank: null` is valid (PRODUCT inv 3 — schema does NOT enforce uniqueness or contiguity), but inserting the first ranked item in a previously-unranked tier without a numeric `rank` loses the within-tier ordering benefit. The curator's `sortBacklogItems()` helper (per TECH §3.3) sorts unranked items by id (bare-digit parsed as integer) as the tiebreaker — fine for the all-unranked case, but mixing ranked and unranked items in the same tier produces a less predictable ordering. Hint: when introducing the first ranked item in an empty tier, set `rank: 1` explicitly so future inserts have a stable anchor.

---

## What this skill is NOT

- Not the decision skill. `triage-finding` decides; this skill writes (Create) or maintains (Update, Delete).
- Not a code-edit skill. Only edits the two JSON ledgers.
- Not a commit skill. The orchestrator commits.
- Not Taskmaster-coupled. No `task-master` commands.
- Not a closure mechanism via Delete. Completed items are status-flipped via Update, not pruned.
