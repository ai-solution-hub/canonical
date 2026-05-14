---
name: update-roadmap-backlog
description:
  Promote a triaged finding into the roadmap or backlog by editing the
  authoritative JSON file, attaching provenance (source-task-id, source-commit-sha,
  or session counter), and regenerating the rendered MD if a render pipeline exists.
  Invoked by the workflow-curator agent after triage-finding returns a roadmap or
  backlog decision. Knows about the current KH label-reversal between roadmap and
  backlog (target semantics drive the write; legacy filenames are reconciled
  during the migration WP). Triggered as the write half of curator workflow.
allowed-tools: Read, Edit, Bash, Grep
---

# update-roadmap-backlog — Write a Triaged Finding to the Ledger

Writes a finding decision (output of `triage-finding`) into the correct JSON ledger with provenance, then regenerates the rendered MD via the project's render pipeline if available. This skill is the **write** half of the curator's job — invoked by the workflow-curator agent only when triage decision is `roadmap` or `backlog`.

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

**Critical:** KH currently has roadmap and backlog labelled the wrong way around (confirmed Session 46). The intended semantics:

- `target: "roadmap"` = **strategic / cross-cutting / multi-month** work. This is the strategic register.
- `target: "backlog"` = **tactical / single-feature / weeks-scope** work. This is the tactical register.

Today's filenames follow the *legacy* convention. Until the migration WP corrects them, follow this mapping:

| target (semantics) | file to edit | rationale |
|--------------------|--------------|-----------|
| `roadmap` (strategic) | `docs/reference/product-roadmap.json` | matches current legacy naming |
| `backlog` (tactical) | `docs/reference/product-backlog.json` | matches current legacy naming |

The mapping is 1:1 by coincidence with legacy naming for *this version* of the codebase. **When the migration WP runs and swaps the file names**, this skill must be updated. Until then, write to the file named after the target.

If the triage payload included `label_reversal_flag`, propagate it to the curator's report — do not silently swap files.

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
  "status": "needs_spec | needs_research | parked | ready | blocked",
  "effort_estimate": "string | null",
  "priority": "high | medium | low",
  "track": "string",
  "depends_on": ["..."],
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
| `id` | Allocate next free ID. Inspect existing IDs in the same `track` first; follow the convention (`C{n}-{shortcode}` pattern, e.g. `C1-T3-Settings-3`, or a new pattern if no convention applies). |
| `description` | One-sentence description of the finding. UK English. |
| `type` | From triage payload `backlog_slot.type`. |
| `status` | From triage payload `backlog_slot.status`. Default `needs_spec`. |
| `effort_estimate` | From triage payload, e.g. `"3-5h"` or `null` if unknown. |
| `priority` | From triage payload `backlog_slot.priority`. Default `medium`. |
| `track` | From triage payload `backlog_slot.track`. |
| `depends_on` | [] unless triage identifies dependencies. |
| `surfaced` | Provenance string. Format: `"{source-agent} during {session-counter} ({source-task-id|source-commit-sha})"`. E.g. `"workflow-checker during kh-prod-readiness-s47 (WP1.2 / a1b2c3d)"`. |
| `notes` | Free-text. Include the finding's evidence reference (`file:line`) if available. |

**Provenance lives in `surfaced`** for the backlog — that's the existing convention.

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
label_reversal_flag: "{flag or null}"
```

---

## Critical conventions

1. **Provenance is mandatory.** Every entry carries at least one of: `source_task_id`, `source_commit_sha`, `session_counter`. The curator must pass the session counter even if the others are null.
2. **`.strict()` schema for roadmap.** No new fields beyond what `RoadmapItemSchema` allows. Provenance lives in `session_refs` + `commit_refs`.
3. **UK English throughout.** "colour", "organisation", "behaviour", DD/MM/YYYY dates.
4. **Forward-looking only for roadmap.** Never add a SHIPPED marker or completed-status item to the roadmap. The roadmap is for active and ready-for-implementation only (per `update-docs` skill rules and the `forward_looking_only: true` schema literal).
5. **No closure values in backlog status.** Backlog status enum is `needs_spec | needs_research | parked | ready | blocked`. Closed items are removed entirely, not status-flipped.
6. **Never `git commit` from this skill.** The curator returns to the orchestrator; the orchestrator's wave-close commit captures the JSON edits along with code changes.

---

## Label-reversal note for future migration

When the separate label-reversal migration WP runs, the files will be renamed (or swapped contents) so:

- "Roadmap" file = strategic register.
- "Backlog" file = tactical register.

This skill currently maps `target` → file 1:1 with legacy naming. **The migration must update both:**
- The mapping table in Step 1 above.
- The example IDs and conventions in Steps 3 / 4 / 6.

The label-reversal flag from `triage-finding` is the signal: if the curator's report contains `FLAG: target/legacy-label mismatch`, the migration has not yet run; if it does not, the migration has completed and this skill is current.

---

## Failure modes to avoid

1. **Forgetting provenance.** Every entry must have at least a `session_counter`. Without provenance, the entry can't be traced — the curator's primary value (clean ledger discipline) is lost.
2. **Adding a `metadata` field to roadmap.** The schema is `.strict()` — extra fields fail Zod validation and break the round-trip.
3. **Committing from this skill.** The orchestrator owns commit sequencing. Edit the file, report back, let the orchestrator commit.
4. **Writing to both files for one finding.** A finding goes to exactly one of roadmap or backlog. The triage decision is binary.
5. **Auto-correcting the label reversal.** The reversal correction is a separate WP. This skill follows current naming; flagging is informational only.
6. **Forgetting `bun run roadmap:render` for roadmap edits.** Without rendering, the MD drifts from JSON and the round-trip CI test fails.

---

## What this skill is NOT

- Not the decision skill. `triage-finding` decides; this skill writes.
- Not a code-edit skill. Only edits the two JSON ledgers.
- Not a commit skill. The orchestrator commits.
- Not Taskmaster-coupled. No `task-master` commands.
