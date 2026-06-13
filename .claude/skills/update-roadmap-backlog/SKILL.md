---
name: update-roadmap-backlog
description:
  Full-CRUD + Promote maintenance of the roadmap and backlog JSON ledgers — create
  new items from a triaged finding (with provenance: source ID-N, source-commit-sha,
  or session counter), update existing items' status / priority / notes / rank fields
  (covers status transitions like pending → in-progress → done), delete cancelled or
  reclassified backlog items (never done closures, which retain in-place), or promote
  a backlog item atomically to task-list.json as a new Task or Subtask. All writes
  route through `bun scripts/ledger-cli.ts` — never raw `Edit` on the JSON ledgers.
  Invoked by the workflow-curator agent (Create after triage-finding returns
  roadmap/backlog) or directly by the workflow-orchestration skill (Update for status
  transitions; Delete for cancellations; Promote when picking up a backlog item).
allowed-tools: Read, Bash, Grep
---

# update-roadmap-backlog — CRUD Maintenance of the Ledger

Maintains the roadmap, backlog, and task-list JSON ledgers across the full
Create / Read / Update / Delete / Promote lifecycle.

**All writes route through `bun scripts/ledger-cli.ts` — never `Edit` on the
ledgers.** The CLI is the operator-facing mutation surface; enforcement
(serialisation, write-time gates, mirror regen) lives server-side in the
task-view patch-server substrate (invariant 57). Compose call shapes against
the CLI exactly; only *where* the work happens moved.

The ledgers live in the private docs-site, NOT the code repo:
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/`. The CLI resolves this path
by default (via `KH_PRIVATE_DOCS_DIR`); never pass a stale `docs/reference/…`
path. **Never wholesale-`Read` the JSON** (`task-list.json` is multi-MB) — use
`show` / `get` slice reads.

The CLI write boundary enforces, in order: schema parse, the record-set delta
gate (∅/+1/−1), the budget gate, then default-on mirror regen. Validation
happens **before** any byte is written — there is no post-write round-trip step.
Detail (gates, error codes, exit envelope, budgets): **read
`references/cli-mechanics.md`**.

## Operation modes

| Mode | Invoked by | CLI subcommand(s) |
|------|------------|-------------------|
| **Create** | workflow-curator (after `triage-finding` returns `roadmap`, `backlog`, or `task-list`) | `create-theme`, `create-backlog`, `open-task` |
| **Update** | workflow-orchestration (status transitions); curator (priority/notes/rank edits) | `update-roadmap`, `update-backlog`, `update-task`, `update-subtask`, `flip-task`, `flip-subtask`, `append-journal` |
| **Delete** | workflow-orchestration (cancellations); curator (reclassifications) | `delete-backlog` (the **only** backlog delete) |
| **Promote** | workflow-orchestration (picking up a backlog item — see workflow-orchestration §"Backlog pickup → Promote") | `promote` (atomic cross-ledger) |

Create is the default mode (Steps 1–6 below). Update, Delete, and Promote have
their own sections; all share the target → file mapping (Step 1) and the CLI
write boundary.

**Promote is the canonical backlog → task-list path** — never a manual Delete +
Edit. It enforces atomicity, idempotency, journal-block auto-append, and
two-surface validation.

---

## Inputs (Create)

| Field | Description |
|-------|-------------|
| `target` | `roadmap`, `backlog`, or `task-list` (the **target semantics**, not a filename) — `task-list` writes a new top-level Task via `open-task` (T-OQ-2 RATIFIED). |
| `finding_detail` | The finding from the source agent, summarised for ledger storage. |
| `provenance.source_task_id` | Workpackage ID (e.g. `WP1.2`) or null. |
| `provenance.source_commit_sha` | Short SHA from the source commit, or null. |
| `provenance.session_counter` | Session ID (e.g. `kh-prod-readiness-s47`). |
| `triage_payload` | The full `triage-finding` output (section / track / type / priority). Field budgets apply — see `references/cli-mechanics.md`. |
| `umbrella_id` | `string` (kebab-case) or `null` (default `null`). When non-null AND the destination resolves to a top-level Task: triggers Step 6 (umbrella membership via `update-umbrella`). Ignored for Subtask or roadmap/backlog destinations. |

---

## Step 1: Resolve target → file

| Target semantics | File (under `${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/`) |
|---|---|
| Strategic / cross-cutting / multi-month | `product-roadmap.json` |
| Tactical / single-feature / weeks-scope OR parked / deferred / pre-work | `product-backlog.json` |
| Forward Task creation (new top-level Task) | `task-list.json` |

The mapping is 1:1 by `document_purpose`. The skill enforces target-semantic
routing; the curator never auto-corrects the destination.

`task-list` Create writes a new top-level Task into `task-list.json#/tasks` via
`open-task` — the **new-Task creation** path (no backlog source). Backlog →
task-list MOVE is Promote (below).

---

## Step 2: Read the current state (optional pre-write)

The CLI does the authoritative read at write time. A pre-write read is only
needed to:

- Pre-stage an explicit `id` instead of relying on auto-id.
- Locate an item by `id` (Update / Delete / Promote) or compute derived values
  (rank auto-shift candidates, capability_theme context).
- Inspect state for reporting or composition.

Use slice reads — never load the full file:

```bash
bun scripts/ledger-cli.ts show <ledger> <id>          # full record (ledger: task|roadmap|backlog)
bun scripts/ledger-cli.ts get <ledger> <id> <field>   # single field; omit field = full dump
bun scripts/ledger-cli.ts schema <ledger|recordKind>  # field names + types + budgets
```

---

## Step 3: Compose the entry

Compose the payload within budget (the write gate hard-rejects over-budget
fields with `budget-exceeded`; `--force` is not a routine escape). The full
per-field source → CLI-flag mapping for each record kind is in
**`references/field-schemas.md`**. Key reminders:

- **Provenance is mandatory** — at minimum `session_refs: [session_counter]`.
  Roadmap + task schemas are `.strict()`; no `metadata.source` field.
- **Backlog `description` budget is ≤500, `title` ≤80** (not 1500). Task
  `description` ≤1500.
- **Roadmap soft-cap:** a 13th theme does not hard-block but surfaces a soft-cap
  warning — consider merging overlapping themes (PRODUCT inv 8).
- **`open-task` auto-fills** the optional nullable/array fields and stamps
  `updatedAt` — supply only meaningful fields + provenance.

---

## Step 4: Write the entry via the CLI

Input modes per record-creating command: positional JSON | `--file <path>`
(`-` = stdin) | named flags. Detail: `references/cli-mechanics.md`.

```bash
# Roadmap theme
bun scripts/ledger-cli.ts create-theme '<themeJson>'
bun scripts/ledger-cli.ts create-theme --title "<name>" --description "<md>" --status pending

# Backlog item (description ≤500)
bun scripts/ledger-cli.ts create-backlog '<itemJson>'
bun scripts/ledger-cli.ts create-backlog --title "<title>" --description "<one-sentence>" \
  --priority medium --track <track-id> --rank 1

# New top-level Task — id MUST be the cross-branch MAX-ID+1 (caller pre-computes)
bun scripts/ledger-cli.ts open-task '<taskJson>'
bun scripts/ledger-cli.ts open-task --file <path>
```

**Cross-branch MAX-ID (forward-Task `id` only):** the CLI's auto-id is
local-only. The caller pre-computes the cross-branch max via the docs-site sweep
`git -C "${KH_PRIVATE_DOCS_DIR}" show origin/{branch}:src/content/docs/ledgers/task-list.json`
and passes it as `id`. See `references/cli-mechanics.md` §"Cross-branch MAX-ID".

The CLI handles atomic write, Zod-canonical field-order, the record-set delta
gate (+1 expected), the budget gate, and default-on mirror regen.

---

## Step 5: Report back to the curator

Return the `WRITE COMPLETE` YAML packet (template in
`references/cli-mechanics.md` §"Report blocks"). Mirror the CLI's `warnings[]`
verbatim. The `file:` field uses the docs-site ledger path. Validation status is
read off the CLI exit envelope (exit 0 = passed).

---

## Step 6: Umbrella membership (optional)

**Applies when:** `umbrella_id` is non-null AND the destination resolves to a
top-level Task (`target: 'task-list'` Create OR Promote with
`destination_shape === 'new_top_level_task'`). Ignored for Subtask destinations
and roadmap/backlog Create.

The CLI owns `umbrellas.json` `task_ids[]` membership — do NOT manually `Read` +
parse + edit it. After the Task write completes:

```bash
bun scripts/ledger-cli.ts update-umbrella <umbrella_id> --add-tasks <new-task-id>
```

`--add-tasks` is idempotent (re-adding is a no-op). `umbrellas.json` is NOT
mirrored and has no budgeted fields. Verify the surface via `bun
scripts/ledger-cli.ts update-umbrella --help`.

**Commit-coupling (PRODUCT inv 17 — load-bearing):** the caller MUST include
BOTH the `task-list.json` and `umbrellas.json` edits in a **single commit** (the
round-trip test catches broken references; orphans warn but don't fail per
P-OQ-2).

`capability_theme` (set on the Task, points at a roadmap theme) and `umbrella_id`
are orthogonal — both may be supplied in the same Create or Promote.

---

## Update mode — edit existing item fields

Transition an existing item's `status`, `priority`, `notes`, or `rank`.
Canonical use: roadmap theme `pending → in_progress → done`; backlog `priority`
bumps; `notes` append; `rank` re-rank.

### Inputs (Update)

| Field | Description |
|-------|-------------|
| `target` | `roadmap`, `backlog`, `task`, or `subtask`. |
| `item_id` | Existing item id (dotted `<taskId>.<subId>` for subtask commands; bare otherwise). |
| `field_edits` | Map of mutable fields. Backlog: `{ status?, priority?, notes?, rank? }`. Roadmap theme: `{ status?, notes?, time_horizon? }`. Task/Subtask: per schema. |
| `provenance.session_counter` | Session ID. |

### Update flow

1. **Resolve target → file** (Step 1 table) and target → subcommand
   (`references/cli-mechanics.md` §"Subcommand map"). One subcommand per
   (record-kind, mutation) pair; one field per invocation; minimal-diff is the
   default (cmux-safe, no flag).
2. **Locate the item** via `get <ledger> <id>`. Absent → `record-not-found`
   (exit 1, nothing written).
3. **Compose the edit.** The CLI enforces enum / budget / record-set at write
   time — no pre-validation needed. Allowed values:
   - `status` (roadmap theme): `pending | in_progress | done`.
   - `status` (backlog): `spec_needed | needs_research | parked | ready |
     blocked` (NO `done` — done items use Delete-or-retain or Promote).
   - `priority` (backlog): shared `Priority` enum.
   - `notes` (backlog/roadmap): default **overwrites**; pass `--append` to
     concatenate (newline-joined). `--append` is notes-only.
   - `rank` (backlog): integer or `null`; no uniqueness/contiguity enforced
     (PRODUCT inv 3). See rank auto-shift below.
   - `time_horizon` (roadmap theme): `now | next | later`.
4. **Invoke the subcommand:**

   ```bash
   bun scripts/ledger-cli.ts update-roadmap 7 status in_progress
   bun scripts/ledger-cli.ts update-backlog 142 priority high
   bun scripts/ledger-cli.ts flip-subtask 35.38 in_progress
   bun scripts/ledger-cli.ts append-journal 35.38 "session-context …"
   ```

5. **Rank auto-shift** (backlog `rank` Update only, P-OQ-3 default): the CLI does
   NOT encapsulate this — it is curator-side algorithm work. Steps + report
   field in `references/cli-mechanics.md` §"Rank auto-shift".
6. **Report** the `UPDATE COMPLETE` packet (template in `references/cli-mechanics.md`).

### What Update is NOT

- **Not for `done` closures on the backlog** — backlog `status` has no `done`.
  Finished backlog items are Deleted (if reclassified/cancelled) or Promoted
  (the canonical done-closure path).
- **Not for ID changes** — no `update-*-id` subcommand; that is a delete +
  re-create migration.
- **Not for `description` / `title` rewrites** — bodies are append-only via
  `notes`; substantive rewrites need delete + create.

---

## Delete mode — remove a backlog item

Used **only** for `cancelled` backlog items and **reclassifications** (an item
moving from backlog to roadmap = `delete-backlog` then `create-theme`).

The only record-removing subcommands are `delete-backlog` and `delete-subtask`
— there is **no `delete-task`, no `delete-roadmap`**. Done Tasks and done themes
retain in-place (Update only); Delete is reserved for cancelled / reclassified
backlog items and erroneously-added Subtasks. (`delete-subtask <taskId.subId>`
removes a Subtask under a Task — not part of the backlog-cleanup flow below.)

### Inputs (Delete)

| Field | Description |
|-------|-------------|
| `target` | `backlog` only. |
| `item_id` | The backlog item id to remove. |
| `reason` | One of: `cancelled`, `reclassified_to_roadmap`, `superseded_by_{other_id}`. **No other reasons.** |
| `provenance.session_counter` | Session ID. |
| `reclassification_target` | If `reason` starts with `reclassified_`, the target ledger for the follow-up Create. |

### Delete flow

1. **Validate `reason`.** Anything closure-shaped (`done`, `completed`,
   `finished`, `shipped`) → abort: `DELETE REJECTED: reason "{reason}" not in
   allowed set; done closures use Update mode or Promote`.
2. **Capture the body** before removing (`get backlog <itemId>`) — for the audit
   trail and any reclassification Create.
3. **Invoke:** `bun scripts/ledger-cli.ts delete-backlog <itemId>`. The CLI runs
   the record-set delta gate (−1 expected) and regenerates mirrors. Absent item
   → `record-not-found`.
4. **If `reclassified_*`,** follow up with `create-theme` (for
   `reclassified_to_roadmap`) using the captured body to preserve provenance.
5. **Report** the `DELETE COMPLETE` packet (template in `references/cli-mechanics.md`).

### What Delete is NOT

- **Not a closure mechanism** — a completed theme is `update-roadmap <id> status
  done`; a completed Task is `flip-task <id> done`.
- **Not for cleanup of stale-but-not-cancelled items** — those remain until the
  product owner explicitly cancels them.
- **Not for typo corrections** — field fixes use Update; full rewrites pair
  Delete with Create.
- **Not the backlog → task-list path** — use Promote (Delete loses
  source→destination traceability).
- **Not available for whole Tasks or themes** — reclassifying a Task to a backlog
  item is a manual two-step: `flip-task <id> cancelled` (retains the record) +
  `create-backlog` with the captured body.

---

## Promote mode — move a backlog item to the task-list (atomic)

Used when a backlog item is picked up for implementation. **Invoked exclusively
via `promote`** — never a manual Delete-then-Create. `promote` is the two-phase
commit (delete-from-backlog + add-to-task-list + journal-block append +
two-surface validation) as a single atomic operation.

Per `workflow-orchestration` §"Backlog pickup → Promote", `promote` is canonical
because it is atomic, enforces the idempotency check (re-promotion fails:
`"Promote source not found: id={id}. Already promoted?"`), and writes the
provenance journal block (`<info added on …>`) linking the source backlog id into
the destination `details` automatically.

### Inputs (Promote)

| Field | Description |
|-------|-------------|
| `source_backlog_id` | Bare-digit id of the backlog item (e.g. `"67"`). |
| `destination_shape` | `new_top_level_task` or `new_subtask_under_task_id`. Encode in the `taskJson` (verify via `bun scripts/ledger-cli.ts promote --help`). |
| `destination_task_id` | Required if `destination_shape = new_subtask_under_task_id` — the parent Task id. |
| `provenance.session_counter` | Session ID (both surfaces). |
| `provenance.source_commit_sha` | If the underlying work already shipped, include the SHA for the journal block. Else null. |
| `provenance.promotion_rationale` | One-line `notes` — why pick this up now. |
| `umbrella_id` | Optional. Non-null AND `new_top_level_task` → triggers Step 6 (`update-umbrella`). Ignored for subtask destinations. |
| `capability_theme` | Optional roadmap theme id — pass via the CLI's `--capability-theme` flag (see below). |

### Promote flow

1. **Compose the `taskJson`** with the meaningful `TaskSchema` /
   `SubtaskSchema` fields (`references/field-schemas.md`). `promote` auto-fills
   optional nullable/array fields and stamps `updatedAt` (parity with
   `open-task`). The budget gate enforces field budgets — over-budget aborts the
   whole operation.

2. **Invoke `promote`:**

   ```bash
   bun scripts/ledger-cli.ts promote <source_backlog_id> '<taskJson>'
   bun scripts/ledger-cli.ts promote <source_backlog_id> --file <path>
   # bind a roadmap theme atomically (sets task.capability_theme +
   # appends the task id to theme.linked_tasks[]):
   bun scripts/ledger-cli.ts promote <source_backlog_id> '<taskJson>' --capability-theme <themeId>
   ```

   The CLI handles: source-existence idempotency guard; destination shape
   materialisation (top-level Task vs Subtask, encoded in `taskJson`); journal
   block append at the destination; atomic delete-from-backlog +
   add-to-task-list cross-ledger commit; two-surface validation
   (`record-set-violation` on either fails the whole op); default-on mirror
   regen on both ledgers. An unknown `--capability-theme` id rejects with
   `unknown-theme` before any byte is written.

   **`--capability-theme` replaces the old manual lookup.** The CLI now binds the
   theme and appends to `theme.linked_tasks[]` atomically — there is no
   curator-side pre-compute step. If the source backlog id is linked from
   multiple themes and you cannot disambiguate, omit `--capability-theme` and
   surface a warning for explicit curator decision.

3. **Umbrella membership (optional — Step 6).** If `umbrella_id` is non-null AND
   `destination_shape === 'new_top_level_task'`, run `update-umbrella
   <umbrella_id> --add-tasks <new-task-id>` and include it in the same commit as
   the promote write (PRODUCT inv 17 commit-coupling).

4. **Report** the Promote packet (envelope + YAML in `references/cli-mechanics.md`).

### What Promote is NOT

- **Not a manual two-step** — manual `delete-backlog` + `open-task` +
  `append-journal` is forbidden by workflow-orchestration; it loses atomicity,
  idempotency, and cross-ledger validation.
- **Not for one-way backlog cleanup** — use `delete-backlog` with `reason:
  cancelled | superseded_by_{id}`.
- **Not idempotent** — re-promoting the same id fails (source is gone after the
  first promotion); intentional, CLI-guarded.
- **Not for backlog → roadmap reclassification** — that is `delete-backlog` +
  `create-theme`. Promote is exclusively backlog → task-list.

---

## Critical conventions

1. **Provenance is mandatory.** Every Create carries at least
   `session_counter`. Pass it even if the others are null.
2. **`.strict()` roadmap + task schemas.** No fields beyond the schema — extra
   fields fail `schema-error` at write time.
3. **UK English throughout.** "colour", "organisation", "behaviour",
   DD/MM/YYYY dates.
4. **Forward-looking roadmap (Shape A).** Theme `status: pending | in_progress |
   done`; `done` themes retain in-place (Update only, never deleted).
5. **No closure values in backlog status** (`spec_needed | needs_research |
   parked | ready | blocked`). Picked-up items are Promoted; cancelled /
   reclassified items are Deleted. Backlog never carries `done`.
6. **Never `git commit` from this skill.** The CLI writes the JSON; the
   Orchestrator commits. Applies to all four modes.
7. **Field budgets enforced at write time** (`${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/task-list-discipline.md`).
   Compose within budget; `--force` is not a routine escape.
8. **Minimal-diff (scoped) is the global default** for every mutating command.
   `--scoped` is a deprecated no-op. Use `--whole-file` only for a deliberate
   whole-file rewrite.

---

## Failure modes to avoid

1. **Forgetting provenance** — every Create needs at least `session_counter`, or
   edits can't be traced.
2. **An unknown field on a `.strict()` record** → `schema-error` at write time.
3. **Committing from this skill** — the Orchestrator owns commit sequencing.
4. **Writing to both files for one finding** — a finding goes to exactly one of
   roadmap or backlog (reclassifications use `delete-backlog` + `create-theme`,
   not concurrent writes).
5. **`--whole-file` on a routine single-record edit** — minimal-diff is the
   default; `--whole-file` re-serialises the whole file and collides with
   sibling cmux terminals. `--scoped` is a no-op (never required).
6. **`delete-backlog` for `done` closures** — a completed theme is
   `update-roadmap <id> status done`; a completed Task is `flip-task <id> done`.
7. **Overwriting `notes` without `--append`** — default `update-backlog/roadmap
   <id> notes <value>` overwrites; pass `--append` to preserve history
   (notes-only).
8. **A 13th theme without checking the soft cap** — the write surfaces a soft-cap
   warning (PRODUCT inv 8); consider merging overlapping themes.
9. **Forgetting `--rank N` on Create** into an otherwise-unranked tier — auto-id
   does NOT auto-rank; set `--rank 1` to anchor future inserts.
10. **`--force` outside a genuine budget override** — its only legitimate use is
    downgrading `budget-exceeded`; right-size the field instead.

---

## Discoverability

- **CLI surface:** `bun scripts/ledger-cli.ts --help`.
- **Per-command help + schema slice:** `bun scripts/ledger-cli.ts <command> --help`.
- **Schema + budgets:** `bun scripts/ledger-cli.ts schema [ledger|recordKind]` —
  prints each field's name + type + budget; never guess (e.g.
  `subtask.dependencies:string[]` (sibling-only) vs `task.dependencies:string[]`).
- **Field budgets:** `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/task-list-discipline.md` §2/§3.
- **CLI architecture:** `lib/ledger/README.md`.
- **Two-phase Promote semantics:** `${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/id-35-ledger-cli/RESEARCH.md` §3.
- **CLI mechanics (gates, envelopes, report blocks, MAX-ID, rank auto-shift):**
  `references/cli-mechanics.md`.
- **Create-payload field schemas:** `references/field-schemas.md`.

---

## What this skill is NOT

- Not the decision skill. `triage-finding` decides; this skill writes.
- Not a code-edit skill. Only the JSON ledgers — via the CLI.
- Not a raw-`Edit` skill. `Edit` is not in `allowed-tools`; writes route through
  `bun scripts/ledger-cli.ts` exclusively.
- Not a commit skill. The Orchestrator commits.
- Not Taskmaster-coupled. No `task-master` commands.
- Not a closure-via-Delete mechanism. Completed items are status-flipped via
  Update, promoted via `promote`, retained in-place — never pruned.
- Not a manual `umbrellas.json` author. The CLI's `update-umbrella` subcommand
  maintains umbrella `task_ids[]` membership; Step 6 drives it as part of a
  Create/Promote.
