# CLI mechanics — write modes, validation, report blocks

Reference detail for `update-roadmap-backlog`. The SKILL.md body covers the
CRUD decision logic; read this when you need the exact CLI surface, write-time
gate behaviour, cross-branch MAX-ID mechanics, or report-block shapes.

All commands: `bun scripts/ledger-cli.ts <subcommand> …`. The full surface is
`--help`; per-command flags + schema slice are `<command> --help`. Trust those
over this doc if they ever disagree.

## Input modes (record-creating commands)

Every record-creating command (`create-theme`, `create-backlog`, `open-task`,
`promote`) accepts three input modes:

- **positional JSON** — `create-backlog '<itemJson>'`
- **`--file <path>`** — `--file -` reads stdin
- **named flags** — `--title … --description … --status … --priority … --depends 1,2 …`

Pick by payload complexity: named flags for small Creates; positional JSON or
`--file` for full-shape Creates with nested arrays/objects.

## Write-time gates (run before any byte is written)

The server substrate (ID-90.22 moved enforcement server-side; the CLI routes
mutations through the transport) runs these in order. Any failure → exit 1,
nothing written, error envelope on stderr:

1. **Schema parse** — Zod parse on the proposed post-write document. Roadmap +
   task schemas are `.strict()`; extra fields fail here. Code: `schema-error`.
2. **Record-set delta gate** ({35.16}) — the post-write id-set must equal the
   pre-write set under the intended delta (∅ / +1 / −1). Catches silent drops
   or duplicates. Code: `record-set-violation`.
3. **Budget gate** ({35.17}) — budgeted fields checked against `LEDGER_BUDGETS`
   (`lib/validation/ledger-budgets.ts`). Code: `budget-exceeded`. `--force`
   downgrades to a soft warning — the ONLY legitimate use of `--force`.
4. **Mirror regen** ({35.18}, default-on) — per-record `.md` mirrors at
   `${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/{tasks,backlog,roadmap}/`
   regenerated after every write. `--no-regen-mirrors` opts out for batch edits
   (run `bash scripts/regen-mirrors.sh` once at the end). `--regen-mirrors` is a
   deprecated no-op alias.

**Exit envelope.** Success: exit 0, JSON envelope on stdout
(`{"ok":true,"result":{…},"warnings":[…]}`). Soft warnings — including the
roadmap 13-theme soft-cap and any `parse*WithWarnings` output — arrive in
`warnings[]`; no separate parse invocation is needed. Failure: exit 1, error
envelope on stderr. Codes: `schema-error`, `walk-error`, `duplicate-id`,
`record-not-found`, `budget-exceeded`, `record-set-violation`, `unknown-theme`
(bad `--capability-theme`).

## Field budgets (`LEDGER_BUDGETS`)

Enforced at the write gate; also surfaced by `schema <recordKind>` and
`<command> --help`. `subtask.details` is intentionally unbudgeted (append-only
journal home).

| Record kind | Field | Budget |
|---|---|---|
| `task` | `description` | 1500 |
| `task` | `status_note` | 300 |
| `subtask` | `description` | 250 |
| `subtask` | `testStrategy` | 300 |
| `theme` | `description` | 1500 |
| `theme` | `notes` | 300 |
| `item` (backlog) | `title` | 80 |
| `item` (backlog) | `description` | 500 |

Authoritative discipline: `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/task-list-discipline.md`
§2/§3. Compose within budget; `--force` is not a routine escape.

## Auto-id is local-only

Omitting `--id` on `create-theme` / `create-backlog` allocates
`max(existingIds)+1` as a STRING — **local to the current branch only**. For
roadmap themes and backlog items this is usually fine. For forward Tasks it is
NOT (see cross-branch MAX-ID below). Subtask auto-ids are likewise local-only.

## Cross-branch MAX-ID discipline (forward-Task `id` only)

A new top-level Task's `id` MUST equal `MAX_ID_ACROSS_BRANCHES + 1` (PRODUCT
inv 10; `workflow-orchestration` SKILL.md §"Task ID assignment"). The CLI's
auto-id is local-only, so the caller (Orchestrator) pre-computes the
cross-branch MAX-ID and passes it via `--id` or positional JSON.

The sweep targets the **docs-site** repo (the ledgers live there, not in the
code repo):

```bash
git -C "${KH_PRIVATE_DOCS_DIR}" show origin/{branch}:src/content/docs/ledgers/task-list.json
```

Run it across the relevant branches, take the max `tasks[].id`, add 1.

## Subcommand → (record-kind, mutation) map

One subcommand per (record-kind, mutation-type) pair — no aggregate "edit"
surface. Every mutating command is minimal-diff (scoped) by default
(cmux-concurrency-safe, ratified default #4). Reads:

| Read | Command |
|---|---|
| Full record dump | `show <ledger> <id>` (ledger: `task\|roadmap\|backlog`) |
| Single field | `get <ledger> <id> <field>` (omit field = full dump) |
| Schema + budgets | `schema [ledger\|recordKind]` |

Creates:

| Target | Command |
|---|---|
| Roadmap theme | `create-theme` |
| Backlog item | `create-backlog` |
| New top-level Task | `open-task` |
| Backlog → Task (atomic) | `promote` |

Updates (single field per invocation):

| Target | Command | Form |
|---|---|---|
| Roadmap theme — any field | `update-roadmap` | `update-roadmap <themeId> <field> <value>` |
| Backlog item — any field | `update-backlog` | `update-backlog <itemId> <field> <value>` |
| Task — any field except status | `update-task` | `update-task <taskId> <field> <value>` |
| Task — status only | `flip-task` | `flip-task <taskId> <status>` |
| Subtask — any field except status | `update-subtask` | `update-subtask <taskId.subId> <field> <value>` |
| Subtask — status only | `flip-subtask` | `flip-subtask <taskId.subId> <status>` |
| Task/Subtask `details` journal | `append-journal` | `append-journal <taskId.subId> <text>` (bare `<taskId>` for task-level) |

Deletes:

| Target | Command |
|---|---|
| Backlog item | `delete-backlog <itemId>` |
| Subtask under a Task | `delete-subtask <taskId.subId>` |

There is NO `delete-task` and NO `delete-roadmap`. Dotted `<taskId.subId>` is
the canonical subtask id form (legacy space-separated `<taskId> <subId>` still
accepted). Verify the exact form per command via `<command> --help`.

Bulk: `add-subtask <taskId> <subtaskJson>` (single) and `add-subtasks <taskId>
--file <json|->` (JSON array, one scoped multi-splice, per-record budget
enforced atomically — any over-budget record rejects the whole batch).

## Diff-mode flags

- **minimal-diff (scoped)** is the GLOBAL DEFAULT — single-record edits are
  cmux-safe with no flag. `--scoped` is a DEPRECATED no-op alias (changes
  nothing).
- **`--whole-file`** opts OUT into a deliberate whole-file Zod-canonical
  re-serialise (full-file diff; collides with sibling cmux terminals). Reserve
  for an intentional whole-file rewrite.

## Notes-append semantics

`update-backlog <id> notes <value>` and `update-roadmap <id> notes <value>`
**overwrite** by default. Pass `--append` to concatenate the incoming value onto
the existing notes (newline-joined) — no manual read-concat-write. `--append` is
notes-only (rejected on other fields).

## Report blocks (return to the curator)

### Create — `WRITE COMPLETE`

```yaml
WRITE COMPLETE
target: roadmap | backlog | task-list
file: ${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/<ledger>.json
new_item_id: "{id}"
section_id_or_track: "{section or track}"
mirror_regen: ran | skipped (--no-regen-mirrors)
validation: passed | failed
provenance:
  source_task_id: "{value or null}"
  source_commit_sha: "{value or null}"
  session_counter: "{value}"
umbrella_membership:   # only when umbrella_id supplied and destination is a Task
  umbrella_id: "{id}" | null
  task_ids_updated: true | false
warnings: [...]        # mirror the CLI's warnings[] verbatim
```

### Update — `UPDATE COMPLETE`

```yaml
UPDATE COMPLETE
target: roadmap | backlog | task | subtask
file: ${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/<ledger>.json
item_id: "{id}"
fields_changed:
  status: "{old} → {new}" | unchanged
  priority: "{old} → {new}" | unchanged
  notes: "overwritten" | "appended" | unchanged
  rank: "{old} → {new}" | unchanged          # backlog only
  time_horizon: "{old} → {new}" | unchanged   # roadmap only
auto_shifted:                                  # backlog rank Update only; null if no collisions
  tier: "{priority}"
  count: {N}
  items: ["{id1}", "{id2}"]
mirror_regen: ran | skipped
validation: passed | failed
warnings: [...]
```

### Delete — `DELETE COMPLETE`

```yaml
DELETE COMPLETE
target: backlog
file: ${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/product-backlog.json
item_id: "{id}"
reason: cancelled | reclassified_to_roadmap | superseded_by_{id}
captured_body: { ... }   # full JSON of the deleted item, for audit
mirror_regen: ran | skipped
validation: passed | failed
follow_up_create_required: true | false
```

### Promote — exit envelope + report

Success envelope on stdout:

```json
{
  "ok": true,
  "result": {
    "source_backlog_id": "...",
    "destination_id": "...",
    "destination_path": "tasks[].id={N} | tasks[].id={N}.subtasks[].id={M}",
    "journal_block_timestamp": "2026-05-28T14:15:00.000Z",
    "capability_theme": "...",
    "umbrella_id": "..."
  },
  "warnings": [...]
}
```

Report packet:

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
  status: set | unset           # set when --capability-theme passed
  theme_id: "{id}" | null
umbrella_membership:            # only when umbrella_id supplied and destination is a Task
  umbrella_id: "{id}" | null
  task_ids_updated: true | false
mirror_regen: ran (both surfaces)
validation: passed | failed
warnings: [...]
```

## Rank auto-shift algorithm (backlog `rank` Update)

The CLI does NOT encapsulate auto-shift — it is curator-side work (P-OQ-3
default):

1. Read backlog `items[]` via `get backlog <id>` (or full read if needed).
2. Filter to the target tier: `item.priority == target.priority && item.id != target.id`.
3. Find collisions: `item.rank !== null && item.rank >= field_edits.rank`.
4. For each collision (preserving insertion order for determinism), emit
   `update-backlog <itemId> rank <rank+1>`.
5. Apply the target rank last: `update-backlog <target-id> rank <new-rank>`.
6. Surface `auto_shifted: { tier, count: N, items: [...] }` in the report.

Items with `rank: null` in the same tier are NOT touched (no ordering signal).

## Further references

- CLI architecture / primitive provenance: `lib/ledger/README.md`.
- Two-phase Promote semantics: `${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/id-35-ledger-cli/RESEARCH.md` §3.
- Schemas: `lib/validation/roadmap-schema.ts`, `lib/validation/backlog-schema.ts`,
  `lib/validation/task-list-schema.ts` (all Zod; roadmap + task `.strict()`).
