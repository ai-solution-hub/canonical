---
name: update-roadmap-backlog
description:
  Full-CRUD maintenance of the roadmap and backlog JSON ledgers — create new items
  from a triaged finding (with provenance: source ID-N, source-commit-sha, or
  session counter), update existing items' status / priority / notes fields
  (covers status transitions like pending → in-progress → done), or delete items
  (strictly cancelled / reclassified items — never done closures, which retain
  in-place per s48-feedback B6). Regenerates the rendered MD if a render pipeline
  exists. Invoked by the workflow-curator agent (Create after triage-finding
  returns roadmap/backlog) or directly by the workflow-orchestration skill
  (Update for status transitions; Delete for cancellations). Knows about the
  target semantics drive write routing.
allowed-tools: Read, Edit, Bash, Grep
---

# update-roadmap-backlog — CRUD Maintenance of the Ledger

Maintains the roadmap and backlog JSON ledgers across the full Create / Read / Update / Delete lifecycle, regenerating the rendered MD via the project's render pipeline if available.

**Operation modes:**

| Mode | Invoked by | Purpose |
|------|------------|---------|
| **Create** | workflow-curator (after `triage-finding` returns `roadmap` or `backlog`) | Append a new item with provenance. Default mode. |
| **Update** | workflow-orchestration skill (status transitions); curator (priority/notes edits) | Edit `status`, `priority`, or `notes` on an existing item. Canonical use case: S52 WP2 ID-11-14 pattern (status moves from `pending` → `in-progress` → `done`). |
| **Delete** | workflow-orchestration skill (cancellations); curator (reclassifications) | Remove an item. **Scope: `cancelled` items and reclassifications only.** Never used for `done` closures — those retain in-place per s48-feedback B6 / S51 close-out remediation Fix A. |

The Create path (Steps 1–7 below) is the original append-only flow and remains the default. Update and Delete sections at the end of this skill define their own invocation flows; both share the target → file mapping (Step 1) and the validation gate (Step 5).

---

## Inputs

The curator invokes this skill with:

| Field | Description |
|-------|-------------|
| `target` | `roadmap` or `backlog` (the **target semantics**, not the current legacy filename) |
| `finding_detail` | The finding from the source agent, summarised for ledger storage |
| `provenance.source_task_id` | Workpackage ID (e.g. `WP1.2`) or null |
| `provenance.source_commit_sha` | Short SHA from the source commit, or null |
| `provenance.session_counter` | Session ID (e.g. `kh-prod-readiness-s47`) |
| `triage_payload` | The full `triage-finding` output (carries section / track / type / priority) |

---

## Step 1: Resolve target → file

| Target semantics | File |
|---|---|
| Strategic / cross-cutting / multi-month | `docs/reference/product-roadmap.json` |
| Tactical / single-feature / weeks-scope OR parked / deferred / pre-work | `docs/reference/product-backlog.json` |

The mapping is 1:1 by `document_purpose`. The skill enforces target-semantic routing; the curator never auto-corrects the destination.

---

## Step 2: Read the current file

Read the target file with the `Read` tool. Validate the JSON is well-formed.

Roadmap schema reference: `lib/validation/roadmap-schema.ts` (Zod, `.strict()`).
Backlog schema: documented inline in `docs/reference/product-backlog.json` `items[*]` shape:

```json
{
  "id": "string",
  "description": "string",
  "type": "feature | research | infra | tech-debt | ...",
  "status": "spec_needed | needs_research | parked | ready | blocked",
  "effort_estimate": "string | null",
  "priority": "high | medium | low",
  "track": "string",
  "dependencies": ["..."],
  "surfaced": "string",
  "notes": "string | null"
}
```

---

## Step 3: Compose the new entry

### For roadmap

Match the `RoadmapItemSchema` in `lib/validation/roadmap-schema.ts`. Required fields:

| Field | How to populate |
|-------|-----------------|
| `id` | Allocate next free ID under the target section (e.g. if section §9 has items 9.1–9.14, new ID is `9.15`). Inspect existing IDs first. |
| `section_id` | Triage payload's `roadmap_target_section` (without the `§` prefix; e.g. `"9"`). |
| `title` | One-line title from the finding. UK English. |
| `phase_label` | null unless the section uses phase labels. |
| `description` | Multi-sentence: what the finding is, why it matters, link to evidence if any. |
| `effort_estimate` | From triage payload, normalised to project convention (e.g. `"1-2 sessions"`, `"~3-5h"`). |
| `priority` | null unless the section's `table_columns` includes priority. |
| `priority_note` | null unless residual freetext needed. |
| `severity` | null. |
| `status` | `"pending"` by default. |
| `status_note` | null. |
| `owner` | `"Engineering"` by default, unless triage payload indicates otherwise. |
| `depends_on` | [] unless triage identifies dependencies. |
| `blocks` | []. |
| `coordinates_with` | []. |
| `cross_doc_links` | If the finding cites a spec or doc, populate with `{ path, anchor, raw }`. |
| `session_refs` | `[provenance.session_counter]` — at minimum. Add `provenance.source_task_id` if available. |
| `commit_refs` | `[provenance.source_commit_sha]` if available, else []. |

**Provenance lives in `session_refs` + `commit_refs`** because the schema is `.strict()` and does not accept a separate `metadata.source` field. The existing convention in the file is for `last_updated` and item-level `session_refs` / `commit_refs` to carry this tracing data.

### For backlog

Required fields per the schema implicit in `product-backlog.json`:

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

**Provenance lives in `session_refs` + `commit_refs`** for backlog items, populated at creation time from the curator's current session context.

---

## Step 4: Append the entry

### For roadmap

Use `Edit` to insert the new item into the target section's `items` array. Maintain JSON formatting:

- Indent matches surrounding items (2-space).
- Trailing commas: no (JSON, not JSON5).
- Field order: match the schema field order seen in other items in the same section.

After the entry append, update the roadmap-level `last_updated` field. Format: `"{session-counter} {context} — curator added {new-id}"`.

### For backlog

Use `Edit` to insert the new item into `items[]`. Same JSON-formatting rules. Update the `last_updated` field similarly.

---

## Step 5: Validate

After the edit, re-read the file and confirm the JSON parses. Run:

```bash
# Roadmap: validate via the schema (round-trip is the strongest test)
bun run roadmap:render
```

If `bun run roadmap:render` exits non-zero, the JSON has drifted from the schema — revert your edit and report the validation error to the curator. The roadmap render is the canonical guard for `product-roadmap.json` (round-trip CI guard at `__tests__/docs/roadmap-roundtrip.test.ts`).

For the backlog there is **no render pipeline** today (the file is read directly). Validation is JSON well-formedness only — confirm:

```bash
bun -e "JSON.parse(require('fs').readFileSync('docs/reference/product-backlog.json', 'utf8')); console.log('OK')"
```

If the JSON fails to parse, revert your edit and report.

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

target: roadmap | backlog
file: docs/reference/product-{roadmap|backlog}.json
new_item_id: "{id}"
section_id_or_track: "{section or track}"
last_updated_field: "{new last_updated value}"
md_render: rendered | n/a
validation: passed | failed
provenance:
  source_task_id: "{value or null}"
  source_commit_sha: "{value or null}"
  session_counter: "{value}"
```

---

## Update mode — edit existing item fields

Used to transition an existing item's `status`, `priority`, or `notes` field. **Canonical use case:** S52 WP2 ID-11-14 status transitions (e.g. roadmap item moves from `pending` to `in-progress` when work starts, then to `done` when the wave-close confirms acceptance). Other allowed edits: `priority` bump in response to new evidence; `notes` append to record a decision or block.

### Inputs (Update)

| Field | Description |
|-------|-------------|
| `target` | `roadmap` or `backlog` |
| `item_id` | The ID of the existing item to edit (e.g. `"ID-11"`, `"9.15"`, `"28"`). |
| `field_edits` | Map of `{ status?, priority?, notes? }`. Only allowed fields are mutable via this skill. |
| `provenance.session_counter` | Session ID for the `last_updated` stamp. |
| `provenance.source_commit_sha` | Optional, appended to `commit_refs` (roadmap) or `notes` (backlog) if supplied. |

### Update flow

1. **Resolve target → file** (same mapping table as Step 1 of Create).
2. **Read the file** and locate the item by `id`. If the ID does not exist, abort and report `UPDATE FAILED: item_id "{id}" not found in {file}`.
3. **Validate the proposed edits:**
   - For `status`: must be a value in the schema enum. Roadmap status enum (per `RoadmapItemSchema`): `pending | in-progress | done | blocked` (verify the live enum at edit time — schema is `.strict()`). Backlog status enum: `spec_needed | needs_research | parked | ready | blocked` (no `done` — done items follow Delete-or-retain rules below).
   - For `priority`: must be `high | medium | low` (or null for roadmap sections that don't carry priority).
   - For `notes`: free text. **Do not overwrite existing notes** — append with a session-counter prefix (e.g. `"[s52] Status moved to in-progress because …"`).
4. **Apply the edit** with `Edit` (one targeted `old_string` / `new_string` pair per field). Preserve surrounding fields, indentation, and trailing-comma rules (JSON, not JSON5).
5. **Update `last_updated`** at the file level. Format: `"{session-counter} — curator updated {item_id} ({summary})"`.
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
last_updated_field: "{new last_updated value}"
md_render: rendered | n/a
validation: passed | failed
```

### What Update is NOT

- **Not for `done` closures on the backlog.** Backlog `status` enum has no `done` value. A finished backlog item is either removed (if it was reclassified or cancelled — see Delete) or retained in `ready` until the migration WP introduces a closure convention.
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
6. **Update `last_updated`** at the file level. Format: `"{session-counter} — curator deleted {item_id} (reason: {reason})"`.
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

---

## Critical conventions

1. **Provenance is mandatory.** Every entry carries at least one of: `source_task_id`, `source_commit_sha`, `session_counter`. The curator must pass the session counter even if the others are null.
2. **`.strict()` schema for roadmap.** No new fields beyond what `RoadmapItemSchema` allows. Provenance lives in `session_refs` + `commit_refs`.
3. **UK English throughout.** "colour", "organisation", "behaviour", DD/MM/YYYY dates.
4. **Forward-looking only for roadmap.** Never add a SHIPPED marker or completed-status item to the roadmap. The roadmap is for active and ready-for-implementation only (per `update-docs` skill rules and the `forward_looking_only: true` schema literal).
5. **No closure values in backlog status.** Backlog status enum is `spec_needed | needs_research | parked | ready | blocked`. Closed items are removed entirely, not status-flipped.
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

---

## What this skill is NOT

- Not the decision skill. `triage-finding` decides; this skill writes (Create) or maintains (Update, Delete).
- Not a code-edit skill. Only edits the two JSON ledgers.
- Not a commit skill. The orchestrator commits.
- Not Taskmaster-coupled. No `task-master` commands.
- Not a closure mechanism via Delete. Completed items are status-flipped via Update, not pruned.
