# Create-payload field schemas

Reference detail for `update-roadmap-backlog` Create mode. The SKILL.md body
covers when to Create and which command to call; read this when composing a
Create payload and you need the per-field source + CLI flag.

Field budgets and the write-time gate are in `references/cli-mechanics.md`.
Live-truth source for any field type/budget: `bun scripts/ledger-cli.ts schema
<recordKind>` — trust it over this doc.

## Provenance is mandatory (all three record kinds)

Every Create carries provenance in `session_refs` + `commit_refs` (+
`cross_doc_links` for tasks). The roadmap and task schemas are `.strict()` and
do NOT accept a separate `metadata.source` field. At minimum pass
`session_refs: [session_counter]`.

## Roadmap theme — `RoadmapThemeSchema` (Shape A)

Shape A (PRODUCT inv 6-9; TECH §3.1/§4.2): the roadmap is a flat list of
**themes** (multi-month capability areas), NOT typed-item sections. The
pre-Shape-A field set (`section_id`, `phase_label`, `severity`, `priority`,
`status_note`, `owner`, `depends_on`, `blocks`, `coordinates_with`) is dropped
wholesale.

| Field | Source | CLI flag |
|---|---|---|
| `id` | Next free bare-digit id across `themes[]` (`BARE_ID_REGEX`). Auto-id is local-only. | `--id` (or auto) |
| `title` | `triage_payload.roadmap_proposed_theme.title`. UK English. | `--title` |
| `description` | Multi-paragraph Markdown — why the capability matters, outcome shape. | `--description` |
| `time_horizon` | `triage_payload…time_horizon`. Default `"later"` (PRODUCT inv 13a). Enum `now\|next\|later`. | positional JSON |
| `status` | Default `"pending"` (P-OQ-1). Enum `pending\|in_progress\|done`. | `--status` |
| `linked_tasks` | `triage_payload…initial_linked_tasks[]` or `[]`. | positional JSON |
| `linked_backlog` | `triage_payload…initial_linked_backlog[]` or `[]`. | positional JSON |
| `session_refs` | `[session_counter]` (+ `source_task_id` if present). | positional JSON |
| `commit_refs` | `[source_commit_sha]` or `[]`. | positional JSON |
| `cross_doc_links` | `[{ path, anchor, raw }]` if the finding cites a spec, else `[]`. | positional JSON |
| `notes` | Free text; default `null`. | `--notes` |

**Soft-cap (PRODUCT inv 8):** before appending, count `themes[]`. A 13th theme
does not hard-block, but the write surfaces a soft-cap warning in `warnings[]`.
When it fires, consider merging two overlapping themes. Re-evaluation cadence is
quarterly (RESEARCH §4.5).

## Backlog item — `BacklogItemSchema`

| Field | Source | CLI flag |
|---|---|---|
| `id` | Auto-id (`max+1` as STRING) or explicit `--id`. | `--id` (or auto) |
| `title` | Short noun-phrase heading. **Budget ≤80.** | `--title` |
| `description` | One-sentence summary. UK English. **Budget ≤500.** | `--description` |
| `type` | `triage_payload.backlog_slot.type`. Enum `feature\|bug\|research\|tech_debt\|infrastructure\|documentation\|testing\|ux`. | `--type` (or positional JSON) |
| `status` | Default `spec_needed`. Enum `spec_needed\|needs_research\|parked\|ready\|blocked` (NO `done`). | `--status` |
| `effort_estimate` | E.g. `"3-5h"` or `null`. | positional JSON |
| `priority` | Default `medium`. Shared `Priority` enum. | `--priority` |
| `track` | From triage payload. | `--track` (or positional JSON) |
| `dependencies` | `[]` unless triage identifies any. | positional JSON |
| `session_refs` | `[session_counter]` (+ `source_task_id` if present). | positional JSON |
| `commit_refs` | `[source_commit_sha]` or `[]`. | positional JSON |
| `cross_doc_links` | `DocLink[]` if the finding cites a spec, else `[]`. | positional JSON |
| `notes` | Include the finding's evidence reference (`file:line`) if available. | `--notes` |
| `rank` | Default `null`. Auto-id does NOT auto-rank — pass `--rank N` explicitly when introducing the first ranked item in an otherwise-unranked tier. | `--rank` |

## New top-level Task — `TaskSchema` (`.strict()`)

For forward-Task creation via `open-task`. **`open-task` auto-fills the optional
nullable/array fields** (`owner`, `priority_note`, `status_note` → null;
`cross_doc_links`/`session_refs`/`commit_refs` → []) and auto-stamps
`updatedAt` — supply only the meaningful fields below plus any provenance you
want recorded.

| Field | Source | CLI flag |
|---|---|---|
| `id` | **MUST = cross-branch `MAX_ID + 1`** (PRODUCT inv 10). Auto-id is local-only — pre-compute via the docs-site sweep (see `references/cli-mechanics.md` §"Cross-branch MAX-ID"). | `--id` |
| `title` | Human-readable. UK English. | `--title` |
| `description` | One-paragraph overview. **Budget ≤1500.** | `--description` |
| `status` | Default `"pending"`; `"done"` only for retrospective Tasks. | `--status` |
| `priority` | Shared `Priority` enum (`must\|should\|could\|future\|high\|medium\|low\|trigger`). | `--priority` |
| `dependencies` | Sibling Task ids (strings). | `--depends 1,2` (or positional JSON) |
| `subtasks` | `[]` for forward Tasks; spec-chain Subtasks ({N.1–N.4}) populated separately via `spec-driven-implementation`. | positional JSON |
| `effort_estimate` | Auto-filled to `null` if omitted. | positional JSON |
| `cross_doc_links` | Spec-substrate links; auto-filled to `[]`. | positional JSON |
| `session_refs` | `[session_counter]`; auto-filled to `[]`. | positional JSON |
| `commit_refs` | `[source_commit_sha]` or auto-filled `[]`. | positional JSON |
| `capability_theme` | Optional. Roadmap theme id back-link (ID-30 PR-A). Distinct from `umbrella_id`. | positional JSON |

`capability_theme` (on the Task, points at a roadmap theme) and `umbrella_id`
(drives the `umbrellas.json` membership append) are orthogonal — both may be
supplied in the same Create.
