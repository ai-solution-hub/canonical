---
name: update-ledgers
description:
  Full-CRUD + Promote maintenance of the initiatives and backlog JSON ledgers — create
  new items from a triaged finding (with provenance: source ID-N, source-commit-sha,
  or session counter), update existing items' status / priority / notes / rank fields
  (covers status transitions like pending → in-progress → done), delete cancelled backlog items (never done closures, which retain in-place), or promote
  a backlog item atomically to task-list.json as a new Task or Subtask. All writes
  route through `bun scripts/ledger-cli.ts` — never raw `Edit` on the JSON ledgers.
  Invoked by the workflow-curator agent (Create after triage-finding returns
  project/backlog) or directly by the workflow-orchestration skill (Update for status
  transitions; Delete for cancellations; Promote when picking up a backlog item).
allowed-tools: Read, Bash, Grep
---

# update-ledgers — CRUD Maintenance of the Ledgers

Maintains the initiatives, backlog, and task-list JSON ledgers across the full Create /
Read / Update / Delete / Promote lifecycle.

**All writes route through `bun scripts/ledger-cli.ts` — never `Edit` on the ledgers.**
The CLI is the operator-facing mutation surface; enforcement (serialisation, write-time
gates, mirror regen) lives server-side in the task-view patch-server substrate.

The ledgers live in the private docs-site, NOT the code repo:
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/`. The CLI resolves this path by default
(via `KH_PRIVATE_DOCS_DIR`). **Never wholesale-`Read` the JSON** (`task-list.json` is
multi-MB) — use `show` / `get` slice reads.

```bash
bun scripts/ledger-cli.ts show task <id>            # one task record (size-shaped ≤48KB; --full for verbatim)
bun scripts/ledger-cli.ts get task <id> <field>     # one field (e.g. status_note)
bun scripts/ledger-cli.ts get task <id>.<subId>     # one subtask directly (no whole-task fetch)
```

The CLI write boundary enforces, in order: schema parse, the record-set delta gate
(∅/+1/−1), the budget gate, then default-on mirror regen — all **before** any byte is
written. Detail (gates, error codes, exit envelope, budgets): **read
`references/cli-mechanics.md`**.

## Operation modes

| Mode        | Invoked by                                                                                                  | CLI subcommand(s)                                                                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Create**  | workflow-curator (after `triage-finding` returns `task-list`, `backlog`, or **project**)                    | `open-task`, `create-backlog`, `create-project`                                                                                                                                                              |
| **Update**  | workflow-orchestration (status transitions); curator (priority/notes/rank edits)                            | `update-task`, `update-subtask`, `flip-task`, `flip-subtask`, `append-journal`, `update-backlog`, `update-project`, `link-tasks`/`unlink-tasks`, `link-backlog`/`unlink-backlog`, `move-task`/`move-backlog` |
| **Delete**  | workflow-orchestration (cancellations)                                                                      | `delete-backlog`, `delete-project`                                                                                                                                                                           |
| **Promote** | workflow-orchestration (picking up a backlog item — see workflow-orchestration §"Backlog pickup → Promote") | `promote` (atomic cross-ledger)                                                                                                                                                                              |

Create is the default mode (Steps 1–6 below). Update, Delete, and Promote have their own
sections; all share the target → file mapping (Step 1) and the CLI write boundary.

**Promote is the canonical backlog → task-list path** — never a manual Delete + Edit. It
enforces atomicity, idempotency, journal-block auto-append, and two-surface validation.

---

## Inputs (Create)

| Field                          | Description                                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `target`                       | `task-list`, `backlog`, or **project** (the **target semantics**, not a filename) — `task-list` writes a new top-level Task via `open-task`. |
| `finding_detail`               | The finding from the source agent, summarised for ledger storage.                                                                            |
| `provenance.source_task_id`    | Workpackage ID (e.g. `WP1.2`) or null.                                                                                                       |
| `provenance.source_commit_sha` | Short SHA from the source commit, or null.                                                                                                   |
| `provenance.session_counter`   | Session ID.                                                                                                                                  |
| `triage_payload`               | The full `triage-finding` output (section / track / type / priority). Field budgets apply — see `references/cli-mechanics.md`.               |

---

## Step 1: Resolve target → file

| Target semantics                                                        | File (under `${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/`)                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Forward Task creation (new top-level Task)                              | `task-list.json`                                                                      |
| Tactical / single-feature / weeks-scope OR parked / deferred / pre-work | `product-backlog.json`                                                                |
| Strategic / cross-cutting / multi-month                                 | `initiatives.json` (writes via `create-project` et al., not this skill's Create flow. |

The mapping is 1:1 by `document_purpose`.

`task-list` Create writes a new top-level Task into `task-list.json#/tasks` via
`open-task` — the **new-Task creation** path (no backlog source). Backlog → task-list MOVE
is Promote (below).

---

## Step 2: Read the current state (optional pre-write)

The CLI does the authoritative read at write time. A pre-write read is only needed to:

- Pre-stage an explicit `id` instead of relying on auto-id.
- Locate an item by `id` (Update / Delete / Promote) or compute derived values (rank
  auto-shift candidates).
- Inspect state for reporting or composition.

Use slice reads — never load the full file:

```bash
bun scripts/ledger-cli.ts show <ledger> <id>          # full record (ledger: task|backlog|initiatives)
bun scripts/ledger-cli.ts get <ledger> <id> <field>   # single field; omit field = full dump
bun scripts/ledger-cli.ts schema <ledger|recordKind>  # field names + types + budgets
```

---

## Step 3: Compose the entry

Compose the payload within budget. The full per-field source → CLI-flag mapping for each
record kind is in **`references/field-schemas.md`**. Key reminders:

- **Provenance is mandatory** — at minimum `session_refs: [session_counter]`. Task schema
  is `.strict()`; no `metadata.source` field.
- **Backlog `description` ≤500, `title` ≤80; Task `description` ≤1500.**
- **`open-task` auto-fills** the optional nullable/array fields and stamps `updatedAt` —
  supply only meaningful fields + provenance.

---

## Step 4: Write the entry via the CLI

Input modes per record-creating command: positional JSON | `--file <path>` (`-` = stdin) |
named flags. Detail: `references/cli-mechanics.md`.

```bash
# New top-level Task — id MUST be the cross-branch MAX-ID+1 (caller pre-computes)
bun scripts/ledger-cli.ts open-task '<taskJson>'
bun scripts/ledger-cli.ts open-task --file <path>

# Backlog item (description ≤500)
bun scripts/ledger-cli.ts create-backlog '<itemJson>'
bun scripts/ledger-cli.ts create-backlog --title "<title>" --description "<one-sentence>" \
  --priority medium --track <track-id> --rank 1
```

**Cross-branch MAX-ID (forward-Task `id` only):** the CLI's auto-id is local-only. The
caller pre-computes the cross-branch max via the docs-site sweep
`git -C "${KH_PRIVATE_DOCS_DIR}" show origin/{branch}:src/content/docs/ledgers/task-list.json`
and passes it as `id`. See `references/cli-mechanics.md` §"Cross-branch MAX-ID".

The CLI handles atomic write, Zod-canonical field-order, the record-set delta gate (+1
expected), the budget gate, and default-on mirror regen.

---

## Step 5: Report back to the curator

Return the `WRITE COMPLETE` YAML packet (template in `references/cli-mechanics.md`
§"Report blocks"). Mirror the CLI's `warnings[]` verbatim. The `file:` field uses the
docs-site ledger path. Validation status is read off the CLI exit envelope (exit 0 =
passed).

---

## Update mode — edit existing item fields

Transition an existing item's `status`, `priority`, `notes`, or `rank`. Canonical use:
backlog `priority` bumps; `notes` append; `rank` re-rank.

### Inputs (Update)

| Field                        | Description                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `target`                     | `task`, `subtask`, or `backlog`.                                                                   |
| `item_id`                    | Existing item id (dotted `<taskId>.<subId>` for subtask commands; bare otherwise).                 |
| `field_edits`                | Map of mutable fields. Backlog: `{ status?, priority?, notes?, rank? }`. Task/Subtask: per schema. |
| `provenance.session_counter` | Session ID.                                                                                        |

### Update flow

1. **Resolve target → file** (Step 1 table) and target → subcommand
   (`references/cli-mechanics.md` §"Subcommand map"). One subcommand per (record-kind,
   mutation) pair; one field per invocation; minimal-diff is the default (cmux-safe, no
   flag).
2. **Locate the item** via `get <ledger> <id>`. Absent → `record-not-found` (exit 1,
   nothing written).
3. **Compose the edit.** The CLI enforces enum / budget / record-set at write time — no
   pre-validation needed. Allowed values:
   - `status` (backlog): `spec_needed | needs_research | parked | ready | blocked` (NO
     `done` — done items use Delete-or-retain or Promote).
   - `priority` (backlog): shared `Priority` enum.
   - `notes` (backlog): default **overwrites**; pass `--append` to concatenate
     (newline-joined). `--append` is notes-only.
   - `rank` (backlog): integer or `null`; no uniqueness/contiguity enforced. See rank
     auto-shift below.
4. **Invoke the subcommand:**

   ```bash
   bun scripts/ledger-cli.ts update-backlog 142 priority high
   bun scripts/ledger-cli.ts flip-subtask 35.38 in_progress
   bun scripts/ledger-cli.ts append-journal 35.38 "session-context …"
   ```

5. **Rank auto-shift** (backlog `rank` Update only): the CLI does NOT encapsulate this —
   it is curator-side algorithm work.
6. **Report** the `UPDATE COMPLETE` packet (template in `references/cli-mechanics.md`).

---

## Delete mode — remove a backlog item

Used **only** for `cancelled` backlog items.

The only record-removing subcommands are `delete-backlog` and `delete-subtask` — there is
**no `delete-task`**. Done Tasks retain in-place (Update only).

### Inputs (Delete)

| Field                        | Description                                         |
| ---------------------------- | --------------------------------------------------- |
| `target`                     | `backlog`.                                          |
| `item_id`                    | The backlog item id to remove.                      |
| `reason`                     | One of: `cancelled`, or `superseded_by_{other_id}`. |
| `provenance.session_counter` | Session ID.                                         |

### Delete flow

1. **Validate `reason`.** Anything closure-shaped (`done`, `completed`, `finished`,
   `shipped`) → abort:
   `DELETE REJECTED: reason "{reason}" not in allowed set; done closures use Update mode or Promote`.
2. **Capture the body** before removing (`get backlog <itemId>`) — for the audit trail.
3. **Invoke:** `bun scripts/ledger-cli.ts delete-backlog <itemId>`. The CLI runs the
   record-set delta gate (−1 expected) and regenerates mirrors. Absent item →
   `record-not-found`.
4. **Report** the `DELETE COMPLETE` packet (template in `references/cli-mechanics.md`).

---

## Promote mode — move a backlog item to the task-list

Used when a backlog item is picked up for implementation. **Invoked exclusively via
`promote`**.

### Inputs (Promote)

| Field                            | Description                                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `source_backlog_id`              | Bare-digit id of the backlog item (e.g. `"67"`).                                                                                       |
| `destination_shape`              | `new_top_level_task` or `new_subtask_under_task_id`. Encode in the `taskJson` (verify via `bun scripts/ledger-cli.ts promote --help`). |
| `destination_task_id`            | Required if `destination_shape = new_subtask_under_task_id` — the parent Task id.                                                      |
| `provenance.session_counter`     | Session ID (both surfaces).                                                                                                            |
| `provenance.source_commit_sha`   | If the underlying work already shipped, include the SHA for the journal block. Else null.                                              |
| `provenance.promotion_rationale` | One-line `notes` — why pick this up now.                                                                                               |

### Promote flow

1. **Compose the `taskJson`** with the meaningful `TaskSchema` / `SubtaskSchema` fields
   (`references/field-schemas.md`). `promote` auto-fills optional nullable/array fields
   and stamps `updatedAt` (parity with `open-task`).

2. **Invoke `promote`:**

   ```bash
   bun scripts/ledger-cli.ts promote <source_backlog_id> '<taskJson>'
   bun scripts/ledger-cli.ts promote <source_backlog_id> --file <path>
   ```

   The CLI handles: source-existence idempotency guard; destination shape materialisation
   (top-level Task vs Subtask, encoded in `taskJson`); journal block append at the
   destination; atomic delete-from-backlog + add-to-task-list cross-ledger commit;
   two-surface validation (`record-set-violation` on either fails the whole op);
   default-on mirror regen on both ledgers.

3. **Report** the Promote packet (envelope + YAML in `references/cli-mechanics.md`).

---

## Discoverability

- **CLI surface:** `bun scripts/ledger-cli.ts --help`.
- **Per-command help + schema slice:** `bun scripts/ledger-cli.ts <command> --help`.
- **Schema + budgets:** `bun scripts/ledger-cli.ts schema [ledger|recordKind]` — prints
  each field's name + type + budget; never guess (e.g. `subtask.dependencies:string[]`
  (sibling-only) vs `task.dependencies:string[]`).
- **Field budgets:**
  `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/task-list-discipline.md` §2/§3.
- **CLI architecture:** `lib/ledger/README.md`.
- **Two-phase Promote semantics:**
  `${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/id-35-ledger-cli/RESEARCH.md` §3.
- **CLI mechanics (gates, envelopes, report blocks, MAX-ID, rank auto-shift):**
  `references/cli-mechanics.md`.
- **Create-payload field schemas:** `references/field-schemas.md`.
