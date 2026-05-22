---
name: update-docs
description:
  Update roadmap, state of the product, auto-generated stats,
  product-functionality docs, and product backlog to reflect the current
  session's work, then auto-chain to /handoff. Triggers on "update docs".
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Skill
---

# Update Docs — Session Documentation Sync

Updates roadmap, state-of-the-product, auto-generated stats,
product-functionality, and product backlog docs to reflect the current session's
work, then auto-chains to `/handoff` to generate the continuation prompt.

## Document Roles (READ FIRST)

The planning documents have distinct, non-overlapping roles:

| Document                              | File                                                                                                       | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **State of the product**              | `docs/reference/state-of-the-product.md`                                                                   | **Canonical record of what is CURRENTLY built.** Bullet-list-driven capability ledger organised by functional area (Feature State, AI Integration Points, Test Infrastructure, etc.). Each section describes the present-tense capability — never a session-by-session changelog. Updated whenever a significant feature lands; the corresponding session narrative is appended to the per-§ change-log file matching the touched SoTP §N (`state-of-the-product-change-log-section-{5,8,9}.md`) atomically. The pointer-doc `state-of-the-product-change-log.md` is the discovery index — never an append target. |
| **Roadmap**                           | `docs/reference/product-roadmap.json` (authoritative) + `product-roadmap.md` (generated)                   | **Forward-looking only.** Active and ready-for-implementation items. All session work is driven from here. Never contains Done/Shipped/Resolved items. **JSON-shaped post-S39 W1 Phase 2** — edit JSON only; regenerate MD via `bun run roadmap:render`. Round-trip CI guard enforces parity. Section narratives live in `sections[*].narrative`; per-item `status` / `priority` enums + `*_note` freetext companions per `lib/validation/roadmap-schema.ts`.                                                                                                                                                      |
| **Product backlog**                   | `docs/reference/product-backlog.json`                                                                      | Items awaiting promotion to the roadmap. **JSON-shaped** since kh-prod-readiness-S37 cutover; `items[]` array with `id`, `description`, `type`, `status`, `effort_estimate`, `priority`, `track`, `dependencies`, `surfaced`, `notes`. Status enum: `spec_needed` / `needs_research` / `parked` / `ready` / `blocked` (no closure values — closed items are removed entirely).                                                                                                                                                                                                                                     |
| **State of the product — change log** | `docs/reference/state-of-the-product-change-log.md` (+ per-§ siblings)                                     | **Discovery index (pointer-doc) + per-section append targets.** A thin pointer-doc carrying a discovery table that lists the per-§ files; append-only writes route to `state-of-the-product-change-log-section-{5,8,9}.md` — one file per SoTP §N. Newest at bottom.                                                                                                                                                                                                                                                                                                                                               |
| **Track change-log**                  | `docs/audits/*/STATUS-change-log.md` (+ `STATUS-change-log-archive.md` rolling-window sibling per Shape C) | **Per-session net-delta log** (one row per session, rolling last 10). Append-only; oldest rows roll to archive sibling. The single-file `STATUS.md` ledger pattern was archived kh-prod-readiness-S41 W3 — all active items now live in `product-roadmap.json` / `product-backlog.json`.                                                                                                                                                                                                                                                                                                                           |

---

## Step 1: Regenerate Auto-Generated Stats

Run all stats scripts to ensure the generated files reflect the current
session's changes.

```bash
# Anchor to the current repo root
ROOT="$(git rev-parse --show-toplevel)"

# Regenerate codebase statistics
cd "$ROOT" && bun run stats

# Regenerate MCP tool/resource/prompt inventory
cd "$ROOT" && bun run generate:mcp-inventory
```

---

## Step 2: Understand Session Work

Read the conversation context and any task tracking to understand which work
packages were completed, partially completed, or deferred.

---

## Step 3: Update State of the Product (capture-then-prune anchor)

**Files:**

- `docs/reference/state-of-the-product.md` — canonical present-tense capability
  ledger
- `docs/reference/state-of-the-product-change-log-section-{5,8,9}.md` —
  append-only per-section narrative (warm tier, S186 onwards).
- `docs/reference/state-of-the-product-change-log.md` — discovery index /
  pointer-doc.

**Why SoTP first (capture-then-prune principle).** SoTP + change-log are the
audit trail for any shipped work. Record the capability narrative here BEFORE
pruning forward-looking trackers (Step 4 roadmap; Step 8 backlog) so a future
reader (or AI) can always trace shipped work to a present-tense capability
bullet. If you remove a roadmap or backlog row first, the only surviving record
is the git diff — fine for the diligent, brittle for skim-readers and AI agents
that read SoTP as canonical.

SoTP carries the bullet list of what is currently built; the change-log carries
when/how/why each capability changed. **Capability edits and change-log appends
always ship in the SAME COMMIT** so a future reader can diff both surfaces
together.

**1. Determine the type of session work:**

- **Capability change** — new feature, removed feature, behaviour shift, or any
  visible-from-outside change to the platform's shape: update the relevant SoTP
  capability bullet AND append a row to the change-log.
- **Session-narrative only** — bug fix, refactor, perf tweak, doc cleanup, or
  any work that didn't change the capability shape: append a change-log row
  only. Do not edit SoTP.
- **Skip both** — purely cosmetic work (e.g. lint sweep, prettier reflow) with
  no functional or audit value.

**2. For capability changes — update SoTP:**

1. **Find the relevant functional section** under §5 Feature State or §8 AI
   Integration Points (e.g. "Sector Intelligence", "AI Evaluation", "Test
   Infrastructure", "MCP Server Integration"). Each section describes the
   present-tense capability — never a session-by-session changelog.
2. **Update the capability bullet in place.** The capability statement is what's
   true; the change-log carries when/how/why it changed.
3. **If a feature was REMOVED**, delete the bullet outright.
4. **If the section does not exist**, add a new bullet under the most
   appropriate sub-section.
5. **Preserve the section-header banner** at the top of each §5/§8 sub-section:
   `> Capability summary only. Session-by-session narrative lives in [state-of-the-product-change-log.md](state-of-the-product-change-log.md).`

**3. Append a change-log row** to the per-§ change-log file matching the
affected SoTP §N:

- §5 Feature State →
  `docs/reference/state-of-the-product-change-log-section-5.md` (single table)
- §8 AI Integration Points →
  `docs/reference/state-of-the-product-change-log-section-8.md` — **three
  sub-tables** routed by `### sub-section` heading:
  - `## §8 AI Integration Points — change log` (top table, default) for MCP tool
    / prompt / classification changes
  - `### Test Infrastructure — change log` for test fixtures, mocks,
    test-discipline rule changes
  - `### Observability & Build Chain — change log` for CI workflows, Cloud Build
    / Cloud Run deploys, telemetry, scheduler matrix
- §9 Format Canonicalisation →
  `docs/reference/state-of-the-product-change-log-section-9.md`

**Row format:**

```
| DD/MM/YYYY | S{NNN} OR kh-prod-readiness-S{N} | {Δ description — multi-paragraph permitted; cross-link SHA, spec, and the SoTP capability bullet that the change refined} |
```

**Append discipline:**

- **Insert at end of the relevant table; newest at bottom.** Do not insert
  mid-table — chronological order is load-bearing for the rolling-window cut
  (below) and for human readers scanning recent work.
- **Bump the per-§ file's `<!-- Last verified -->` header** in the same commit
  as the row append, per `feedback_doc_freshness_guard_per_commit`. The
  freshness guard fires on touched-but-stale tracked docs.
- **Bump the pointer-doc** `state-of-the-product-change-log.md`
  `<!-- Last verified -->` header in the same commit. Touching any per-§ file
  cascades to the pointer-doc per the freshness guard.

**Rolling-window discipline (Shape C analogue, post-S42 W1).** SoTP per-§
change-logs now sit under the same Shape C pattern as `STATUS-change-log.md`:

- Each sub-table caps at **last 10 data rows**. If the table currently has 10
  rows and you append one, **move the topmost (oldest) data row to the bottom of
  the matching archive sibling**:
  - §5 → `state-of-the-product-change-log-section-5-archive.md`
  - §8 → `state-of-the-product-change-log-section-8-archive.md` (preserves the
    same sub-table headings — `### sub-section` route the archived row to the
    matching archive table)
- If a sub-table has **fewer than 10 rows**, leave it alone (no rolling).
- Both files (live + archive) stay in chronological order (oldest at top of
  archive's data block; newest at bottom of live).
- Both files commit together with the row append; freshness guard expects both
  Last-verified headers bumped (the archive sibling carries the
  cutover-rationale prose, live carries the latest verify).

---

## Step 4: Update Roadmap

**Files:**

- `docs/reference/product-roadmap.json` — **authoritative source** post-S39 W1
  Phase 2 (per `roadmap-conversion-approach.md` §6.1 step 5).
- `docs/reference/product-roadmap.md` — **generated artefact**. Never hand-edit.
  Regenerated via `bun run roadmap:render`. The round-trip CI guard
  (`__tests__/docs/roadmap-roundtrip.test.ts`) fails the build when the two
  drift apart.

**Prerequisite:** Step 3 SoTP capture must be complete before pruning roadmap
rows. The `>` callout below assumes the SoTP edit + change-log row already exist
this commit cycle.

> Any item that shipped this session is REMOVED from the roadmap JSON (no
> strikethrough, no "Status: Done"). Step 3 already folded the capability
> narrative into SoTP §5/§8 + change-log; the same commit ships JSON edits +
> regenerated MD + SoTP edits.

**Workflow (JSON-edit / MD-regen):**

1. **Edit `product-roadmap.json` only.** Find the `sections[*].items[*]` entry
   for the shipped item and remove it; or update its `status` / `status_note` /
   `priority_note` / `description` as appropriate. Section narrative lives in
   `sections[*].narrative` (markdown-preserved string).
2. **Bump `last_updated`.** The root `last_updated` field is the freshness
   marker the edit-coupled freshness guard checks (parallel to the MD
   `<!-- Last verified: -->` HTML comment used by other tracked docs). One-line
   form: `kh-prod-readiness-SNN <wave> close-out`. **Seed-commit exception:**
   when adding a NEW JSON-tracked doc to `TRACKED_REFERENCE_DOCS`, include
   `[skip-doc-freshness-guard]` in the commit body — there is no prior
   `last_updated` to bump from. Subsequent edits follow the standard bump rule.
3. **Run `bun run roadmap:render`.** This emits `product-roadmap.md` from JSON.
   Both files commit together — the round-trip guard rejects partial commits.
4. **Pre-flight detector.** If you intentionally added narrative that includes
   the word "shipped" (e.g. cross-referencing SoTP), run
   `bun run scripts/detect-roadmap-shipped-framings.ts` first; the converter
   refuses to emit JSON while findings exist. Reword to avoid the
   forward-looking-only doctrine breach OR migrate to SoTP.
5. **Move any completed roadmap items to `state-of-the-product.md`** (the
   canonical built record) and the relevant product-functionality document(s).
   The roadmap is **forward-looking only** — never leave Completed/Shipped/Done
   items in it.
6. **Update statuses for in-progress items** (with effort and source-spec
   references where helpful) by editing the JSON `status` / `status_note` /
   `effort_estimate` / `description` fields.

---

## Step 5: Archive Completed Specs (Conditional)

\*_"Spec" below also applies to "plan" files._

If any roadmap items were marked as completed in Step 4, check whether their
backing spec is now fully delivered — i.e. **every item** in the spec has
shipped. A spec is only archived once ALL of its items are complete, not before.

For each fully-completed spec move it to `.planning/.archive/.specs/`.

If a spec still has outstanding items (even one), leave it in `docs/specs/`.

---

## Step 6: Update Product Functionality Docs (Conditional)

**File directory:** `docs/product-functionality/`

The directory exists with seven functional area sub-directories
(`administration/`, `ai-integration/`, `bid-management/`, `content-management/`,
`knowledge-organisation/`, `quality-governance/`, `search/`) plus a shared
`_templates/` directory and area-level `README.md`. Per-area docs are
session-dated snapshots that capture deeper feature behaviour than the SoTP
capability bullets — read `docs/product-functionality/README.md` for the
authoring conventions.

1. Check which functional areas this session's work touched:

```bash
# See which product-functionality areas are affected by this session's commits
git diff --name-only HEAD~20 HEAD 2>/dev/null | grep -E "^(app/api|lib/ai|lib/mcp|components|hooks)" | head -50
```

2. Map the changed paths to functional areas using this table:

| Changed Path Pattern                                                             | Functional Area Doc       |
| -------------------------------------------------------------------------------- | ------------------------- |
| `app/api/bids/`, `lib/ai/draft.ts`, `lib/ai/match.ts`                            | `bid-management/`         |
| `app/api/items/`, `app/api/ingest/`, `app/api/extract/`                          | `content-management/`     |
| `app/api/search/`, `hooks/use-search.ts`                                         | `search/`                 |
| `app/api/governance/`, `app/api/review/`, `lib/quality-score.ts`                 | `quality-governance/`     |
| `app/api/taxonomy/`, `app/api/entities/`, `app/api/guides/`, `app/api/coverage/` | `knowledge-organisation/` |
| `lib/ai/`, `lib/mcp/`, `app/api/mcp/`                                            | `ai-integration/`         |
| `app/api/settings/`, `app/api/admin/`, cron routes                               | `administration/`         |

3. For each affected area:
   - Check if a doc already exists in `docs/product-functionality/[area]/`
   - If **no doc exists yet — add a note to the deferred items** in the
     continuation prompt that you are about to create during /handoff (do not
     create a doc mid-session; docs are written in dedicated documentation
     sessions)
   - If **a doc exists** — open it and: a. Identify any claims that are now
     outdated b. Update the relevant section, replacing outdated information c.
     Update the `Last verified` header date and session number d. Mark any
     sections that need fuller review with `[NEEDS REVIEW — updated S{NNN}]`

4. If the addition is substantial (a whole new feature area, not a tweak), flag
   it in the continuation prompt that you are about to create during /handoff so
   a dedicated documentation sub-session can be planned. The table in 'Step 6:
   Item 2' will also need to be updated to include the new path/functional area.

```bash
# Commit any product-functionality doc updates
git diff --quiet docs/product-functionality/ || \
  (git add docs/product-functionality/ && \
   git commit -m "docs: update product-functionality docs with session changes")
```

---

## Step 7: Detect Reference Doc Drift (Conditional)

**Purpose:** Flag tracked canonical reference docs whose source-of-truth
code/schema/env-vars changed this session without the doc being touched.
Detection only — no rewrites.

**Procedure:**

1. Identify changed source paths in this session's commits:

```bash
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT" && git diff --name-only HEAD~30 HEAD 2>/dev/null
```

2. Map paths → tracked reference docs via this table:

| Path pattern                                                                                                                                      | Reference doc(s)                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `supabase/migrations/*.sql`, `supabase/types/database.types.ts`                                                                                   | `SCHEMA-QUICK-REFERENCE.md`                                  |
| `lib/ai/**`, `app/api/ai/**`                                                                                                                      | `ai-integration-layers.md`, `ai-integration-strategy.md`     |
| `scripts/kb_pipeline/classify*.py`, `lib/ai/classify*.ts`, `scripts/tests/fixtures/taxonomy_snapshot.json`, `lib/taxonomy/*`                      | `classification-architecture.md`, `classification-prompt.md` |
| `app/api/items/**`, `app/api/upload/**`, `app/api/ingest/**`, `lib/mcp/tools/content.ts`, `scripts/kb_pipeline/pipeline.py`, `scripts/ingest*.py` | `data-entry-points.md`                                       |
| `lib/entities/**`, `lib/extraction/**`, `app/api/entities/**`                                                                                     | `entity-type-taxonomy-spec.md`                               |
| `lib/validation/schemas.ts`, `types/**`                                                                                                           | `field-consumer-dependency-map.md`                           |
| `.env.example`, `scripts/**` (CLI flag changes)                                                                                                   | `runbooks/local-development.md`                              |
| `supabase/**`, `.github/workflows/*staging*`                                                                                                      | `runbooks/staging-refresh.md`                                |
| `.github/workflows/**`, GitHub env-var/secret changes                                                                                             | `runbooks/github-environments.md`                            |

3. For each affected reference doc:
   - **If the doc was touched in this session's commits:** the edit-coupled
     freshness guard (WP2b) already enforced a `<!-- Last verified -->` header
     bump in the same commit. **No action needed.**
   - **If the doc was NOT touched but a mapped source path changed:** append a
     single line to the upcoming handoff prompt (Step 11) under a **"Reference
     doc drift"** section, formatted as:

     ```
     <doc-path>: drifted via <changed-source-path>
     ```

   Step 7 is purely a drift detector, emitting to the handoff prompt:

```markdown
### Reference doc drift

- `docs/reference/SCHEMA-QUICK-REFERENCE.md`: drifted via
  `supabase/migrations/20260428_add_index.sql`
- `docs/reference/ai-integration-layers.md`: drifted via
  `lib/ai/classify-content.ts`
- `docs/reference/ai-integration-strategy.md`: drifted via
  `lib/ai/classify-content.ts`
```

When the drift list crosses ~5 entries, or quarterly, schedule a
`/kpf:refresh-reference-docs` run. Drift items live in the next continuation
prompt **only** — never duplicated into roadmap or backlog (memory
`feedback_action_items_single_location`).

---

## Step 8: Update Product Backlog (Conditional)

**File:** `docs/reference/product-backlog.json`

**Prerequisite:** Step 3 SoTP capture must be complete before removing backlog
rows for shipped items. Same capture-then-prune principle as Step 4 (roadmap):
the SoTP capability bullet + change-log row are the audit trail; the backlog
prune only removes the now-redundant tracker entry.

JSON-shaped backlog (kh-prod-readiness-S37 cutover). Edit the `items[]` array
directly via the Edit tool, anchoring on the unique `"id": "<ID>"` line for each
row.

**Schema:** every item must carry `id`, `description`, `type`, `status`,
`effort_estimate`, `priority`, `track`, `dependencies`, `surfaced`, `notes`.
Status must be one of `spec_needed` / `needs_research` / `parked` / `ready` /
`blocked` — closure values (`done`, `shipped`, `closed`, `wontfix`) are
forbidden by the `__tests__/docs/backlog-no-closed-rows.test.ts` guard; remove
the row entirely instead.

**Operations:**

- **New item discovered in session** → append a new object to the `items[]`
  array (use Edit anchoring on the closing `]` of the last item). Pick the next
  sequential ID (e.g. if the latest bare-digit id is `65`, the next is `66`).
- **Existing item progressed in session** → update the row's `status` /
  `effort_estimate` / `notes` via Edit anchoring on the unique `"id": "<ID>"`
  line.
- **Item picked up for implementation** → invoke `update-roadmap-backlog` in
  Promote mode (not Delete) — the backlog entry is removed and a new Task or
  Subtask is appended to `docs/reference/task-list.json` with provenance journal
  block linking source backlog id. The task-list carries the canonical `done`
  state for traceability. (Ratified S60 / ID-15.10 Phase E.)
- **Item cancelled or superseded** (no implementation) → remove the entire row
  (the closing `}` plus the preceding comma if not the last item). The audit
  trail lives in git log + continuation prompts + State of the Product narrative.
- **Item promoted to roadmap** → remove the row from `product-backlog.json` and
  add a record to `product-roadmap.md` in the same commit. (Strategic /
  cross-cutting reclassification.)
- **Item promoted to task-list as new Task or Subtask** → invoke
  `update-roadmap-backlog` in Promote mode (see first bullet); the skill writes
  to both surfaces atomically with provenance journal.

After every edit, bump the top-level `last_updated` field per the
`last_updated` field-discipline rule in `update-roadmap-backlog/SKILL.md`
(§`last_updated` field-discipline). Applies to ALL three ledgers:
`product-roadmap.json`, `product-backlog.json`, AND `docs/reference/task-list.json`.
Single line, `kh-{track}-S{N}` prefix, ≤200 chars, one session-id only — NEVER
prepend prior narrative on cherry-pick conflict. Example:
`"kh-prod-readiness-S37 close-out — docs sync (5 fields)"`. The Zod schema enforces
the shape on `task-list.json`; roadmap + backlog rely on the discipline alone.

---

## Step 9: Update Track Change-log (Conditional)

If the session shipped material work on a track that maintains a per-session
change-log file, append one row to that file. Currently `production-readiness`
track uses `docs/audits/kh-production-readiness-phase-1/STATUS-change-log.md`
(rolling last-10 window per Shape C; older rows in
`STATUS-change-log-archive.md`).

**Append a row** with `| {DD/MM/YYYY} | S{NNN} | {net delta prose} |`. Newest at
bottom. Multi-paragraph rows are valid Markdown table syntax.

**Rolling window discipline (Shape C):** when the active log exceeds 10 data
rows, move the topmost (oldest) data row to the bottom of the archive log's data
block and drop it from active. Both files stay in chronological order (newest at
bottom).

**Optional handoff block.** If the next session needs deeper context than the
change-log row carries (deferred scope, pending decisions, focus pivot), append
a `### S{N} → S{N+1} handoff` block to `STATUS-handoffs.md`. Otherwise skip —
the change-log row plus the continuation prompt is sufficient.

The single-file `STATUS.md` ledger pattern was archived kh-prod-readiness-S41 W3
(file is now `STATUS-phase-1-archive.md`, cold storage). All active items track
in `product-roadmap.json` / `product-backlog.json`.

---

## Step 10: Prettier Sweep

```bash
# Run format check; capture unformatted file list if it fails.
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
if ! bun run format:check >/tmp/fmt-check.log 2>&1; then
  echo "Prettier drift detected — files:"
  grep -E '^\[warn\] ' /tmp/fmt-check.log | awk '{print $2}'
  # Surgical fix — only the files Prettier flagged (avoid full-repo reformat).
  files=$(grep -E '^\[warn\] ' /tmp/fmt-check.log | awk '{print $2}' | tr '\n' ' ')
  if [ -n "$files" ]; then
    bunx prettier --write $files
    git add $files
    git commit -m "chore(format): prettier sweep at session close"
  fi
else
  echo "Prettier clean — no sweep needed."
fi
```

---

## Step 11: Commit Reference Doc Changes

Stage the canonical docs.

```bash
# Commit reference doc updates. The change-log glob captures both the
# pointer-doc and the per-§ append-target files.
git diff --quiet docs/reference/ || \
  (git add docs/reference/product-roadmap.json docs/reference/product-roadmap.md \
   docs/reference/state-of-the-product.md \
   docs/reference/state-of-the-product-change-log.md \
   docs/reference/state-of-the-product-change-log-section-*.md \
   docs/reference/product-backlog.json 2>/dev/null && \

   git commit -m "docs: update reference docs for session")
```

---

## Step 12: Report and Chain to Handoff

Present a summary to the user:

> Documentation updated:
>
> - **Stats:** {regenerated / no changes}
> - **State of product:** {updated / no changes needed}
> - **Change-log:** {row appended / N/A}
> - **Roadmap:** {N items updated — X done, Y partial, Z new}
> - **Specs archived:** {N specs archived / none eligible}
> - **Product-functionality docs:** {N areas updated / no existing docs affected
>   / N areas flagged for doc session}
> - **Backlog:** {N items updated — Z new}
> - **Wave ledger:** {N items transitioned — X shipped, Y blocked / no active
>   wave touched}
>
> Generating continuation prompt now.

Then invoke the `/handoff` skill. All session context (git history, doc state,
conversation) is already loaded — handoff will use it directly without
re-gathering.
