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
task-view patch-server substrate.

The ledgers live in the private docs-site, NOT the code repo:
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/`. The CLI resolves this path
by default (via `KH_PRIVATE_DOCS_DIR`); never pass a stale `docs/reference/…`
path. **Never wholesale-`Read` the JSON** (`task-list.json` is multi-MB) — use
`show` / `get` slice reads.

The CLI write boundary enforces, in order: schema parse, the record-set delta
gate (∅/+1/−1), the budget gate, then default-on mirror regen — all **before**
any byte is written. Detail (gates, error codes, exit envelope, budgets): **read
`references/cli-mechanics.md`**.

## Operation modes

| Mode | Invoked by | CLI subcommand(s) |
|------|------------|-------------------|
| **Create** | workflow-curator (after `triage-finding` returns `roadmap`, `backlog`, or `task-list`) | ~~`create-theme`~~ **RETIRED (ID-148.8/DR-073/074)** — use the initiatives `create-project` verb (see below); `create-backlog`, `open-task` |
| **Update** | workflow-orchestration (status transitions); curator (priority/notes/rank edits) | ~~`update-roadmap`~~ **RETIRED** — use the initiatives project verbs (`update-project` et al.); `update-backlog`, `update-task`, `update-subtask`, `flip-task`, `flip-subtask`, `append-journal` |
| **Delete** | workflow-orchestration (cancellations); curator (reclassifications) | `delete-backlog` (the **only** backlog delete) |
| **Promote** | workflow-orchestration (picking up a backlog item — see workflow-orchestration §"Backlog pickup → Promote") | `promote` (atomic cross-ledger) — the `--capability-theme` flag is **RETIRED**, see Promote mode below |

> **Landed-state note (ID-148.x, DR-073/074):** the roadmap ledger's file arm
> (`product-roadmap.json`) no longer exists — that data was repurposed
> server-side to the SERVER-managed `initiatives.json` ledger (writes route via
> ServerIntent through the task-view patch-server; no in-process writer). The
> CANONICAL CLI VERB NAMES `update-roadmap`, `create-theme`, `update-umbrella`,
> `show|list roadmap|umbrellas`, and `promote --capability-theme` all return a
> clean `retired-verb`/`retired-flag` envelope (nothing read, nothing
> written). `capability_theme` + `themes[]` retire with **no analog**;
> `umbrella_id` / `update-umbrella` retire with **no direct replacement**
> (`umbrellas.json` remains on disk but is unmaintained, file-delete deferred
> per OQ4). The initiatives/projects topology (`show|list initiatives`, `list
> projects`, `create-project`, `update-project`, `delete-project`,
> `link-tasks`/`unlink-tasks`, `link-backlog`/`unlink-backlog`,
> `move-task`/`move-backlog`) is the replacement write surface, but
> `create-project` requires an **existing** `initiativePath` — there is no
> verb to create a brand-new top-level initiative or sub-initiative. **The
> exact curator Create-mode procedure for a finding that would previously
> have become a new roadmap theme is undesigned — flagged for the owner
> (ID-148.11).** The Create/Update/Delete/Promote sections below still
> describe the retired roadmap-theme/umbrella flow verbatim pending that
> redesign; retired tokens are tagged inline where they recur.

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
| `target` | `roadmap`, `backlog`, or `task-list` (the **target semantics**, not a filename) — `task-list` writes a new top-level Task via `open-task`. |
| `finding_detail` | The finding from the source agent, summarised for ledger storage. |
| `provenance.source_task_id` | Workpackage ID (e.g. `WP1.2`) or null. |
| `provenance.source_commit_sha` | Short SHA from the source commit, or null. |
| `provenance.session_counter` | Session ID. |
| `triage_payload` | The full `triage-finding` output (section / track / type / priority). Field budgets apply — see `references/cli-mechanics.md`. |
| `umbrella_id` | `string` (kebab-case) or `null` (default `null`). **RETIRED (no direct replacement)** — was going to trigger Step 6 (umbrella membership via `update-umbrella`, itself retired). |

---

## Step 1: Resolve target → file

| Target semantics | File (under `${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/`) |
|---|---|
| Strategic / cross-cutting / multi-month | ~~`product-roadmap.json`~~ **RETIRED — file no longer exists.** Repurposed server-side to the SERVER-managed `initiatives.json` (writes via `create-project` et al., not this skill's Create flow — see landed-state note above). |
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
  (rank auto-shift candidates; `capability_theme` context is retired, no
  analog).
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
- **Backlog `description` ≤500, `title` ≤80; Task `description` ≤1500.**
- **Roadmap soft-cap** (`themes[]`) — **RETIRED**, no analog on the
  initiatives/projects surface.
- **`open-task` auto-fills** the optional nullable/array fields and stamps
  `updatedAt` — supply only meaningful fields + provenance.

---

## Step 4: Write the entry via the CLI

Input modes per record-creating command: positional JSON | `--file <path>`
(`-` = stdin) | named flags. Detail: `references/cli-mechanics.md`.

```bash
# Roadmap theme — RETIRED (ID-148.8): `create-theme` now returns a clean
# `retired-verb` envelope, nothing written. Use the initiatives
# `create-project <initiativePath> <projectJson>` verb instead — it requires
# an existing initiative/sub-initiative path (see landed-state note above;
# no verb creates a brand-new top-level initiative).

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

## Step 6: Umbrella membership — RETIRED (ID-148.8/DR-073/074, no direct replacement)

`update-umbrella` now returns a clean `retired-verb` envelope (the umbrella
surface is fully retired). `umbrellas.json` remains on disk but is
unmaintained (file-delete deferred per OQ4) — do not read or write it as part
of this skill's flow. There is no replacement step; a new top-level Task's
strategic grouping is no longer expressed via umbrella membership. This
section previously described the retired flow (kept below **for historical
orientation only** — do not execute it):

```bash
# RETIRED — returns retired-verb, nothing bound, nothing written:
bun scripts/ledger-cli.ts update-umbrella <umbrella_id> --add-tasks <new-task-id>
```

`capability_theme` and `umbrella_id` are both retired with no analog on the
initiatives/projects surface.

---

## Update mode — edit existing item fields

Transition an existing item's `status`, `priority`, `notes`, or `rank`.
Canonical use: backlog `priority` bumps; `notes` append; `rank` re-rank.
Roadmap-theme `status` transitions are **RETIRED** — see `target: 'roadmap'`
below.

### Inputs (Update)

| Field | Description |
|-------|-------------|
| `target` | `backlog`, `task`, or `subtask`. `roadmap` is **RETIRED** — `update-roadmap` returns `retired-verb`; use the initiatives project verbs (`update-project` et al.) instead, outside this skill's flow. |
| `item_id` | Existing item id (dotted `<taskId>.<subId>` for subtask commands; bare otherwise). |
| `field_edits` | Map of mutable fields. Backlog: `{ status?, priority?, notes?, rank? }`. Task/Subtask: per schema. Roadmap theme `{ status?, notes?, time_horizon? }` is retired, no analog. |
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
   - `status` (roadmap theme) — **RETIRED**, no analog.
   - `status` (backlog): `spec_needed | needs_research | parked | ready |
     blocked` (NO `done` — done items use Delete-or-retain or Promote).
   - `priority` (backlog): shared `Priority` enum.
   - `notes` (backlog): default **overwrites**; pass `--append` to
     concatenate (newline-joined). `--append` is notes-only.
   - `rank` (backlog): integer or `null`; no uniqueness/contiguity enforced.
     See rank auto-shift below.
   - `time_horizon` (roadmap theme) — **RETIRED**, no analog.
4. **Invoke the subcommand:**

   ```bash
   bun scripts/ledger-cli.ts update-backlog 142 priority high
   bun scripts/ledger-cli.ts flip-subtask 35.38 in_progress
   bun scripts/ledger-cli.ts append-journal 35.38 "session-context …"
   # update-roadmap 7 status in_progress — RETIRED, returns retired-verb
   ```

5. **Rank auto-shift** (backlog `rank` Update only): the CLI does NOT encapsulate
   this — it is curator-side algorithm work. Steps + report field in
   `references/cli-mechanics.md` §"Rank auto-shift".
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

Used **only** for `cancelled` backlog items and **reclassifications**. The
`reclassified_to_roadmap` reason's follow-up create (`delete-backlog` then
`create-theme`) is **RETIRED** — `create-theme` returns `retired-verb`; the
equivalent reclassification onto the initiatives/projects surface is
undesigned (flagged for the owner, ID-148.11).

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
4. **If `reclassified_*`,** the `reclassified_to_roadmap` follow-up
   (`create-theme`) is **RETIRED** — see the note above; flag to the owner
   rather than guessing a replacement.
5. **Report** the `DELETE COMPLETE` packet (template in `references/cli-mechanics.md`).

### What Delete is NOT

- **Not a closure mechanism** — a completed Task is `flip-task <id> done`
  (roadmap-theme closure via `update-roadmap` is retired).
- **Not for cleanup of stale-but-not-cancelled items** — those remain until the
  product owner explicitly cancels them.
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
| `umbrella_id` | **RETIRED (no direct replacement)** — was going to trigger Step 6 (`update-umbrella`, itself retired). |
| `capability_theme` | **RETIRED** — the `--capability-theme` flag now returns `retired-flag` immediately (nothing bound, nothing written). |

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
   # --capability-theme <themeId> — RETIRED (ID-148.8): returns `retired-flag`
   # immediately, nothing bound, nothing written. No replacement flag exists;
   # the initiatives-side equivalent (linking a newly-promoted Task's project
   # into an initiative) is undesigned — flag to the owner (ID-148.11).
   ```

   The CLI handles: source-existence idempotency guard; destination shape
   materialisation (top-level Task vs Subtask, encoded in `taskJson`); journal
   block append at the destination; atomic delete-from-backlog +
   add-to-task-list cross-ledger commit; two-surface validation
   (`record-set-violation` on either fails the whole op); default-on mirror
   regen on both ledgers.

3. **Umbrella membership — RETIRED.** `update-umbrella` returns `retired-verb`;
   there is no replacement step (see Step 6 above).

4. **Report** the Promote packet (envelope + YAML in `references/cli-mechanics.md`).

### What Promote is NOT

- **Not a manual two-step** — manual `delete-backlog` + `open-task` +
  `append-journal` is forbidden by workflow-orchestration; it loses atomicity,
  idempotency, and cross-ledger validation.
- **Not for one-way backlog cleanup** — use `delete-backlog` with `reason:
  cancelled | superseded_by_{id}`.
- **Not idempotent** — re-promoting the same id fails (source is gone after the
  first promotion); intentional, CLI-guarded.
- **Not for backlog → roadmap reclassification** — that flow (`delete-backlog`
  + `create-theme`) is retired; Promote is exclusively backlog → task-list.

---

## Critical conventions

1. **Provenance is mandatory.** Every Create carries at least
   `session_counter`. Pass it even if the others are null.
2. **`.strict()` task schemas.** No fields beyond the schema — extra
   fields fail `schema-error` at write time. (The roadmap-theme schema this
   line also used to cover, `RoadmapThemeSchema`/`roadmap-schema.ts`, is
   deleted — the initiatives-schema.ts vendored twin is the current
   `.strict()` schema for that ledger, out of this skill's write scope.)
3. **UK English throughout.** "colour", "organisation", "behaviour",
   DD/MM/YYYY dates.
4. **Forward-looking roadmap — RETIRED.** Theme `status: pending | in_progress
   | done` no longer applies (no analog); `initiatives.json` is the
   SERVER-managed ledger now, writes via ServerIntent through the task-view
   patch-server, out of this skill's scope.
5. **No closure values in backlog status** (`spec_needed | needs_research |
   parked | ready | blocked`). Picked-up items are Promoted; cancelled /
   reclassified items are Deleted. Backlog never carries `done`.
6. **Never `git commit` from this skill.** The CLI writes the JSON; the
   Orchestrator commits. Applies to all four modes.
7. **Field budgets enforced at write time.** Compose within budget; `--force` is
   not a routine escape — its only legitimate use is downgrading
   `budget-exceeded`; right-size the field instead.
8. **One finding → exactly one ledger.** A finding goes to roadmap OR backlog,
   never both; the reclassification follow-up (`delete-backlog` +
   `create-theme`) is retired — see Delete mode above.
9. **Minimal-diff (scoped) is the global default** for every mutating command.
   `--scoped` is a deprecated no-op. Use `--whole-file` only for a deliberate
   whole-file rewrite (it re-serialises the whole file and collides with sibling
   cmux terminals).

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
- Not a code-edit skill, and not a raw-`Edit` skill. Only the JSON ledgers, and
  only via `bun scripts/ledger-cli.ts` (`Edit` is not in `allowed-tools`).
- Not a commit skill. The Orchestrator commits.
- Not Taskmaster-coupled. No `task-master` commands.
- Not a closure-via-Delete mechanism. Completed items are status-flipped via
  Update, promoted via `promote`, retained in-place — never pruned.
- Not a manual `umbrellas.json` author — moot now: `update-umbrella` is
  retired (returns `retired-verb`); `umbrellas.json` remains on disk
  unmaintained (deferred per OQ4) and this skill has no umbrella-writing flow
  any more (former Step 6).
