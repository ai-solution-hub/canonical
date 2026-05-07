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

| Document                              | File                                                                   | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **State of the product**              | `docs/reference/state-of-the-product.md`                               | **Canonical record of what is CURRENTLY built.** Bullet-list-driven capability ledger organised by functional area (Feature State, AI Integration Points, Test Infrastructure, etc.). Each section describes the present-tense capability — never a session-by-session changelog. Updated whenever a significant feature lands; the corresponding session narrative is appended to the per-§ change-log file matching the touched SoTP §N (`state-of-the-product-change-log-section-{5,8,9}.md`) atomically. The pointer-doc `state-of-the-product-change-log.md` is the discovery index — never an append target. |
| **Roadmap**                           | `docs/reference/product-roadmap.md`                                    | **Forward-looking only.** Active and ready-for-implementation items. All session work is driven from here. Never contains Done/Shipped/Resolved items.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Product backlog**                   | `docs/reference/product-backlog.json`                                  | Items awaiting promotion to the roadmap. **JSON-shaped** since kh-prod-readiness-S37 cutover; `items[]` array with `id`, `description`, `type`, `status`, `effort_estimate`, `priority`, `track`, `depends_on`, `surfaced`, `notes`. Status enum: `needs_spec` / `needs_research` / `parked` / `ready` / `blocked` (no closure values — closed items are removed entirely).                                                                                                                                                                                                                                        |
| **State of the product — change log** | `docs/reference/state-of-the-product-change-log.md` (+ per-§ siblings) | **Discovery index (pointer-doc) + per-section append targets.** A thin pointer-doc carrying a discovery table that lists the per-§ files; append-only writes route to `state-of-the-product-change-log-section-{5,8,9}.md` — one file per SoTP §N. Newest at bottom.                                                                                                                                                                                                                                                                                                                                               |
| **Wave status ledgers**               | `docs/audits/*/STATUS.md` (e.g. `{wave-name}-{yyyy-mm}/STATUS.md`)     | **Single-page status tracker** for a multi-session wave. Views over DECISIONS/SPEC-SEQUENCE/DEFERRED rather than a new source — shows per-item `Status` / `Artefact` / `Shipped in` / `Notes`. Maintained live at close-out for any active wave the session touched.                                                                                                                                                                                                                                                                                                                                               |

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
  `docs/reference/state-of-the-product-change-log-section-5.md`
- §8 AI Integration Points →
  `docs/reference/state-of-the-product-change-log-section-8.md` (find the right
  `### sub-section` heading if applicable — Test Infrastructure / Observability
  & Build Chain)
- §9 Format Canonicalisation →
  `docs/reference/state-of-the-product-change-log-section-9.md`

```
| DD/MM/YYYY | S{NNN} OR kh-prod-readiness-S{N} | {Δ description — multi-paragraph permitted; cross-link SHA, spec, and the SoTP capability bullet that the change refined} |
```

---

## Step 4: Update Roadmap

**File:** `docs/reference/product-roadmap.md`

**Prerequisite:** Step 3 SoTP capture must be complete before pruning roadmap
rows. The `>` callout below assumes the SoTP edit + change-log row already exist
this commit cycle.

> Any item that shipped this session is REMOVED from the roadmap (no
> strikethrough, no "Status: Done"). Step 3 already folded the capability
> narrative into SoTP §5/§8 + change-log; the same commit ships both edits.

Read the file, then:

1. Move any completed roadmap items to `state-of-the-product.md` (the canonical
   built record) and the relevant product-functionality document(s). The roadmap
   is **forward-looking only** — never leave Completed/Shipped/Done items in it.
   This provides clear visibility of priority, actionable tasks on the roadmap,
   which can be updated with new items from the product backlog when capacity
   allows/priorities evolve.
2. Update statuses for in-progress items (with effort and source-spec references
   where helpful).

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
`effort_estimate`, `priority`, `track`, `depends_on`, `surfaced`, `notes`.
Status must be one of `needs_spec` / `needs_research` / `parked` / `ready` /
`blocked` — closure values (`done`, `shipped`, `closed`, `wontfix`) are
forbidden by the `__tests__/docs/backlog-no-closed-rows.test.ts` guard; remove
the row entirely instead.

**Operations:**

- **New item discovered in session** → append a new object to the `items[]`
  array (use Edit anchoring on the closing `]` of the last item). Pick the next
  sequential ID (e.g. if the latest is `OPS-62`, the next is `OPS-63`).
- **Existing item progressed in session** → update the row's `status` /
  `effort_estimate` / `notes` via Edit anchoring on the unique `"id": "<ID>"`
  line.
- **Item completed** → remove the entire row (the closing `}` plus the preceding
  comma if not the last item). The audit trail lives in git log + continuation
  prompts + State of the Product narrative.
- **Item promoted to roadmap** → remove the row from `product-backlog.json` and
  add a record to `product-roadmap.md` in the same commit.

After every edit, bump the top-level `last_updated` field to the current session
label (e.g. `"kh-prod-readiness-S37 close-out"`).

---

## Step 9: Update Wave Status Ledgers (Conditional)

**Directory:** `docs/audits/*/STATUS.md` (and sibling split files where they
exist).

If the session touched items in an active multi-session wave that maintains a
`STATUS.md` ledger (for example `docs/audits/{wave-name}-{yyyy-mm}/STATUS.md`),
update the ledger to reflect shipped state. One ledger per wave.

**Two layouts exist — check which the wave uses before editing:**

- **Single-file ledger** (default) — everything lives in `STATUS.md`: snapshot,
  gates, items, change log, handoffs.
- **Split ledger** — when a single STATUS.md grows too large to read, the wave
  may split into siblings:
  - `STATUS.md` — at-a-glance view (snapshot, gates, items, pending pickup
    list).
  - `STATUS-change-log.md` — per-session net-delta log; append-only.
  - `STATUS-handoffs.md` — multi-paragraph outcome-and-next-scope blocks;
    written only when the next session needs deeper handoff narrative than the
    change-log row provides.

  Detect by `ls docs/audits/<wave>/STATUS-*.md`. If the split exists, treat each
  file as the canonical home for its content type — never duplicate content
  across the split, and never put change-log rows or handoff prose back into
  `STATUS.md`.

  Currently using split layout: `kh-production-readiness-phase-1/`.

**When to update:**

- Any item in the ledger transitioned state this session (`Not started` →
  `In progress`, `In progress` → `Shipped`, blocker discovered, spec written,
  etc.).
- A gate cleared.
- A new item was added to the underlying DECISIONS / SPEC-SEQUENCE and needs a
  ledger row.

**What to update (single-file or split — same content, different homes):**

1. **Per-item rows (item tables in `STATUS.md` §4 or equivalent).** Flip the
   `Status` column, populate `Shipped in` with
   `S{NNN} ({DD/MM/YYYY}, `{short_sha}`)`, update `Artefact` if the spec was
   written or archived, and append a one-line note to `Notes` if a blocker
   surfaced or a dependency closed.
2. **Gate status (`STATUS.md` §2 or equivalent).** If a gate cleared, mark
   **Cleared** and record the `Cleared in` session.
3. **Snapshot counts (`STATUS.md` §1 or equivalent).** Adjust the
   shipped-per-session line and any cumulative totals. Update §1.1 external
   holds: tag any holds that closed this session with ✅ CLOSED + session ref.
4. **Pending pickup list (`STATUS.md` §4.x or equivalent).** Remove items that
   shipped; add items newly identified as pending; reflect any held-on-X
   transitions.
5. **Change log row.**
   - **Split layout:** append one row to `STATUS-change-log.md` §1 with
     `| {DD/MM/YYYY} | S{NNN} | {net delta prose} |`.
   - **Single-file:** append one row to `STATUS.md` §8 (or equivalent) under the
     change-log section.
6. **Handoff narrative (split layout only — conditional).** If the next session
   needs deeper handoff context than a change-log row carries (deferred scope,
   pending decisions, focus pivot), append a `### S{N} → S{N+1} handoff` block
   to `STATUS-handoffs.md` §1. Otherwise skip — the change-log row plus the
   continuation prompt is sufficient.

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
  (git add docs/reference/product-roadmap.md docs/reference/state-of-the-product.md \
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
