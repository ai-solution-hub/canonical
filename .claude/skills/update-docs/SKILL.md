---
name: update-docs
description:
  Update roadmap, state of the product, auto-generated stats,
  product-functionality docs, and product backlog to reflect the current
  session's work, then auto-chain to /handoff. Triggers on "update docs",
  "update roadmap", "update state of the product", "update backlog".
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Skill
---

# Update Docs — Session Documentation Sync

Updates roadmap, state-of-the-product, auto-generated stats,
product-functionality, and product backlog docs to reflect the current session's
work, then auto-chains to `/handoff` to generate the continuation prompt. The
user reviews the continuation prompt at the end.

## Document Roles (READ FIRST)

The planning documents have distinct, non-overlapping roles. Future agents must
respect this distinction or the docs will drift back into chaos:

| Document                              | File                                                               | Role                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **State of the product**              | `docs/reference/state-of-the-product.md`                           | **Canonical record of what is CURRENTLY built.** Bullet-list-driven capability ledger organised by functional area (Feature State, AI Integration Points, Test Infrastructure, etc.). Each section describes the present-tense capability — never a session-by-session changelog. Updated whenever a significant feature lands; the corresponding session narrative is appended to the per-§ change-log file matching the touched SoTP §N (`state-of-the-product-change-log-section-{5,8,9}.md`) atomically. The pointer-doc `state-of-the-product-change-log.md` is the discovery index — never an append target. |
| **Roadmap**                           | `docs/reference/post-mvp-roadmap.md`                               | **Forward-looking only.** Active and ready-for-implementation items. All session work is driven from here. Never contains Done/Resolved items.                                                                                                                                                                                                                                                                                      |
| **Product backlog**                   | `docs/reference/product-backlog.md`                                | It's unlikely that product backlog items will have been completed during the session as the roadmap drives implementation priorities, but it's possible that new items may have been identified during the session, which will need to be added to the backlog, awaiting promotion to the roadmap.                                                                                                                                  |
| **State of the product — change log** | `docs/reference/state-of-the-product-change-log.md` (+ per-§ siblings) | **Discovery index (pointer-doc) + per-section append targets.** Post-S219 split per `docs/specs/sotp-change-log-split-spec.md` v1: `state-of-the-product-change-log.md` is now a thin pointer-doc carrying a discovery table that lists the per-§ files; append-only writes route to `state-of-the-product-change-log-section-{5,8,9}.md` — one file per SoTP §N. Newest at bottom. Mirrors `STATUS-change-log.md` shape (commit `a1b3b0e3` on production-readiness). For canonical present-tense capability ledger, see `state-of-the-product.md`. For pre-S186 history, see `state-of-the-product-history.md`. |
| **State of the product — history**    | `docs/reference/state-of-the-product-history.md`                   | **Frozen historical archive — the cold tier (S53→S185).** Per-session "what shipped in session N" narrative blocks split out of the canonical doc in S152B WP10 (commit `3e3eccc5`). Append nothing here directly — the change-log file is the warm append surface; cold-archive sweeps move blocks from change-log → history when the change-log crosses ~5000 lines.                                                              |
| **Backlog completed archive**         | `docs/reference/product-backlog-completed.md`                      | Frozen historical record of completed backlog items.                                                                                                                                                                                                                                                                                                                                                                                |
| **Wave status ledgers**               | `docs/audits/*/STATUS.md` (e.g. `{wave-name}-{yyyy-mm}/STATUS.md`) | **Single-page status tracker** for a multi-session wave. Views over DECISIONS/SPEC-SEQUENCE/DEFERRED rather than a new source — shows per-item `Status` / `Artefact` / `Shipped in` / `Notes`. Maintained live at close-out for any active wave the session touched.                                                                                                                                                                |

---

## Step 1: Regenerate Auto-Generated Stats

Run all stats scripts to ensure the generated files reflect the current
session's changes.

```bash
# Anchor to the current repo root (defensive: CWD can drift into agent
# worktrees mid-session).
ROOT="$(git rev-parse --show-toplevel)"

# Regenerate codebase statistics
cd "$ROOT" && bun run stats

# Regenerate MCP tool/resource/prompt inventory
cd "$ROOT" && bun run generate:mcp-inventory
```

If any script fails, report the error but do not block the rest of the update.

Check if anything changed and commit if so:

```bash
git diff --quiet docs/generated/ || (git add docs/generated/ && git commit -m "chore: regenerate codebase stats and MCP inventory")
```

---

## Step 2: Understand Session Work

Gather context about what was accomplished:

```bash
# Recent commits
git log --oneline -30 --no-decorate

# Files changed
git diff --name-only HEAD~30 HEAD 2>/dev/null | head -100
```

Also read the conversation context and any task tracking to understand which
work packages were completed, partially completed, or deferred.

---

## Step 3: Update Roadmap

**File:** `docs/reference/post-mvp-roadmap.md`

> **Before editing, apply the
> [Ship-event discipline](#ship-event-discipline-applies-to-steps-3-and-8) rule
> below**: any item that shipped this session is REMOVED from the roadmap (no
> strikethrough, no "Status: Done") and its capability narrative is folded into
> SoTP §5/§8 + change-log in the SAME commit.

Read the file, then:

1. Move any completed roadmap items to `state-of-the-product.md` (the canonical
   built record) and the relevant product-functionality document(s). The roadmap
   is **forward-looking only** — never leave Completed/Done items in it. This
   provides clear visibility of priority, actionable tasks on the roadmap, which
   can be updated with new items from the product backlog when capacity
   allows/priorities evolve.
2. Update statuses for in-progress items (with effort and source-spec references
   where helpful).
3. Add new items discovered during the session — under the appropriate domain
   section (Sector Intelligence, AI Evaluation, Bid Workflow, etc.).
4. Reorder if priorities have shifted based on user feedback.

---

## Ship-event discipline (applies to Steps 3 and 8)

**Rule: ship-event = remove + SoTP fold-in in the SAME commit. Never
strikethrough-and-keep.**

When a roadmap or backlog item ships during the session:

1. **REMOVE the row entirely** from `post-mvp-roadmap.md` or
   `product-backlog.md`. No strikethrough (`~~OPS-N~~`), no "Status:
   Done"/"Status: Shipped"/"Status: Closed" annotation, no "kept here for
   cross-ref" preservation, no "promoted to roadmap §X" stub. Closed = removed.
2. **Fold the capability narrative into SoTP** in the SAME commit as the row
   removal:
   - Update or add the relevant capability bullet under
     `state-of-the-product.md` §5 / §8 (per Step 5's discipline).
   - Append a row to the per-§ change-log file
     (`state-of-the-product-change-log-section-{5,8,9}.md`) matching the
     affected SoTP §N — describing the session-level delta. The pointer-doc
     `state-of-the-product-change-log.md` is the discovery index, not an
     append target.
   - Both edits ship atomically with the roadmap/backlog removal — no follow-up
     "fix change-log" commits.
3. **The git commit ref + session number is the audit trail.** The roadmap and
   backlog must never carry historical Done/Shipped/Closed/Wontfix rows.
   Continuation prompts (`docs/continuation-prompts/`) and session-deliverable
   memory files preserve the per-session log; `git log` preserves the line-level
   history.

**Rationale.** Closed/Done rows accumulating in the roadmap and backlog
re-create the bloat that S210-C1 (backlog purge) and S210-C2 (roadmap purge)
just removed (~21 backlog rows + ~6 roadmap rows + ~9 ship-crumb rewrites).
Forward-looking discipline must be enforced at write-time, not retroactively in
a future cleanup wave.

**Forward-discipline guards (S210-C3).** Two Vitest tests fail CI on any
Done/Shipped/Closed row that slips through:

- `__tests__/docs/roadmap-no-shipped-rows.test.ts` — fails if
  `post-mvp-roadmap.md` contains a row with
  `Status: Done|Shipped S\d|Completed S\d` (excluding the `## Operational Notes`
  section).
- `__tests__/docs/backlog-no-closed-rows.test.ts` — fails if
  `product-backlog.md` contains a `~~`-strikethrough row, or
  `Status: Closed|Done|Wontfix|Completed` inside the active table.

If either guard fails, the fix is to follow this rule: remove the row, fold the
narrative into SoTP, ship the commit. Do NOT relax the regex — the guards exist
precisely to prevent re-accumulation.

**Relationship to Step 5.** Step 5 explains _how_ to fold a capability into SoTP
(which sub-section, banner preservation, change-log row format). This rule
explains _when_ to remove the corresponding roadmap/backlog row (in the same
commit as the SoTP fold-in, never deferred, never strikethrough-and-keep). The
two rules are complementary: Step 5 is the destination; this rule is the
source-side discipline.

---

## Step 4: Archive Completed Specs (Conditional)

\*_"Spec" below also applies to "plan" files._

If any roadmap items were marked as completed in Step 3, check whether their
backing spec is now fully delivered — i.e. **every item** in the spec has
shipped. A spec is only archived once ALL of its items are complete, not before.

For each fully-completed spec:

1. Move it to `.planning/.archive/.specs/`:

```bash
git mv docs/specs/<spec-file>.md .planning/.archive/.specs/<spec-file>.md
```

2. Update any roadmap or state-of-the-product references that point to the old
   path.

If a spec still has outstanding items (even one), leave it in `docs/specs/`.

```bash
# Commit any archived specs
git diff --cached --quiet || git commit -m "chore: archive completed specs"
```

---

## Step 5: Update State of the Product

**Files:**

- `docs/reference/state-of-the-product.md` — canonical present-tense capability
  ledger
- `docs/reference/state-of-the-product-change-log-section-{5,8,9}.md` —
  append-only per-section narrative (warm tier, S186 onwards). One file per
  SoTP §N (post-S219 split per
  `docs/specs/sotp-change-log-split-spec.md` v1). Multi-section sessions
  write one row per affected §N file in the same commit.
- `docs/reference/state-of-the-product-change-log.md` — discovery index /
  pointer-doc. Carries the per-section files table; never an append target.

The two files have distinct, non-overlapping roles. SoTP carries the bullet list
of what is currently built; the change-log carries when/how/why each capability
changed. **Capability edits and change-log appends always ship in the SAME
COMMIT** so a future reader can diff both surfaces together.

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
2. **Update the capability bullet in place.** Describe what is true now. **No
   session marker in the body** — `(S155 WP3)` belongs in the change-log row,
   not the SoTP bullet. The capability statement is what's true; the change-log
   carries when/how/why it changed.
3. **If a feature was REMOVED**, delete the bullet outright. Do not
   strikethrough. Do not leave both old and new descriptions side-by-side.
4. **If the section does not exist**, add a new bullet under the most
   appropriate sub-section. Do NOT create a new top-level section without strong
   reason. New top-level sections are a red flag for unbounded growth.
5. **Preserve the section-header banner** at the top of each §5/§8 sub-section:
   `> Capability summary only. Session-by-session narrative lives in [state-of-the-product-change-log.md](state-of-the-product-change-log.md).`
   The banner is the second-line defence against changelog drift — never delete
   it.

**3. Append a change-log row** to the per-§ change-log file matching the
affected SoTP §N:

- §5 Feature State → `docs/reference/state-of-the-product-change-log-section-5.md`
- §8 AI Integration Points → `docs/reference/state-of-the-product-change-log-section-8.md`
  (find the right `### sub-section` heading if applicable — Test Infrastructure
  / Observability & Build Chain)
- §9 Format Canonicalisation → `docs/reference/state-of-the-product-change-log-section-9.md`

The pointer-doc `state-of-the-product-change-log.md` is the discovery index;
never append rows there. Multi-section sessions write one row per affected §N
file in the same commit. Append a row at the bottom of the file's table:

  ```
  | DD/MM/YYYY | S{NNN} OR kh-prod-readiness-S{N} | {Δ description — multi-paragraph permitted; cross-link SHA, spec, and the SoTP capability bullet that the change refined} |
  ```

- **Newest at bottom** — never reorder.
- **Append-only** — never edit prior rows except for typo / factual error fixes.
- The `Δ` cell can be multi-paragraph (Markdown table cells handle this fine).
  For sessions with multi-area changes, a single multi-paragraph row keeps the
  change diffable; resist the temptation to spread one session across multiple
  rows in different sections unless the changes are genuinely orthogonal.

**4. Migration discipline rules** (the four guardrails that prevent regrowth):

1.  **Section-header banner preserved** at the top of every §5/§8 sub-section.
2.  **No session markers in SoTP body.** A bullet may name a feature shipped
    post-S196 but cannot end with `(S196 §1.19)` — that's the change-log's job.
    Only deliberate exception: brief session-arc bookmark lines like
    "Re-ingestion arc S175-S182" which is itself a link to the history doc.
3.  **Append-only change-log.** Never reorder, never edit prior rows except to
    fix typos or correct factual errors (with edit annotation).
4.  **One commit per session** touching both files when a capability shipped.
    Diff readers see both surfaces together. No follow-up "fix change-log"
    commits — atomic edit + append.

**5. Worked example.** Hypothetical S214 ships a new "Per-domain entity
confidence threshold" feature in `lib/entities/confidence.ts`.

_SoTP edit_ — update the capability bullet under §5 Classification & AI:

```diff
 ### Classification & AI

 > Capability summary only. Session-by-session narrative lives in [state-of-the-product-change-log.md](state-of-the-product-change-log.md).

 - Classifier prompt v4.5 with two-pass validation; entity taxonomy enforced.
-- Confidence is reported per entity but applied uniformly across domains.
+- Confidence is reported per entity and **applied per-domain** via configurable
+  threshold table; low-confidence entities are surfaced for review rather than
+  auto-merged.
```

_Change-log append_ — add a row at the bottom of §5's change-log table in
`state-of-the-product-change-log-section-5.md`:

```
| 02/05/2026 | S214 | Per-domain entity confidence threshold landed (`lib/entities/confidence.ts`, spec `docs/specs/entity-confidence-spec.md`, commit `abc12345`). Replaces the uniform threshold with a per-domain table; low-confidence entities now route to the review queue rather than auto-merging. SoTP §5 Classification & AI bullet updated. |
```

Both edits ship in one commit:
`docs(s214): per-domain entity confidence threshold + SoTP fold-in`.

6. **If you notice that a section hasn't followed this approach** (e.g. content
   reads like a session-by-session changelog rather than a capability summary),
   resolve it if it's a section you're actively updating, or flag it as an
   action for the next session in the continuation prompt created during
   /handoff. This keeps SoTP aligned with the canonical present-tense
   discipline.

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

The product-functionality docs are session-dated snapshots. They must be kept
aligned as the Sector Intelligence, AI/Prompt Engineering, and other workstreams
add features in parallel.

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

## Step 6.5: Detect Reference Doc Drift (Conditional)

**Purpose:** Flag tracked canonical reference docs whose source-of-truth
code/schema/env-vars changed this session without the doc being touched.
Detection only — no rewrites.

**Why a separate step (not folded into Step 6):** Step 6 product-functionality
docs are session-dated snapshots that flag updates with
`[NEEDS REVIEW — updated S{NNN}]`. Reference docs are canonical present-tense —
they carry only a `<!-- Last verified: ... -->` header, never session markers in
body. Folding risks future agents applying snapshot semantics to canonical docs.

**Tracked-doc list:** sourced from `lib/docs/tracked-reference-docs.ts`
(`TRACKED_REFERENCE_DOCS`) — the same constant the edit-coupled freshness guard
test (`__tests__/docs/reference-doc-edit-coupled-freshness.test.ts`) uses.
Adding/removing tracked docs touches that file only; both this step and the
guard pick up changes automatically.

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

4. **Detection only — no auto-rewrite.** Doc rewrites happen either:
   - In the originating session (when the author edits the doc and bumps the
     `<!-- Last verified -->` header), or
   - In a periodic `/kpf:refresh-reference-docs` run (which spawns 4 parallel
     agents to diff claimed facts vs current code, rewrite in place, and bump
     headers).

   Step 6.5 is purely a drift detector. Surfacing the list to the next session's
   prompt is the trigger to schedule a refresh.

**Worked example (hypothetical):** A session committed
`supabase/migrations/20260428_add_index.sql` and `lib/ai/classify-content.ts`,
but didn't touch any tracked reference doc. The mapping yields:

- `supabase/migrations/20260428_add_index.sql` → `SCHEMA-QUICK-REFERENCE.md`
- `lib/ai/classify-content.ts` → `ai-integration-layers.md`,
  `ai-integration-strategy.md`

Step 6.5 emits to the handoff prompt:

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

**File:** `docs/reference/product-backlog.md`

> **Before editing, apply the
> [Ship-event discipline](#ship-event-discipline-applies-to-steps-3-and-8) rule
> above**: any backlog item that shipped or closed this session is REMOVED
> entirely (no strikethrough, no "Status: Closed/Done/Wontfix"). Capability
> narrative folds into SoTP §5/§8 + change-log in the SAME commit.

If new work items were discovered in the session which aren't related to
sections already covered by the product roadmap, these will need to be added to
the product backlog, awaiting prioritisation.

It's also possible that during the session an item or items have been identified
as candidates for promotion to the roadmap.

Read the file, then for each item that was identified in this session:

1. Add a **new backlog item** under the relevant section (bugs found, UX issues
   observed, missing features identified).

2. \*\*If an item was identifed for promotion to the roadmap, remove it entirely
   from the backlog and create a record in the roadmap document.

3. Update the **summary counts** at the top of the file to match the new status
   distribution.

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

**What NOT to do:**

- Do not rewrite DECISIONS or SPEC-SEQUENCE from the ledger. The ledger is a
  view, not a source.
- Do not add new items to the ledger without first adding them to the underlying
  DECISIONS and SPEC-SEQUENCE.
- Do not create a `STATUS.md` ledger for a wave that does not have one already —
  the existing ones were created deliberately. Flag in the continuation prompt
  if a new wave would benefit from one.
- Do not duplicate content between split files. Change-log rows do not belong in
  `STATUS.md`; gates and item tables do not belong in `STATUS-change-log.md`;
  cross-link instead.

**Edge cases:**

- **Reverts.** If a previously-shipped item is reverted, flip its status back to
  `In progress` or `Not started`, clear the shipped SHA, note the revert commit,
  and log in the change log (or split change-log file).
- **Multi-session items.** Specs written one session but implementation landing
  later must hold at `Spec in progress` or `In progress`; do not mark `Shipped`
  until the item lands on main.
- **Bidirectional resync.** If DECISIONS.md or SPEC-SEQUENCE.md changed this
  session, the ledger MUST be resynced in the same session: add/remove rows to
  match the new item set, move items to the correct wave if a wave changed,
  update artefact paths, and log the resync. The ledger must not drift from its
  source documents.

**Commit separately** so the ledger update is easy to review and revert:

```bash
git diff --quiet docs/audits/ || \
  (git add docs/audits/ && \
   git commit -m "docs: update wave status ledger for session")
```

---

## Step 10: Commit Reference Doc Changes

Stage the canonical docs. The change-log file is included so capability edits
and the corresponding session narrative ship together (Step 5 atomic-pairing
rule).

```bash
# Commit reference doc updates. The change-log glob captures both the
# pointer-doc and the per-§ append-target files (post-S219 split per
# `docs/specs/sotp-change-log-split-spec.md` v1).
git diff --quiet docs/reference/ || \
  (git add docs/reference/post-mvp-roadmap.md docs/reference/state-of-the-product.md \
   docs/reference/state-of-the-product-change-log.md \
   docs/reference/state-of-the-product-change-log-section-*.md \
   docs/reference/product-backlog.md 2>/dev/null && \

   git commit -m "docs: update reference docs for session")
```

---

## Step 11: Report and Chain to Handoff

Present a summary to the user:

> Documentation updated:
>
> - **Stats:** {regenerated / no changes}
> - **Roadmap:** {N items updated — X done, Y partial, Z new}
> - **Specs archived:** {N specs archived / none eligible}
> - **State of product:** {updated / no changes needed}
> - **Change-log:** {row appended / N/A}
> - **Product-functionality docs:** {N areas updated / no existing docs affected
>   / N areas flagged for doc session}
> - **Wave ledger:** {N items transitioned — X shipped, Y blocked / no active
>   wave touched}
> - **Backlog:** {N items updated — Z new}
>
> Generating continuation prompt now.

Then invoke the `/handoff` skill. All session context (git history, doc state,
conversation) is already loaded — handoff will use it directly without
re-gathering.
