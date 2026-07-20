# Create-payload field schemas

Reference detail for `update-ledgers` Create mode. The SKILL.md body covers when to Create
and which command to call; read this when composing a Create payload and you need the
per-field source + CLI flag.

Field budgets and the write-time gate are in `cli-mechanics.md`. Live-truth source for any
field type/budget: `bun scripts/ledger-cli.ts schema <recordKind>` — trust it over this
doc.

## Provenance is mandatory (all three record kinds)

Every Create carries provenance in `session_refs` + `commit_refs` (+ `cross_doc_links` for
tasks). The task schema is `.strict()` and does NOT accept a separate `metadata.source`
field. At minimum pass `session_refs: [session_counter]`.

## Backlog item — `BacklogItemSchema`

| Field             | Source                                                                                                                                        | CLI flag                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `id`              | Auto-id (`max+1` as STRING) or explicit `--id`.                                                                                               | `--id` (or auto)               |
| `title`           | Short noun-phrase heading. **Budget ≤80.**                                                                                                    | `--title`                      |
| `description`     | One-sentence summary. UK English. **Budget ≤500.**                                                                                            | `--description`                |
| `type`            | `triage_payload.backlog_slot.type`. Enum `feature\|bug\|research\|tech_debt\|infrastructure\|documentation\|testing\|ux`.                     | `--type` (or positional JSON)  |
| `status`          | Default `spec_needed`. Enum `spec_needed\|needs_research\|parked\|ready\|blocked` (NO `done`).                                                | `--status`                     |
| `effort_estimate` | E.g. `"3-5h"` or `null`.                                                                                                                      | positional JSON                |
| `priority`        | Default `medium`. Shared `Priority` enum.                                                                                                     | `--priority`                   |
| `track`           | From triage payload.                                                                                                                          | `--track` (or positional JSON) |
| `dependencies`    | `[]` unless triage identifies any.                                                                                                            | positional JSON                |
| `session_refs`    | `[session_counter]` (+ `source_task_id` if present).                                                                                          | positional JSON                |
| `commit_refs`     | `[source_commit_sha]` or `[]`.                                                                                                                | positional JSON                |
| `cross_doc_links` | `DocLink[]` if the finding cites a spec, else `[]`.                                                                                           | positional JSON                |
| `notes`           | Include the finding's evidence reference (`file:line`) if available.                                                                          | `--notes`                      |
| `rank`            | Default `null`. Auto-id does NOT auto-rank — pass `--rank N` explicitly when introducing the first ranked item in an otherwise-unranked tier. | `--rank`                       |

## New top-level Task — `TaskSchema` (`.strict()`)

For forward-Task creation via `open-task`. **`open-task` auto-fills the optional
nullable/array fields** (`owner`, `priority_note`, `status_note` → null;
`cross_doc_links`/`session_refs`/`commit_refs` → []) and auto-stamps `updatedAt` — supply
only the meaningful fields below plus any provenance you want recorded.

| Field             | Source                                                                                                                                                              | CLI flag                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `id`              | **MUST = cross-branch `MAX_ID + 1`** (PRODUCT inv 10). Auto-id is local-only — pre-compute via the docs-site sweep (see `cli-mechanics.md` §"Cross-branch MAX-ID"). | `--id`                               |
| `title`           | Human-readable. UK English.                                                                                                                                         | `--title`                            |
| `description`     | One-paragraph overview. **Budget ≤1500.**                                                                                                                           | `--description`                      |
| `status`          | Default `"pending"`; `"done"` only for retrospective Tasks.                                                                                                         | `--status`                           |
| `priority`        | Shared `Priority` enum (`must\|should\|could\|future\|high\|medium\|low\|trigger`).                                                                                 | `--priority`                         |
| `dependencies`    | Sibling Task ids (strings).                                                                                                                                         | `--depends 1,2` (or positional JSON) |
| `subtasks`        | `[]` for forward Tasks; spec-chain Subtasks ({N.1–N.4}) populated separately via `spec-driven-implementation`.                                                      | positional JSON                      |
| `effort_estimate` | Auto-filled to `null` if omitted.                                                                                                                                   | positional JSON                      |
| `cross_doc_links` | Spec-substrate links; auto-filled to `[]`.                                                                                                                          | positional JSON                      |
| `session_refs`    | `[session_counter]`; auto-filled to `[]`.                                                                                                                           | positional JSON                      |
| `commit_refs`     | `[source_commit_sha]` or auto-filled `[]`.                                                                                                                          | positional JSON                      |
